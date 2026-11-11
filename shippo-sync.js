import { reviewStripeOrder } from "./stripe-order-review.js";

// Synchronize one already-paid, verified preview order with Shippo.
// This creates an ORDER, not a postage label.
export async function syncShippoOrder(env, paymentIntentId, checkoutSessionId) {
  if (!env.SHIPPO_API_TOKEN?.startsWith("shippo_test_") ||
      !env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("TEST_KEYS_REQUIRED");
  }

  // Atomic claim prevents competing webhook deliveries from duplicating orders.
  const claim = await env.ORDERS_DB.prepare(`
    UPDATE orders
    SET shippo_sync_state = 'creating',
        shippo_sync_started_at = datetime('now'),
        updated_at = datetime('now')
    WHERE payment_intent_id = ? AND checkout_session_id = ?
      AND status = 'paid' AND shippo_sync_state = 'pending'
      AND shippo_order_id IS NULL
  `).bind(paymentIntentId, checkoutSessionId).run();
  if (claim.meta?.changes !== 1) return { skipped: true };

  try {
    // Fresh Stripe verification even though this came from a signed webhook.
    const review = await reviewStripeOrder(env, {
      type: "checkout.session.completed",
      data: { object: { id: checkoutSessionId } }
    });
    if (!review.approved || !review.alreadyCaptured ||
        review.paymentIntentId !== paymentIntentId) {
      throw new Error("PAID_ORDER_RECHECK_FAILED");
    }

    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkoutSessionId)}`,
      { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
    );
    if (!response.ok) throw new Error(`STRIPE_SESSION_${response.status}`);
    const session = await response.json();
    const shipping = session.collected_information?.shipping_details || session.shipping_details;
    const address = shipping?.address;
    if (!address?.line1 || !address?.city || !address?.state ||
        !address?.postal_code || address?.country !== "US") {
      throw new Error("SHIPPING_ADDRESS_INCOMPLETE");
    }

    const sender = JSON.parse(env.SHIP_FROM_ADDRESS_JSON || "null");
    if (!sender?.street1 || !sender?.zip) throw new Error("SHIP_FROM_MISSING");

    const toAddress = {
      name: shipping?.name || session.customer_details?.name || "Borderless Customer",
      street1: address.line1,
      street2: address.line2 || "",
      city: address.city,
      state: address.state,
      zip: address.postal_code,
      country: address.country,
      email: session.customer_details?.email || undefined,
      phone: session.customer_details?.phone || undefined
    };

    const order = {
      order_number: paymentIntentId,
      order_status: "PAID",
      placed_at: new Date(session.created * 1000).toISOString(),
      to_address: toAddress,
      from_address: sender,
      currency: "USD",
      subtotal_price: "45.00",
      shipping_cost: (session.shipping_cost.amount_total / 100).toFixed(2),
      shipping_cost_currency: "USD",
      total_price: (session.amount_total / 100).toFixed(2),
      total_tax: "0.00",
      weight: "600",
      weight_unit: "g",
      line_items: [{ title: "Palestinian Olive Oil, 500 mL", quantity: 1,
        total_price: "45.00", currency: "USD" }]
    };

    const shippo = await fetch("https://api.goshippo.com/orders/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${env.SHIPPO_API_TOKEN}`,
        "Content-Type": "application/json",
        "SHIPPO-API-VERSION": "2018-02-08"
      },
      body: JSON.stringify(order)
    });
    const result = await shippo.json().catch(() => null);
    if (!shippo.ok || !result?.object_id) {
      throw new Error(`SHIPPO_ORDER_${shippo.status}`);
    }
    await env.ORDERS_DB.prepare(`
      UPDATE orders SET shippo_order_id = ?, shippo_sync_state = 'created',
        last_error = NULL, updated_at = datetime('now')
      WHERE payment_intent_id = ? AND shippo_sync_state = 'creating'
    `).bind(result.object_id, paymentIntentId).run();
    console.log("BORDERLESS_SHIPPO_ORDER_CREATED", paymentIntentId, result.object_id);
    return { synced: true };
  } catch (error) {
    // Do not auto-retry: an uncertain network result can otherwise create duplicates.
    await env.ORDERS_DB.prepare(`
      UPDATE orders SET shippo_sync_state = 'needs_review', last_error = ?,
        updated_at = datetime('now')
      WHERE payment_intent_id = ? AND shippo_sync_state = 'creating'
    `).bind(String(error.message).slice(0, 160), paymentIntentId).run();
    console.error("BORDERLESS_SHIPPO_SYNC_ERROR", paymentIntentId, error.message);
    return { synced: false };
  }
}
