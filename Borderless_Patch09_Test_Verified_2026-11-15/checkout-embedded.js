
/*
 * Borderless Checkout
 *
 * Creates a Stripe Checkout Form session.
 * Shipping rates will be supplied by Shippo
 * after the customer enters a delivery address.
 *
 * Test environment only. Never accepts live credentials.
 */

import { validQuantity } from "./quantity.js";

export async function createCheckoutFormSession(env, origin, quantity) {
  if (!validQuantity(quantity)) {
    throw new Error("INVALID_QUANTITY");
  }
  if (!/^sk_test_/.test(env.STRIPE_SECRET_KEY || "")) {
    throw new Error("Stripe test key required");
  }

  if (!env.STRIPE_PRICE_ID?.startsWith("price_")) {
    throw new Error("Stripe test price not configured");
  }

  const params = new URLSearchParams();

  params.set("mode", "payment");
  params.set("allowed_payment_method_types[0]", "card");
  
params.set(
  "payment_intent_data[capture_method]",
  "manual"
);

  params.set("ui_mode", "form");

params.set(
  "metadata[checkout_flow]",
  "borderless_shippo_preview"
);

  // Stripe, not the browser, calculates the payable subtotal.
  params.set("line_items[0][price]", env.STRIPE_PRICE_ID);
  params.set("line_items[0][quantity]", String(quantity));
  params.set("metadata[checkout_quantity]", String(quantity));

  // United States shipping only.
  params.set(
    "shipping_address_collection[allowed_countries][0]",
    "US"
  );

  // Temporary placeholder required by Stripe.
  // This must be replaced with a Shippo rate
  // before the checkout is made available.
  params.set(
    "shipping_options[0][shipping_rate_data][type]",
    "fixed_amount"
  );
  params.set(
    "shipping_options[0][shipping_rate_data][display_name]",
    "Shipping calculation pending"
  );
  params.set(
    "shipping_options[0][shipping_rate_data][fixed_amount][currency]",
    "usd"
  );
  params.set(
    "shipping_options[0][shipping_rate_data][fixed_amount][amount]",
    "0"
  );


  const returnUrl = new URL(
    "/thank-you.html?session_id={CHECKOUT_SESSION_ID}",
    origin
  );

  params.set("return_url", returnUrl.toString());

  const response = await fetch(
    "https://api.stripe.com/v1/checkout/sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    }
  );

  const session = await response.json().catch(() => null);


if (!response.ok || !session?.client_secret) {
  const error = new Error(
    "Unable to create test checkout session"
  );

  error.stripeStatus = response.status;
  error.stripeCode = session?.error?.code || "UNKNOWN";
  error.stripeParam = session?.error?.param || "none";

  throw error;
}


  return {
    clientSecret: session.client_secret,
    sessionId: session.id,
    quantity
  };
}
