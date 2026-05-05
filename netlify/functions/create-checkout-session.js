const REQUIRED_FIELDS = [
  "quantity",
  "fullName",
  "email",
  "shippingAddress",
  "city",
  "state",
  "postalCode",
];

const REQUIRED_ENV = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "SITE_URL",
];

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) {
    return {};
  }

  try {
    return JSON.parse(event.body);
  } catch (error) {
    throw new Error("Request body must be valid JSON.");
  }
}

function validateOrder(order) {
  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = order[field];
    return value === undefined || value === null || String(value).trim() === "";
  });

  if (missing.length > 0) {
    return `Missing required fields: ${missing.join(", ")}.`;
  }

  const quantity = Number(order.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return "Quantity must be a whole number of at least 1.";
  }

  return "";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, {
      error: "Method not allowed.",
      allowedMethods: ["POST"],
    });
  }

  let order;

  try {
    order = parseBody(event);
  } catch (error) {
    return json(400, { error: error.message });
  }

  const validationError = validateOrder(order);
  if (validationError) {
    return json(400, { error: validationError });
  }

  const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);

  const safeOrder = {
    product: order.product || "Custom Nail Tray Kit",
    quantity: Number(order.quantity),
    addons: Array.isArray(order.addons) ? order.addons : [],
    fullName: order.fullName,
    email: order.email,
    phone: order.phone || "",
    shippingAddress: order.shippingAddress,
    apartment: order.apartment || "",
    city: order.city,
    state: order.state,
    postalCode: order.postalCode,
    country: order.country || "US",
    notes: order.notes || "",
  };

  console.log("[create-checkout-session] Order received", JSON.stringify(safeOrder, null, 2));

  // Stripe is intentionally not connected yet.
  // TODO: Create a Stripe Checkout Session with product line items.
  // TODO: Add fixed shipping to the session.
  // TODO: Collect shipping address and customer email in Stripe.
  // TODO: Return the Stripe checkout URL to the frontend.

  return json(501, {
    error: "Stripe Checkout is not wired up yet.",
    message:
      missingEnv.length > 0
        ? `Missing environment variables: ${missingEnv.join(", ")}. Stripe checkout will be enabled after those are added.`
        : "The order payload validated successfully, but checkout will be enabled in a later pass.",
    order: safeOrder,
    stripeReady: false,
    missingEnv,
  });
};
