
import {
  fingerprintShippingAddress
} from "./checkout-shipping.js";

import {
  UNIT_PRICE_CENTS, quantityFromSession, parcelCount
} from "./quantity.js";

export async function verifyAuthorizedOrder({
  session,
  paymentIntent,
  lineItems,
  expectedPriceId
}) {
  const reject = (reason) => ({
    approved: false,
    reason
  });

  // Live Borderless orders from the verified Stripe and Shippo workflow only.
  if (
    session?.livemode !== false ||
    paymentIntent?.livemode !== false ||
    session?.metadata?.checkout_flow !==
      "borderless_shippo_preview"
  ) {
    return reject("INVALID_CHECKOUT");
  }

  if (
    session.status !== "complete" ||
    session.mode !== "payment" ||
    !["requires_capture", "succeeded"].includes(paymentIntent.status) ||
    paymentIntent.capture_method !== "manual"
  ) {
    return reject("INVALID_PAYMENT_STATE");
  }

  const paymentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (paymentId !== paymentIntent.id) {
    return reject("PAYMENT_MISMATCH");
  }

  // Stripe is authoritative: verify quantity, price ID and subtotal.
  const quantity = quantityFromSession(session);
  const subtotal = quantity * UNIT_PRICE_CENTS;
  if (
    !quantity || !expectedPriceId?.startsWith("price_") ||
    !Array.isArray(lineItems) || lineItems.length !== 1 ||
    lineItems[0].price?.id !== expectedPriceId ||
    lineItems[0].quantity !== quantity ||
    lineItems[0].amount_subtotal !== subtotal
  ) {
    return reject("INVALID_PRODUCT");
  }

  const shipping =
    Number(session.metadata?.shipping_quote_amount_cents);

  if (
    !Number.isInteger(shipping) ||
    shipping <= 0 ||
    shipping > 10000 * parcelCount(quantity) ||
    !session.metadata?.shipping_quote_rate_id ||
    (session.metadata?.shipping_quote_quantity != null &&
      session.metadata.shipping_quote_quantity !== String(quantity)) ||
    (session.metadata?.shipping_quote_parcels != null &&
      session.metadata.shipping_quote_parcels !== String(parcelCount(quantity))) ||
    (quantity > 1 && (
      session.metadata?.shipping_quote_quantity !== String(quantity) ||
      !["multiparcel", "separate_boxes"].includes(
        session.metadata?.shipping_quote_strategy))) ||
    session.total_details?.amount_shipping !== shipping ||
    session.shipping_cost?.amount_total !== shipping
  ) {
    return reject("SHIPPING_MISMATCH");
  }

  // Find the final address stored by Stripe.
  const finalAddress =
    session.collected_information?.shipping_details?.address ||
    session.shipping_details?.address;

  if (!finalAddress) {
    return reject("MISSING_SHIPPING_ADDRESS");
  }

  const finalAddressHash =
    await fingerprintShippingAddress(finalAddress);

  if (
    finalAddressHash !==
    session.metadata?.shipping_quote_address_hash
  ) {
    return reject("SHIPPING_ADDRESS_CHANGED");
  }

  // Tax calculation is not yet configured.
  // Do not approve taxed orders until we implement it.
  if (session.total_details?.amount_tax !== 0) {
    return reject("TAX_NOT_CONFIGURED");
  }

  const expectedTotal = subtotal + shipping;

  if (
    session.currency !== "usd" ||
    paymentIntent.currency !== "usd" ||
    session.amount_subtotal !== subtotal ||
    session.amount_total !== expectedTotal ||
    paymentIntent.amount !== expectedTotal ||
    
(
  paymentIntent.status === "requires_capture"
    ? paymentIntent.amount_capturable !== expectedTotal
    : paymentIntent.amount_received !== expectedTotal ||
      paymentIntent.amount_capturable !== 0
)

  ) {
    return reject("AMOUNT_MISMATCH");
  }

  
return {
  approved: true,
  alreadyCaptured: paymentIntent.status === "succeeded",
  amountCents: expectedTotal,
  quantity,
  paymentIntentId: paymentIntent.id
};

}
