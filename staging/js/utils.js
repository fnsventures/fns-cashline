/**
 * Shared utilities for the ATM franchise app.
 */

const AMOUNT_EPS = 0.009;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toLocalDateString(date) {
  const d = date instanceof Date ? date : date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) return getLocalDateString();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalDateString() {
  return toLocalDateString(new Date());
}

function parseAmount(raw, { allowZero = false } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (allowZero ? n < 0 : n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function rpcErrorMessage(err) {
  const msg = err?.message || err?.error_description || String(err || "Request failed");
  return msg.replace(/^.*error:\s*/i, "").trim();
}

function formatINR(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatINRDecimal(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatMonthYear(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast--hide");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function setButtonLoading(button, loading, label = "Please wait…") {
  if (!button) return;
  if (loading) {
    // Keep the first label so Uploading… → Saving… does not overwrite restore text.
    if (button.dataset.originalText == null) {
      button.dataset.originalText = button.textContent;
    }
    button.disabled = true;
    button.textContent = label;
  } else {
    const original = button.dataset.originalText;
    delete button.dataset.originalText;
    button.disabled = false;
    if (original != null) button.textContent = original;
  }
}

window.AMOUNT_EPS = AMOUNT_EPS;
window.escapeHtml = escapeHtml;
window.toLocalDateString = toLocalDateString;
window.getLocalDateString = getLocalDateString;
window.parseAmount = parseAmount;
window.rpcErrorMessage = rpcErrorMessage;
window.formatINR = formatINR;
window.formatINRDecimal = formatINRDecimal;
window.formatDisplayDate = formatDisplayDate;
window.formatMonthYear = formatMonthYear;
window.showToast = showToast;
window.setButtonLoading = setButtonLoading;
