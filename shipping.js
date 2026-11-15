
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

  // Some carriers provide no multi-piece rate. Quote each DISTINCT
  // physical box size/weight, then multiply its rate by that box count.
  // This matters for 3, 5, 7 ... cans: the last box holds only one can.
  // Labels remain manual and EACH parcel requires its own postage label.
  const groups = new Map();
  for (const item of parcels) {
    const key = JSON.stringify(item);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { parcel: item, count: 1 });
  }

  let amount = 0;
  let firstQuote = null;
  const boxQuotes = [];
  for (const { parcel, count } of groups.values()) {
    const quote = await quoteShipment({
      token, shipFrom, shipTo, parcels: [parcel]
    });
    if (!quote.cheapest) throw new Error("No shipping rates available");
    firstQuote ??= quote;
    amount += quote.cheapest.amount * count;
    boxQuotes.push({
      weightGrams: Number(parcel.weight),
      count,
      rateId: quote.cheapest.id,
      amountCentsPerBox: quote.cheapest.amount
    });
  }

  return {
    ...firstQuote,
    cheapest: {
      ...firstQuote.cheapest,
      amount,
      carrier: boxQuotes.length > 1 ? "Multi-box" : firstQuote.cheapest.carrier,
      service: boxQuotes.length > 1
        ? `separately quoted (${parcels.length} boxes)`
        : `${firstQuote.cheapest.service} (${parcels.length} boxes)`
    },
    boxQuotes,
    strategy: "separate_boxes",
    parcelCount: parcels.length
  };
}
