
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

// Confirmed package profiles
const PACKAGES = {
  1: {
    length: "8",
    width: "6",
    height: "4",
    distance_unit: "in",
    weight: "600",
    mass_unit: "g"
  }
};

// We will add 2- and 3-can packages
// after confirming their packed dimensions and weights.

export function getPackage(quantity) {
  if (!Number.isInteger(quantity) || !PACKAGES[quantity]) {
    throw new Error("Unsupported package quantity");
  }

  return { ...PACKAGES[quantity] };
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

export async function getShippingRates({
  token,
  shipFrom,
  shipTo,
  quantity
}) {
  if (!token) {
    throw new Error("Shippo API token is missing");
  }

  validateAddress(shipFrom);
  validateAddress(shipTo);

  const parcel = getPackage(quantity);

  const response = await fetch(
    "https://api.goshippo.com/shipments/",
    {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${token}`,
        "Content-Type": "application/json",
        "SHIPPO-API-VERSION": "2018-02-08"
      },
      body: JSON.stringify({
        address_from: shipFrom,
        address_to: shipTo,
        parcels: [parcel],
        async: false
      })
    }
  );

  if (!response.ok) {
    throw new Error("Unable to retrieve shipping rates");
  }

  const shipment = await response.json();

  const rates = (shipment.rates || [])
    .filter(rate =>
      rate.currency === "USD" &&
      Number.isFinite(Number(rate.amount)) &&
      Number(rate.amount) > 0
    )
    .map(rate => ({
      id: rate.object_id,
      carrier: rate.provider,
      service: rate.servicelevel?.name || "Standard",
      amount: Math.round(Number(rate.amount) * 100)
    }))
    .sort((a, b) => a.amount - b.amount);

  if (!rates.length) {
    throw new Error("No shipping rates available");
  }

  return {
    shipmentId: shipment.object_id,
    cheapest: rates[0],
    rates
  };
}
