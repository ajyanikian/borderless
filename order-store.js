
export async function saveCapturedOrder(env, {
  paymentIntentId,
  checkoutSessionId
}) {
  if (!env.ORDERS_DB) {
    throw new Error("ORDERS_DB_NOT_CONFIGURED");
  }

  if (
    !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId || "") ||
    !/^cs_test_[A-Za-z0-9]+$/.test(checkoutSessionId || "")
  ) {
    throw new Error("INVALID_ORDER_IDS");
  }

  await env.ORDERS_DB.prepare(`
    INSERT INTO orders (
      payment_intent_id,
      checkout_session_id,
      status
      shippo_sync_state
    )
    VALUES (?, ?, 'paid', 'pending')
    ON CONFLICT(payment_intent_id) DO NOTHING
  `).bind(paymentIntentId, checkoutSessionId).run();

  const order = await env.ORDERS_DB.prepare(`
    SELECT checkout_session_id, status
    FROM orders
    WHERE payment_intent_id = ?
  `).bind(paymentIntentId).first();

  if (order?.checkout_session_id !== checkoutSessionId) {
    throw new Error("ORDER_SESSION_MISMATCH");
  }

  return order;
}
