const crypto = require("node:crypto");

const WEBHOOK_TOLERANCE_SECONDS = 300;

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

function parseSignatureHeader(header) {
  const parts = header.split(",").reduce((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || !value) {
      return acc;
    }

    if (!acc[key]) {
      acc[key] = [];
    }

    acc[key].push(value);
    return acc;
  }, {});

  return {
    timestamp: parts.t?.[0] || "",
    signatures: parts.v1 || [],
  };
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET.");
  }

  if (!signatureHeader) {
    throw new Error("Missing Stripe-Signature header.");
  }

  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
  if (!timestamp || signatures.length === 0) {
    throw new Error("Invalid Stripe-Signature header.");
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const matched = signatures.some((signature) => {
    try {
      const signatureBuffer = Buffer.from(signature, "hex");
      return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    } catch (error) {
      return false;
    }
  });

  if (!matched) {
    throw new Error("Webhook signature verification failed.");
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(ageSeconds) || ageSeconds > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("Webhook signature is too old.");
  }
}

function safeParseJson(rawBody) {
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    return {};
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, {
      error: "Method not allowed.",
      allowedMethods: ["POST"],
    });
  }

  const rawBody = event.body || "";
  const signatureHeader = event.headers?.["stripe-signature"] || event.headers?.["Stripe-Signature"] || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    verifySignature(rawBody, signatureHeader, webhookSecret);
  } catch (error) {
    console.error("[stripe-webhook] Signature verification failed", error.message);
    return json(400, {
      error: error.message,
    });
  }

  const payload = safeParseJson(rawBody);
  const eventType = payload.type || "unknown";
  const session = payload.data?.object || payload.session || {};

  console.log("[stripe-webhook] Event received", JSON.stringify({
    eventType,
    sessionId: session.id || "",
    customerEmail: session.customer_email || "",
    amountTotal: session.amount_total || 0,
    shippingName: session.shipping_details?.name || "",
    metadata: session.metadata || {},
  }, null, 2));

  if (eventType === "checkout.session.completed") {
    // TODO: Send a confirmation email.
    // TODO: Save the order to a database.
    // TODO: Notify the admin team.
    // TODO: Create a shipping label.
  }

  return json(200, {
    received: true,
    eventType,
    handled: eventType === "checkout.session.completed",
  });
};
