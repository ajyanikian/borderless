
/*
 * Borderless Shipping Engine
 *
 * Shipping provider: Shippo
 * Payment provider: Stripe
 *
 * Responsibilities:
 * - Validate shipping information
 * - Request carrier shipping quotes
 * - Return available rates
 *
 * Never purchases shipping labels.
 * Never handles payment information.
 */

import { packedParcels, validQuantity } from "./quantity.js";

export function getPackage(quantity) {
  if (!validQuantity(quantity) || quantity > 2) {
    throw new Error("This helper handles one physical box only");
  }
  return packedParcels(quantity)[0];
}

export function validateAddress(address) {
  if (!address || typeof address !== "object") {
    throw new Error("Shipping address is required");
  }

  const required = [
    "name", "street1", "city",
    "state", "zip", "country"
  ];

  for (const field of required) {
    if (
      typeof address[field] !== "string" ||
      !address[field].trim()
    ) {
      throw new Error(`Missing address field: ${field}`);
    }
  }

  if (address.country.toUpperCase() !== "US") {
    throw new Error("Only US shipping is supported");
  }

  if (!/^\d{5}(-\d{4})?$/.test(address.zip)) {
    throw new Error("Invalid US ZIP code");
  }

  return true;
}

// Ask Shippo for an actual quote for the supplied parcel list.
async function quoteShipment({ token, shipFrom, shipTo, parcels }) {
  const response = await fetch("https://api.goshippo.com/shipments/", {
    method: "POST",
    headers: {
      Authorization: `ShippoToken ${token}`,
      "Content-Type": "application/json",
      "SHIPPO-API-VERSION": "2018-02-08"
    },
    body: JSON.stringify({
      address_from: shipFrom,
      address_to: shipTo,
      parcels,
      async: false
    })
  });

  if (!response.ok) throw new Error(`SHIPPO_HTTP_${response.status}`);
  const shipment = await response.json();
  const rates = (shipment.rates || [])
    .filter(rate => rate.currency === "USD" &&
      Number.isFinite(Number(rate.amount)) && Number(rate.amount) > 0 &&
      typeof rate.object_id === "string" && rate.object_id.length > 0)
    .map(rate => ({
      id: rate.object_id,
      carrier: rate.provider,
      service: rate.servicelevel?.name || "Standard",
      amount: Math.round(Number(rate.amount) * 100)
    }))
    .sort((a, b) => a.amount - b.amount);

  return { shipmentId: shipment.object_id, rates, cheapest: rates[0] || null };
}

export async function getShippingRates({ token, shipFrom, shipTo, quantity }) {
  if (!token) throw new Error("Shippo API token is missing");
  validateAddress(shipFrom);
  validateAddress(shipTo);

  // No parcel count or weight can be supplied by the client.
  const parcels = packedParcels(quantity);
  const combined = await quoteShipment({ token, shipFrom, shipTo, parcels });
  if (combined.cheapest) {
    return { ...combined, strategy: "multiparcel", parcelCount: parcels.length };
  }

  if (parcels.length === 1) throw new Error("No shipping rates available");

  // Some carriers do not return multi-piece rates. Quote a single 2-can
  // box, then charge for the actual number of individual boxes to be sent.
  // Labels remain manual and EACH parcel requires its own postage label.
  const separate = await quoteShipment({
    token, shipFrom, shipTo, parcels: [parcels[0]]
  });
  if (!separate.cheapest) throw new Error("No shipping rates available");
  return {
    ...separate,
    cheapest: {
      ...separate.cheapest,
      amount: separate.cheapest.amount * parcels.length,
      service: `${separate.cheapest.service} (${parcels.length} boxes)`
    },
    strategy: "separate_boxes",
    parcelCount: parcels.length
  };
}
