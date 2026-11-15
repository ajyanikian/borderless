/*
 * Borderless multi-can quantity and packing rules.
 * Launch-safe limit: 20 cans (10 parcels). Increase only after testing
 * larger parcel counts and operational handling with Shippo/carriers.
 * Allowed: one can, or an even number of cans.
 */
export const UNIT_PRICE_CENTS = 4500;
export const MAX_CANS = 20;

export function validQuantity(quantity) {
  return Number.isInteger(quantity) &&
    quantity >= 1 && quantity <= MAX_CANS &&
    (quantity === 1 || quantity % 2 === 0);
}

export function packedParcels(quantity) {
  if (!validQuantity(quantity)) {
    throw new Error("UNSUPPORTED_QUANTITY");
  }

  const parcel = (weight) => ({
    length: "8", width: "6", height: "4", distance_unit: "in",
    weight: String(weight), mass_unit: "g"
  });

  if (quantity === 1) return [parcel(600)];
  return Array.from({ length: quantity / 2 }, () => parcel(1100));
}

export function packedWeightGrams(quantity) {
  return packedParcels(quantity)
    .reduce((weight, parcel) => weight + Number(parcel.weight), 0);
}

export function parcelCount(quantity) {
  return packedParcels(quantity).length;
}

export function quantityFromSession(session) {
  const raw = session?.metadata?.checkout_quantity;
  // Backward compatibility for previously created, verified one-can sessions.
  if (raw == null || raw === "") {
    return session?.amount_subtotal === UNIT_PRICE_CENTS ? 1 : null;
  }
  const quantity = Number(raw);
  return validQuantity(quantity) && String(quantity) === raw &&
    session.amount_subtotal === quantity * UNIT_PRICE_CENTS
    ? quantity : null;
}
