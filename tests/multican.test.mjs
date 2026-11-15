import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validQuantity, packedParcels, packedWeightGrams, parcelCount, quantityFromSession } from '../quantity.js';
import { getShippingRates } from '../shipping.js';
import { createCheckoutFormSession } from '../checkout-embedded.js';
import { updateCheckoutShipping, fingerprintShippingAddress } from '../checkout-shipping.js';
import { verifyAuthorizedOrder } from '../order-verification.js';
import worker from '../worker.js';

const from = { name:'Warehouse',street1:'Main Street', city:'LA',state:'CA',zip:'90001',country:'US' };
const to = { name:'Customer',street1:'Main Street', city:'SF',state:'CA',zip:'94103',country:'US' };
const stripeAddress = {line1:'Main Street',line2:'',city:'SF',state:'CA',postal_code:'94103',country:'US'};
const rate = (amount='8.50') => ({ object_id:'rate_abc',provider:'UPS',currency:'USD',amount,servicelevel:{name:'Ground'} });
function response(body,status=200) { return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}); }

const oldFetch = globalThis.fetch;
function withFetch(mock, fn) { globalThis.fetch=mock; return Promise.resolve().then(fn).finally(()=>{globalThis.fetch=oldFetch;}); }

function verifiedSession(q) { return {
  id:'cs_test_a1', status:'complete',mode:'payment',ui_mode:'form',livemode:false,currency:'usd',
  metadata:{checkout_flow:'borderless_shippo_preview',checkout_quantity:String(q),shipping_quote_quantity:String(q),shipping_quote_rate_id:'r1',shipping_quote_amount_cents:'850',shipping_quote_parcels:String(Math.ceil(q/2)),shipping_quote_strategy:'multiparcel'},
  shipping_cost:{amount_total:850}, total_details:{amount_shipping:850,amount_tax:0}, amount_subtotal:q*4500,amount_total:q*4500+850,
  payment_intent:'pi_A1',collected_information:{shipping_details:{address:stripeAddress}}
}; }
function payment(q) {return {id:'pi_A1',status:'requires_capture',capture_method:'manual',livemode:false,currency:'usd',amount:q*4500+850,amount_capturable:q*4500+850};}
async function review(q,changes={}) { const session=verifiedSession(q); session.metadata.shipping_quote_address_hash=await fingerprintShippingAddress(stripeAddress); Object.assign(session,changes); return verifyAuthorizedOrder({session,paymentIntent:payment(q),lineItems:[{price:{id:'price_live_test'},quantity:q,amount_subtotal:q*4500}],expectedPriceId:'price_live_test'}); }

test('quantity rule: every integer 1..20',()=>{
 for (let q=1;q<=20;q++) assert.equal(validQuantity(q),true);
 for (const v of [0,-1,21,22,99,2.5,'2',null]) assert.equal(validQuantity(v),false);
});
test('packed weight and count by quantity',()=>{
 assert.equal(packedWeightGrams(1),600); assert.equal(packedWeightGrams(2),1100);
 assert.equal(packedWeightGrams(3),1700); assert.equal(packedWeightGrams(5),2800);
 assert.equal(packedWeightGrams(4),2200); assert.equal(packedWeightGrams(10),5500);
 assert.equal(packedParcels(20).length,10);
 assert.equal(parcelCount(3),2);
 assert.deepEqual(packedParcels(3).map(p=>p.weight),['1100','600']);
 assert.deepEqual(packedParcels(19).map(p=>p.weight),[...Array(9).fill('1100'),'600']);
 assert.ok(packedParcels(4).every(p=>p.length==='8'&&p.width==='6'&&p.height==='4'&&p.weight==='1100'));
});
test('legacy one-can session remains valid only at $45',()=>{
 assert.equal(quantityFromSession({metadata:{}, amount_subtotal:4500}),1);
 assert.equal(quantityFromSession({metadata:{}, amount_subtotal:9000}),null);
 assert.equal(quantityFromSession({metadata:{checkout_quantity:'2'}, amount_subtotal:9000}),2);
 assert.equal(quantityFromSession({metadata:{checkout_quantity:'4'}, amount_subtotal:9000}),null);
});

test('Shippo receives one physical 1100g box for two cans; one rate',()=>withFetch(async (_,opts)=>{
 const body=JSON.parse(opts.body); assert.equal(body.parcels.length,1); assert.equal(body.parcels[0].weight,'1100');
 return response({object_id:'ship_1',rates:[rate('9.25')]});
},async()=>{
 const q=await getShippingRates({token:'dummy',shipFrom:from,shipTo:to,quantity:2});
 assert.equal(q.cheapest.amount,925); assert.equal(q.parcelCount,1);
}));

test('Shippo quotes actual 3 parcels for six cans',()=>withFetch(async (_,opts)=>{
 const body=JSON.parse(opts.body); assert.equal(body.parcels.length,3);
 assert.ok(body.parcels.every(p=>p.weight==='1100'));
 return response({object_id:'ship_3',rates:[rate('22.75')]});
},async()=>{
 const q=await getShippingRates({token:'dummy',shipFrom:from,shipTo:to,quantity:6});
 assert.equal(q.cheapest.amount,2275); assert.equal(q.strategy,'multiparcel');
}));

test('If no combined rate, quote one box and sum actual independent box costs',()=>{
 let calls=0;
 return withFetch(async (_,opts)=>{
   calls++; let parcels=JSON.parse(opts.body).parcels;
   if(calls===1){assert.equal(parcels.length,2);return response({object_id:'ship_multi',rates:[]});}
   assert.equal(parcels.length,1); return response({object_id:'ship_single',rates:[rate('7.30')]});
 }, async()=>{
   const q=await getShippingRates({token:'dummy',shipFrom:from,shipTo:to,quantity:4});
   assert.equal(calls,2); assert.equal(q.cheapest.amount,1460);
   assert.equal(q.parcelCount,2); assert.equal(q.strategy,'separate_boxes');
 });
});

test('For three cans, missing multi-parcel rate falls back to one 1100g and one 600g box',()=>{
 let calls=0;
 return withFetch(async (_,opts)=>{
   calls++;
   const parcels=JSON.parse(opts.body).parcels;
   if (calls===1) {assert.deepEqual(parcels.map(p=>p.weight),['1100','600']);return response({object_id:'multi',rates:[]});}
   assert.equal(parcels.length,1);
   if(calls===2) {assert.equal(parcels[0].weight,'1100');return response({object_id:'double',rates:[rate('8.25')]});}
   assert.equal(parcels[0].weight,'600');return response({object_id:'single',rates:[rate('6.20')]});
 },async()=>{
   const q=await getShippingRates({token:'dummy',shipFrom:from,shipTo:to,quantity:3});
   assert.equal(calls,3);
   assert.equal(q.cheapest.amount,1445);
   assert.equal(q.parcelCount,2);
   assert.equal(q.strategy,'separate_boxes');
   assert.deepEqual(q.boxQuotes.map(b=>b.weightGrams),[1100,600]);
 });
});

test('Stripe form session includes verified six-can quantity and manual capture',()=>withFetch(async (url,opts)=>{
 assert.match(url,/api.stripe.com/);
 const p=new URLSearchParams(opts.body);
 assert.equal(p.get('line_items[0][quantity]'),'6');
 assert.equal(p.get('metadata[checkout_quantity]'),'6');
 assert.equal(p.get('payment_intent_data[capture_method]'),'manual');
 return response({client_secret:'cs-secret',id:'cs_test_abc'});
},async()=>{
 const env={STRIPE_SECRET_KEY:'sk_test_fake',STRIPE_PRICE_ID:'price_live_test'};
 const r=await createCheckoutFormSession(env,'https://checkout.example',6);
 assert.equal(r.quantity,6);
}));

test('Stripe form supports three-can order and its exact subtotal',()=>withFetch(async (url,opts)=>{
 const p=new URLSearchParams(opts.body);
 assert.equal(p.get('line_items[0][quantity]'),'3');
 assert.equal(p.get('metadata[checkout_quantity]'),'3');
 return response({client_secret:'cs-secret',id:'cs_test_abc'});
},async()=>{
 const env={STRIPE_SECRET_KEY:'sk_test_fake',STRIPE_PRICE_ID:'price_live_test'};
 const r=await createCheckoutFormSession(env,'https://checkout.example',3);
 assert.equal(r.quantity,3);
}));

test('invalid Stripe quantity rejected before API request',async()=>{
 let calls=0; await withFetch(async()=>{calls++;throw Error('should not fetch');},async()=>{
   await assert.rejects(()=>createCheckoutFormSession({STRIPE_SECRET_KEY:'sk_test_fake',STRIPE_PRICE_ID:'price_x'},'https://example.com',21),/INVALID_QUANTITY/);
 }); assert.equal(calls,0);
});

test('Checkout shipping trusts Stripe quantity, not client-side quantity',()=>{
 let calls=0;
 return withFetch(async (url,opts)=>{
   calls++;
   if(calls===1) return response({id:'cs_test_ABC123',status:'open',mode:'payment',ui_mode:'form',livemode:false,currency:'usd',amount_subtotal:18000,metadata:{checkout_flow:'borderless_shippo_preview',checkout_quantity:'4'}});
   if(calls===2) {const body=JSON.parse(opts.body); assert.equal(body.parcels.length,2);return response({object_id:'shipx',rates:[rate('17.19')]});}
   const params=new URLSearchParams(opts.body);
   assert.equal(params.get('metadata[shipping_quote_quantity]'),'4');
   assert.equal(params.get('metadata[shipping_quote_parcels]'),'2');
   assert.equal(params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),'1719');
   return response({id:'cs_test_ABC123'});
 },async()=>{
   const r=await updateCheckoutShipping({env:{STRIPE_SECRET_KEY:'sk_test_fake',SHIPPO_API_TOKEN:'shippo_test_fake',SHIP_FROM_ADDRESS_JSON:JSON.stringify(from)},sessionId:'cs_test_ABC123',shippingDetails:{name:'Customer',address:stripeAddress,quantity:100}});
   assert.equal(r.succeeded,true); assert.equal(calls,3);
 });
});

test('Authorized order verifier accepts multi-can and denies stale/bad totals',async()=>{
 for(const q of [1,2,3,4,5,6,10,19,20]) assert.equal((await review(q)).approved,true);
 let r=await review(4,{amount_total:18000});assert.equal(r.approved,false);
 r=await review(4,{metadata:{checkout_flow:'borderless_shippo_preview',checkout_quantity:'4',shipping_quote_rate_id:'r1',shipping_quote_amount_cents:'850',shipping_quote_quantity:'2'}}); assert.equal(r.approved,false);
});

test('invalid quantity blocked by test Worker before any Stripe call',async()=>{
 await withFetch(async()=>{throw Error('should not fetch');},async()=>{
   const r=await worker.fetch(new Request('https://example.com/api/checkout-form-session',{method:'POST',body:JSON.stringify({quantity:21})}),{},{});
   assert.equal(r.status,400);
 });
});

test('Shippo order sync preserves four-can quantity, subtotal and packed weight', async()=>{
  const { syncShippoOrder } = await import('../shippo-sync.js');
  const session=verifiedSession(4);
  session.metadata.shipping_quote_address_hash=await fingerprintShippingAddress(stripeAddress);
  session.created=Date.now()/1000;
  const paymentIntent={...payment(4),status:'succeeded',amount_received:18850,amount_capturable:0};
  let orderRequest=null;
  const db={prepare(sql){ return {
    bind(...params){return {
      async run(){return {meta:{changes:1}};},
      async first(){return null;}
    };}
  };}};
  let calls=0;
  await withFetch(async (url,opts={})=>{
    calls++;
    if(url.includes('/line_items?')) return response({data:[{price:{id:'price_live_test'},quantity:4,amount_subtotal:18000}],has_more:false});
    if(url.includes('/payment_intents/')) return response(paymentIntent);
    if(url.includes('/checkout/sessions/')) return response(session);
    if(url.includes('/orders/')) {
      orderRequest=JSON.parse(opts.body);return response({object_id:'shippo_order_test'});
    }
    throw Error(`Unmocked route: ${url}`);
  }, async()=>{
    const env={SHIPPO_API_TOKEN:'shippo_test_fake',STRIPE_SECRET_KEY:'sk_test_fake',SHIP_FROM_ADDRESS_JSON:JSON.stringify(from),STRIPE_PRICE_ID:'price_live_test',ORDERS_DB:db};
    const result=await syncShippoOrder(env,'pi_A1','cs_test_a1');
    assert.equal(result.synced,true);
    assert.equal(orderRequest.line_items[0].quantity,4);
    assert.equal(orderRequest.line_items[0].total_price,'180.00');
    assert.equal(orderRequest.subtotal_price,'180.00');
    assert.equal(orderRequest.weight,'2200');
    assert.equal(orderRequest.shipping_cost,'8.50');
    assert.ok(calls >= 5);
  });
});
