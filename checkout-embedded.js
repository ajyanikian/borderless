
/*
 * Borderless Checkout
 *
 * Creates a Stripe Checkout Form session.
 * Shipping rates will be supplied by Shippo
 * after the customer enters a delivery address.
 *
 * Test environment only.
 */

export async function createCheckoutFormSession(env, origin) {
  // Never allow live charges during development.
  if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("Stripe test key required");
  }

  if (!env.STRIPE_PRICE_ID?.startsWith("price_")) {
    throw new Error("Stripe test price not configured");
  }

  const params = new URLSearchParams();

  params.set("mode", "payment");
  params.set("ui_mode", "form");

  // Only one can until other package profiles are verified.
  params.set("line_items[0][price]", env.STRIPE_PRICE_ID);
  params.set("line_items[0][quantity]", "1");

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
    "/?checkout=return#shop",
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
    console.error(
      "Stripe session creation failed",
      response.status,
      session?.error?.code || "UNKNOWN"
    );

    throw new Error("Unable to create test checkout session");
  }

  return {
    clientSecret: session.client_secret,
    sessionId: session.id
  };
}
