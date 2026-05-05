const DRAFT_KEY = "cnt-order-draft";
const WINDOW_NAME_KEY = "cnt-order-demo";
const DEMO_QUERY = "demo=1";

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function isDemoMode() {
  return window.location.protocol === "file:" || window.location.search.includes(DEMO_QUERY);
}

function readOrder(form) {
  const product = form.querySelector('input[name="product"]:checked')?.value || "Custom Nail Tray";
  const quantity = Number($("#quantity", form)?.value || 1);
  const addons = $all('input[name="addons"]:checked', form).map((input) => input.value);

  return {
    product,
    quantity,
    addons,
    fullName: $("#full-name", form)?.value.trim() || "",
    email: $("#email", form)?.value.trim() || "",
    phone: $("#phone", form)?.value.trim() || "",
    shippingAddress: $("#shipping-address", form)?.value.trim() || "",
    apartment: $("#apartment", form)?.value.trim() || "",
    city: $("#city", form)?.value.trim() || "",
    state: $("#state", form)?.value.trim() || "",
    postalCode: $("#postal-code", form)?.value.trim() || "",
    country: $("#country", form)?.value.trim() || "US",
    notes: $("#notes", form)?.value.trim() || "",
  };
}

function saveDraft(order) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(order));
  } catch (error) {
    // Ignore storage failures; the tab-local demo handoff still carries the draft.
  }
}

function loadDraft() {
  try {
    const storageDraft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
    if (storageDraft) {
      return storageDraft;
    }
  } catch (error) {
    // Ignore storage parsing issues and fall through to the tab-local demo payload.
  }

  try {
    const payload = JSON.parse(window.name || "null");
    const draft = payload?.[WINDOW_NAME_KEY] || null;
    if (draft) {
      window.name = "";
      return draft;
    }
  } catch (error) {
    // Ignore malformed tab state and continue with a blank confirmation page.
  }

  return null;
}

function renderSummary(order) {
  const summaryProduct = $("[data-summary-product]");
  const summaryQuantity = $("[data-summary-quantity]");
  const summaryAddons = $("[data-summary-addons]");
  const summaryContact = $("[data-summary-contact]");
  const summaryShipping = $("[data-summary-shipping]");
  const summaryNotes = $("[data-summary-notes]");

  if (summaryProduct) {
    summaryProduct.textContent = order.product || "Custom Nail Tray";
  }

  if (summaryQuantity) {
    summaryQuantity.textContent = `Quantity: ${order.quantity || 1}`;
  }

  if (summaryAddons) {
    summaryAddons.innerHTML = "";
    if (order.addons.length === 0) {
      summaryAddons.innerHTML = "<li>Add-ons: none selected</li>";
    } else {
      order.addons.forEach((addon) => {
        const item = document.createElement("li");
        item.textContent = addon;
        summaryAddons.appendChild(item);
      });
    }
  }

  if (summaryContact) {
    summaryContact.textContent = order.fullName && order.email
      ? `${order.fullName} · ${order.email}`
      : "Enter contact details to continue";
  }

  if (summaryShipping) {
    const parts = [order.shippingAddress, order.city, order.state, order.postalCode].filter(Boolean);
    summaryShipping.textContent = parts.length > 0
      ? parts.join(", ")
      : "Shipping address is required so we can send your kit/product.";
  }

  if (summaryNotes) {
    summaryNotes.textContent = order.notes || "You’ll receive next-step instructions after checkout.";
  }
}

function setButtonState(button, loading) {
  if (!button) {
    return;
  }

  button.disabled = loading;
  button.dataset.loading = loading ? "true" : "false";
  button.textContent = loading ? "Preparing checkout..." : "Pay securely with Stripe";
}

function setStatus(message, kind = "info") {
  const status = $("[data-order-status]");
  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.kind = kind;
}

async function handleOrderSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;

  if (!form.reportValidity()) {
    return;
  }

  const order = readOrder(form);
  const button = $("#checkout-button", form);
  setButtonState(button, true);
  setStatus("Creating your order summary...", "info");

  try {
    if (isDemoMode()) {
      saveDraft(order);
      window.name = JSON.stringify({ [WINDOW_NAME_KEY]: order });
      window.location.href = "success.html?demo=1";
      return;
    }

    const response = await fetch("/.netlify/functions/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(order),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || payload.message || "We could not prepare checkout.");
    }

    if (payload.url) {
      window.location.href = payload.url;
      return;
    }

    if (payload.redirectUrl) {
      window.location.href = payload.redirectUrl;
      return;
    }

    throw new Error("Checkout is not connected yet.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setButtonState(button, false);
  }
}

function initializeOrderPage() {
  const form = $("[data-order-form]");
  if (!form) {
    return;
  }

  const sync = () => renderSummary(readOrder(form));
  $all("input, textarea, select", form).forEach((field) => {
    field.addEventListener("input", sync);
    field.addEventListener("change", sync);
  });

  form.addEventListener("submit", handleOrderSubmit);
  sync();
}

function initializeSuccessPage() {
  const shell = $("[data-success-shell]");
  if (!shell) {
    return;
  }

  const draft = loadDraft();
  if (!draft) {
    return;
  }

  const product = $("[data-success-product]");
  const contact = $("[data-success-contact]");
  const shipping = $("[data-success-shipping]");
  const notes = $("[data-success-notes]");
  const addons = $("[data-success-addons]");

  if (product) {
    product.textContent = draft.product || "Custom Nail Tray";
  }

  if (contact) {
    contact.textContent = `${draft.fullName || "Customer"} · ${draft.email || "No email provided"}`;
  }

  if (shipping) {
    shipping.textContent = [draft.shippingAddress, draft.city, draft.state, draft.postalCode]
      .filter(Boolean)
      .join(", ");
  }

  if (notes) {
    notes.textContent = draft.notes || "You’ll receive next-step instructions after checkout.";
  }

  if (addons) {
    addons.textContent = draft.addons && draft.addons.length > 0 ? draft.addons.join(" · ") : "No add-ons selected.";
  }

  if (window.location.search.includes(DEMO_QUERY)) {
    shell.dataset.demo = "true";
    const demoBanner = $("[data-demo-banner]", shell);
    if (demoBanner) {
      demoBanner.hidden = false;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initializeOrderPage();
  initializeSuccessPage();
});
