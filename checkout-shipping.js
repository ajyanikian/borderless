
import { getShippingRates } from "./shipping.js";

/*
 * Borderless Checkout Shipping
 *
 * Calculates postage through Shippo,
 * then updates a Stripe Checkout Session.
 *
 * Development only. One-can orders.
 */

export async function updateCheckoutShipping({
  env,
  sessionId,
  shippingDetails
}) {
  if (
    !env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ||
    !env.SHIPPO_API_TOKEN?.startsWith("shippo_test_")
  ) {
    throw new Error("TEST_MODE_REQUIRED");
  }

  if (
    typeof sessionId !== "string" ||
    !/^cs_test_[A-Za-z0-9]+$/.test(sessionId)
  ) {
    throw new Error("INVALID_SESSION");
  }

  // Verify the checkout before updating it.
  const sessionResponse = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
      }
    }
  );

  if (!sessionResponse.ok) {
    throw new Error("SESSION_LOOKUP_FAILED");
  }

  const session = await sessionResponse.json();

  if (
    session.status !== "open" ||
    session.mode !== "payment" ||
    session.ui_mode !== "form" ||
    session.livemode !== false ||
    session.currency !== "usd" ||
    session.amount_subtotal !== 4500 ||
    session.metadata?.checkout_flow !==
      "borderless_shippo_preview"
  ) {
    throw new Error("SESSION_NOT_ELIGIBLE");
  }

  // Convert Stripe's address format to Shippo's.
  const address = shippingDetails?.address;

  if (!address || !shippingDetails?.name) {
    throw new Error("ADDRESS_INCOMPLETE");
  }

  const shipTo = {
    name: shippingDetails.name,
    street1: address.line1,
    street2: address.line2 || "",
    city: address.city,
    state: address.state,
    zip: address.postal_code,
    country: address.country
  };

  // Read the private sender address from Cloudflare.
  let shipFrom;

  try {
    shipFrom = JSON.parse(env.SHIP_FROM_ADDRESS_JSON);
  } catch {
    throw new Error("SENDER_NOT_CONFIGURED");
  }

  // Request a shipping quote for one can.
  const quote = await getShippingRates({
    token: env.SHIPPO_API_TOKEN,
    shipFrom,
    shipTo,
    quantity: 1
  });

  const shippingAmount = quote.cheapest.amount;

  if (
    !Number.isInteger(shippingAmount) ||
    shippingAmount <= 0 ||
    shippingAmount > 10000
  ) {
    throw new Error("INVALID_SHIPPING_RATE");
  }

  // Replace the initial Stripe shipping option.
  const params = new URLSearchParams();

  params.set(
    "shipping_options[0][shipping_rate_data][type]",
    "fixed_amount"
  );

  params.set(
    "shipping_options[0][shipping_rate_data][display_name]",
    `${quote.cheapest.carrier} ${quote.cheapest.service}`
  );

  params.set(
    "shipping_options[0][shipping_rate_data][fixed_amount][currency]",
    "usd"
  );

  params.set(
    "shipping_options[0][shipping_rate_data][fixed_amount][amount]",
    String(shippingAmount)
  );

  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    }
  );

  if (!response.ok) {
    throw new Error("STRIPE_SHIPPING_UPDATE_FAILED");
  }

  return {
    succeeded: true
  };
}
