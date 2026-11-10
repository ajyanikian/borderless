
import { verifyAuthorizedOrder } from "./order-verification.js";

export async function reviewStripeOrder(env, event) {
  if (event?.type !== "checkout.session.completed") {
    return { approved: false, reason: "EVENT_NOT_APPLICABLE" };
  }

  if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("TEST_KEY_REQUIRED");
  }

  const sessionId = event.data?.object?.id;

  if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId || "")) {
    throw new Error("INVALID_SESSION_ID");
  }

  async function stripeGet(path) {
    const response = await fetch(
      `https://api.stripe.com/v1/${path}`,
      {
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`STRIPE_LOOKUP_${response.status}`);
    }

    return response.json();
  }

  // Always retrieve fresh data from Stripe.
  const session = await stripeGet(
    `checkout/sessions/${sessionId}`
  );

  const items = await stripeGet(
    `checkout/sessions/${sessionId}/line_items?limit=2`
  );

  if (items.has_more) {
    return {
      approved: false,
      reason: "TOO_MANY_LINE_ITEMS"
    };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId || "")) {
    return {
      approved: false,
      reason: "MISSING_PAYMENT_INTENT"
    };
  }

  const paymentIntent = await stripeGet(
    `payment_intents/${paymentIntentId}`
  );

  return verifyAuthorizedOrder({
    session,
    paymentIntent,
    lineItems: items.data,
    expectedPriceId: env.STRIPE_PRICE_ID
  });
}
