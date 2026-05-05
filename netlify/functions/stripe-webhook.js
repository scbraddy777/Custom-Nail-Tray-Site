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

  const payload = parseBody(event);
  const eventType = payload.type || "unknown";
  const session = payload.data?.object || payload.session || {};

  console.log("[stripe-webhook] Event received", JSON.stringify({
    eventType,
    sessionId: session.id || "",
    customerEmail: session.customer_email || "",
    amountTotal: session.amount_total || 0,
    shippingName: session.shipping_details?.name || "",
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
