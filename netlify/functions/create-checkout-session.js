const REQUIRED_FIELDS = [
  "quantity",
  "fullName",
  "email",
  "shippingAddress",
  "city",
  "state",
  "postalCode",
];

const MAX_QUANTITY = 10;
const BASE_PRICE_CENTS = 44999;
const SHIPPING_CENTS = 1499;
const ADDON_PRICES = new Map([
  ["Rush production", 7499],
  ["Extra tray / duplicate tray", 9999],
  ["Saved scan upgrade", 4999],
]);
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_SUCCESS_PATH = "/success";
const STRIPE_CANCEL_PATH = "/cancel";

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

  if (quantity > MAX_QUANTITY) {
    return `Quantity must be ${MAX_QUANTITY} or less.`;
  }

  return "";
}

function buildOrderSummary(order) {
  const quantity = Number(order.quantity);
  const addons = Array.isArray(order.addons) ? order.addons : [];
  const selectedAddons = addons.filter((addon) => ADDON_PRICES.has(addon));
  const addonTotal = selectedAddons.reduce((sum, addon) => sum + ADDON_PRICES.get(addon), 0);

  return {
    product: "Custom Nail Tray Kit",
    quantity,
    addons: selectedAddons,
    addonTotal,
    baseSubtotal: BASE_PRICE_CENTS * quantity,
    shipping: SHIPPING_CENTS,
    total: BASE_PRICE_CENTS * quantity + addonTotal + SHIPPING_CENTS,
  };
}

function appendParam(params, key, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  params.append(key, String(value));
}

function appendLineItem(params, index, item) {
  const prefix = `line_items[${index}]`;
  appendParam(params, `${prefix}[price_data][currency]`, "usd");
  appendParam(params, `${prefix}[price_data][product_data][name]`, item.name);
  appendParam(params, `${prefix}[price_data][product_data][description]`, item.description);
  appendParam(params, `${prefix}[price_data][unit_amount]`, item.unitAmount);
  appendParam(params, `${prefix}[quantity]`, item.quantity);
}

async function createCheckoutSession(order) {
  const siteUrl = (process.env.SITE_URL || process.env.URL || "").replace(/\/$/, "");
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey || !siteUrl) {
    const missing = [
      !secretKey ? "STRIPE_SECRET_KEY" : null,
      !siteUrl ? "SITE_URL" : null,
    ].filter(Boolean);

    const error = new Error(`Missing environment variables: ${missing.join(", ")}.`);
    error.statusCode = 500;
    throw error;
  }

  const summary = buildOrderSummary(order);
  const params = new URLSearchParams();

  appendParam(params, "mode", "payment");
  appendParam(params, "success_url", `${siteUrl}${STRIPE_SUCCESS_PATH}?session_id={CHECKOUT_SESSION_ID}`);
  appendParam(params, "cancel_url", `${siteUrl}${STRIPE_CANCEL_PATH}`);
  appendParam(params, "customer_email", order.email);
  appendParam(params, "shipping_address_collection[allowed_countries][0]", "US");
  appendParam(params, "phone_number_collection[enabled]", "true");
  appendParam(params, "shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  appendParam(params, "shipping_options[0][shipping_rate_data][display_name]", "Standard shipping");
  appendParam(params, "shipping_options[0][shipping_rate_data][fixed_amount][amount]", summary.shipping);
  appendParam(params, "shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");
  appendParam(params, "shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]", "business_day");
  appendParam(params, "shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]", 3);
  appendParam(params, "shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]", "business_day");
  appendParam(params, "shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]", 7);
  appendParam(params, "metadata[product]", summary.product);
  appendParam(params, "metadata[quantity]", summary.quantity);
  appendParam(params, "metadata[addons]", summary.addons.join(", ") || "none");
  appendParam(params, "metadata[customer_name]", order.fullName);
  appendParam(params, "metadata[customer_email]", order.email);
  appendParam(params, "metadata[phone]", order.phone || "");
  appendParam(params, "metadata[city]", order.city);
  appendParam(params, "metadata[state]", order.state);
  appendParam(params, "metadata[postal_code]", order.postalCode);
  appendParam(params, "metadata[notes]", order.notes || "");
  appendLineItem(params, 0, {
    name: summary.product,
    description: "Custom-fit tray kit",
    unitAmount: BASE_PRICE_CENTS,
    quantity: summary.quantity,
  });

  summary.addons.forEach((addon, index) => {
    appendLineItem(params, index + 1, {
      name: addon,
      description: "Optional upgrade",
      unitAmount: ADDON_PRICES.get(addon),
      quantity: 1,
    });
  });

  const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || payload?.error?.type || "Unable to create Stripe Checkout session.";
    const error = new Error(message);
    error.statusCode = response.status;
    error.details = payload?.error || payload;
    throw error;
  }

  return {
    session: payload,
    summary,
  };
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

  const safeOrder = {
    product: "Custom Nail Tray Kit",
    quantity: Number(order.quantity),
    addons: Array.isArray(order.addons) ? order.addons.filter((addon) => ADDON_PRICES.has(addon)) : [],
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

  try {
    const { session, summary } = await createCheckoutSession(safeOrder);
    return json(200, {
      url: session.url,
      sessionId: session.id,
      order: {
        ...safeOrder,
        baseSubtotal: summary.baseSubtotal,
        addonTotal: summary.addonTotal,
        shipping: summary.shipping,
        total: summary.total,
      },
    });
  } catch (error) {
    console.error("[create-checkout-session] Stripe error", error);
    return json(error.statusCode || 500, {
      error: error.message || "Unable to create Stripe Checkout session.",
      details: error.details || null,
    });
  }
};
