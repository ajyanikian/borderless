
const SHIPPING_RATES = {
  1: 895,   // $8.95 for 1 can
  2: 1195,  // $11.95 for 2 cans
  3: 1495   // $14.95 for 3 cans
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Check that our backend is working
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        service: "borderless-checkout"
      });
    }

    // Create a Stripe checkout
    if (url.pathname === "/api/checkout") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const body = await request.json().catch(() => null);
      const quantity = Number(body?.quantity);

      if (!Number.isInteger(quantity) || !SHIPPING_RATES[quantity]) {
        return Response.json(
          { error: "Select between 1 and 3 cans." },
          { status: 400 }
        );
      }

      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
        return Response.json(
          { error: "Stripe checkout is not configured yet." },
          { status: 503 }
        );
      }

      const params = new URLSearchParams();

      params.set("mode", "payment");
      params.set("line_items[0][price]", env.STRIPE_PRICE_ID);
      params.set("line_items[0][quantity]", String(quantity));

      params.set(
        "shipping_address_collection[allowed_countries][0]",
        "US"
      );

      params.set(
        "shipping_options[0][shipping_rate_data][type]",
        "fixed_amount"
      );
      params.set(
        "shipping_options[0][shipping_rate_data][display_name]",
        "Standard Shipping"
      );
      params.set(
        "shipping_options[0][shipping_rate_data][fixed_amount][currency]",
        "usd"
      );
      params.set(
        "shipping_options[0][shipping_rate_data][fixed_amount][amount]",
        String(SHIPPING_RATES[quantity])
      );

      params.set("customer_creation", "always");
      params.set(
        "success_url",
        `${url.origin}/?checkout=success#shop`
      );
      params.set("cancel_url", `${url.origin}/#shop`);

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

      const session = await response.json();

      if (!response.ok || !session.url) {
        console.error("Stripe checkout error", session.error);
        return Response.json(
          { error: "Unable to start checkout." },
          { status: 502 }
        );
      }

      return Response.json(
        { url: session.url },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Keep serving the existing Borderless website
    return env.ASSETS.fetch(request);
  }
};
