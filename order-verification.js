
import {
  fingerprintShippingAddress
} from "./checkout-shipping.js";

const PRODUCT_PRICE_CENTS = 4500;

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

  // Test-mode Borderless orders only.
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

  // Verify the actual Stripe product and quantity.
  if (
    !expectedPriceId?.startsWith("price_") ||
    !Array.isArray(lineItems) ||
    lineItems.length !== 1 ||
    lineItems[0].price?.id !== expectedPriceId ||
    lineItems[0].quantity !== 1 ||
    lineItems[0].amount_subtotal !== PRODUCT_PRICE_CENTS
  ) {
    return reject("INVALID_PRODUCT");
  }

  const shipping =
    Number(session.metadata?.shipping_quote_amount_cents);

  if (
    !Number.isInteger(shipping) ||
    shipping <= 0 ||
    shipping > 10000 ||
    !session.metadata?.shipping_quote_rate_id ||
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

  const expectedTotal =
    PRODUCT_PRICE_CENTS + shipping;

  if (
    session.currency !== "usd" ||
    paymentIntent.currency !== "usd" ||
    session.amount_subtotal !== PRODUCT_PRICE_CENTS ||
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
  paymentIntentId: paymentIntent.id
};

}
