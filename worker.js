
import { updateCheckoutShipping } from "./checkout-shipping.js";

import { createCheckoutFormSession } from "./checkout-embedded.js";

import { getShippingRates } from "./shipping.js";

import { reviewStripeOrder } from "./stripe-order-review.js";

import { saveCapturedOrder } from "./order-store.js";
import { syncShippoOrder } from "./shippo-sync.js";


const SHIPPING_RATES = {
  1: 895,
  2: 1195,
  3: 1495
};

// Verify incoming Stripe webhook signatures
async function verifyStripeSignature(body, header, secret) {
  if (!header || !secret) return false;

  const parts = header.split(",").map(p => p.trim());

  const timestamp = parts
    .find(p => p.startsWith("t="))
    ?.slice(2);

  const signatures = parts
    .filter(p => p.startsWith("v1="))
    .map(p => p.slice(3));

  if (!timestamp || !/^\d+$/.test(timestamp)) {
    return false;
  }

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return false;
  }

  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signedBody = encoder.encode(
    `${timestamp}.${body}`
  );

  for (const hex of signatures) {
    if (!/^[0-9a-f]{64}$/i.test(hex)) continue;

    const bytes = new Uint8Array(
      hex.match(/.{2}/g).map(part => parseInt(part, 16))
    );

    if (await crypto.subtle.verify(
      "HMAC", key, bytes, signedBody
    )) {
      return true;
    }
  }

  return false;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    



    // Create a Stripe Embedded Checkout test session
    
if (url.pathname === "/api/checkout-shipping") {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405
    });
  }

  try {
    const data = await request.json();

    if (
      typeof data?.checkout_session_id !== "string" ||
      !data?.shipping_details
    ) {
      return Response.json({
        type: "error",
        message: "Missing checkout or shipping details"
      }, { status: 400 });
    }

    const result = await updateCheckoutShipping({
      env,
      sessionId: data.checkout_session_id,
      shippingDetails: data.shipping_details
    });

    return Response.json({
      type: "object",
      value: result
    }, {
      headers: { "Cache-Control": "no-store" }
    });

  } catch (error) {
    console.error(
      "Checkout shipping update failed:",
      error?.message || "UNKNOWN"
    );

    return Response.json({
      type: "error",
      message: "Shipping is unavailable. Please try again."
    }, { status: 422 });
  }
}

    if (url.pathname === "/api/checkout-form-session") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405
        });
      }

      try {
        const session = await createCheckoutFormSession(
          env,
          url.origin
        );

        return Response.json(
          { clientSecret: session.clientSecret },
          {
            headers: {
              "Cache-Control": "no-store"
            }
          }
        );

} catch (error) {
  const message = String(error?.message || "");

  let reason = "SERVER_ERROR";

  if (message === "Stripe test key required") {
    reason = "STRIPE_TEST_KEY_REQUIRED";
  } else if (message === "Stripe test price not configured") {
    reason = "STRIPE_PRICE_NOT_CONFIGURED";
  } else if (message === "Unable to create test checkout session") {
    reason = "STRIPE_REQUEST_FAILED";
  }

  console.error("Checkout initialization:", reason);


return Response.json({
  error: "Unable to initialize checkout",
  reason,
  stripeStatus: error.stripeStatus || null,
  stripeCode: error.stripeCode || null,
  stripeParam: error.stripeParam || null
}, { status: 502 });

}

    }

    // Development-only Shippo shipping quote test
    // Remove before merging into production
    if (url.pathname === "/api/shippo-rate-test") {
      if (!env.SHIPPO_API_TOKEN?.startsWith("shippo_test_")) {
        return new Response("Test mode required", {
          status: 403
        });
      }

      try {
        const shipFrom = JSON.parse(
          env.SHIP_FROM_ADDRESS_JSON || "null"
        );

        const result = await getShippingRates({
          token: env.SHIPPO_API_TOKEN,
          shipFrom,
          shipTo: {
            name: "Borderless Test",
            street1: "350 7th Ave",
            city: "New York",
            state: "NY",
            zip: "10001",
            country: "US"
          },
          quantity: 1
        });

        return Response.json({
          destination: "New York, 10001",
          package: "1 can, 600 g",
          cheapest: result.cheapest,
          availableRates: result.rates
        }, {
          headers: { "Cache-Control": "no-store" }
        });


} catch (error) {
  console.error("Shippo rate test:", error);

  const message = String(error?.message || "");

  let reason = "UNKNOWN_ERROR";

  if (/^SHIPPO_HTTP_\d{3}$/.test(message)) {
    reason = message;
  } else if (message === "No shipping rates available") {
    reason = "NO_AVAILABLE_RATES";
  } else if (message.startsWith("Missing address field:")) {
    reason = "ADDRESS_INCOMPLETE";
  } else if (error instanceof SyntaxError) {
    reason = "INVALID_SENDER_JSON";
  }

  return Response.json({
    error: "Unable to calculate test shipping quote",
    reason
  }, { status: 502 });
}

    }

    
    // Test the connection to Shippo
    if (url.pathname === "/api/shippo-check") {
      if (!env.SHIPPO_API_TOKEN) {
        return Response.json(
          { shippo: "token_missing" },
          { status: 503 }
        );
      }

      try {
        const response = await fetch(
          "https://api.goshippo.com/carrier_accounts/",
          {
            headers: {
              Authorization: `ShippoToken ${env.SHIPPO_API_TOKEN}`,
              "SHIPPO-API-VERSION": "2018-02-08"
            }
          }
        );

        return Response.json({
          shippo: response.ok ? "connected" : "error",
          api_status: response.status
        });

      } catch {
        return Response.json(
          { shippo: "connection_failed" },
          { status: 502 }
        );
      }
    }

    // Receive Stripe payment notifications
    if (url.pathname === "/api/stripe-webhook") {
      if (request.method !== "POST") {
        return new Response(
          "Method not allowed",
          { status: 405 }
        );
      }

      if (!env.STRIPE_WEBHOOK_SECRET) {
        return new Response(
          "Webhook not configured",
          { status: 503 }
        );
      }

      const rawBody = await request.text();

      const valid = await verifyStripeSignature(
        rawBody,
        request.headers.get("Stripe-Signature"),
        env.STRIPE_WEBHOOK_SECRET
      );

      if (!valid) {
        return new Response(
          "Invalid signature",
          { status: 400 }
        );
      }

      let event;

      try {
        event = JSON.parse(rawBody);
      } catch {
        return new Response(
          "Invalid JSON",
          { status: 400 }
        );
      }

      const session = event.data?.object;

      const paid =
        (
          event.type === "checkout.session.completed" &&
          session?.payment_status === "paid"
        ) ||
        (
          event.type ===
            "checkout.session.async_payment_succeeded"
        );


if (paid) {
  console.log(
    "Verified paid Stripe checkout:",
    session?.id,
    event.id
  );
}

// Independently verify authorized Borderless orders.

if (event.type === "checkout.session.completed") {
  try {
    const review = await reviewStripeOrder(env, event);

    if (!review.approved) {
      console.warn(
        "BORDERLESS_ORDER_REJECTED",
        review.reason
      );
    

} else if (review.alreadyCaptured) {
  await saveCapturedOrder(env, {
    paymentIntentId: review.paymentIntentId,
    checkoutSessionId: event.data.object.id
  });

  console.log(
    "BORDERLESS_ORDER_SAVED",
    review.paymentIntentId
  );
  ctx.waitUntil(syncShippoOrder(env, review.paymentIntentId, event.data.object.id));

} else {
  const response = await fetch(

        `https://api.stripe.com/v1/payment_intents/${review.paymentIntentId}/capture`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key":
              `borderless-preview-capture-${review.paymentIntentId}`
          },
          body: new URLSearchParams({
            amount_to_capture: String(review.amountCents)
          })
        }
      );

      const payment = await response.json().catch(() => null);

      if (!response.ok || payment?.status !== "succeeded") {
        console.error(
          "BORDERLESS_CAPTURE_FAILED",
          response.status,
          payment?.error?.code || "UNKNOWN"
        );

        return new Response("Capture failed", {
          status: 503
        });
      }


await saveCapturedOrder(env, {
  paymentIntentId: review.paymentIntentId,
  checkoutSessionId: event.data.object.id
});

console.log(
  "BORDERLESS_PAYMENT_CAPTURED_AND_SAVED",
  review.paymentIntentId,
  review.amountCents
);
ctx.waitUntil(syncShippoOrder(env, review.paymentIntentId, event.data.object.id));

    }
  } catch (error) {
    console.error(
      "BORDERLESS_PROCESSING_ERROR",
      error.message
    );

    return new Response("Processing failed", {
      status: 503
    });
  }
}

return new Response("ok", { status: 200 });

    }

    // Backend health check
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        service: "borderless-checkout"
      });
    }

    // Create Stripe Checkout Session
    if (url.pathname === "/api/checkout") {
      if (request.method !== "POST") {
        return new Response(
          "Method not allowed",
          { status: 405 }
        );
      }

      const body = await request.json()
        .catch(() => null);

      const quantity = Number(body?.quantity);

      if (
        !Number.isInteger(quantity) ||
        !SHIPPING_RATES[quantity]
      ) {
        return Response.json(
          { error: "Select between 1 and 3 cans." },
          { status: 400 }
        );
      }

      if (
        !env.STRIPE_SECRET_KEY ||
        !env.STRIPE_PRICE_ID
      ) {
        return Response.json(
          {
            error: "Stripe checkout is not configured yet."
          },
          { status: 503 }
        );
      }

      const params = new URLSearchParams();

      params.set("mode", "payment");

      params.set(
        "line_items[0][price]",
        env.STRIPE_PRICE_ID
      );

      params.set(
        "line_items[0][quantity]",
        String(quantity)
      );

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

      params.set(
        "cancel_url",
        `${url.origin}/#shop`
      );

      const response = await fetch(
        "https://api.stripe.com/v1/checkout/sessions",
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Content-Type":
              "application/x-www-form-urlencoded"
          },
          body: params
        }
      );

      const session = await response.json();

      if (!response.ok || !session.url) {
        console.error(
          "Stripe checkout error",
          session.error
        );

        return Response.json(
          { error: "Unable to start checkout." },
          { status: 502 }
        );
      }

      return Response.json(
        { url: session.url },
        {
          headers: {
            "Cache-Control": "no-store"
          }
        }
      );
    }

    // Serve the existing Borderless website
    return env.ASSETS.fetch(request);
  }
};
