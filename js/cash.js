/* global supabaseClient, requireAuth, renderTopbar, isAdmin, formatINR, formatINRDecimal, showToast, bindReceiptPreview, clearReceiptPreview, uploadReceipt, removeReceipt, getReceiptSignedUrlMap, receiptLinkFromMap, bindLiveClock, refreshGeoStatus, formatDateTime, formatGeo, mapsLink */

const bankForm = document.getElementById("bank-form");
const loadForm = document.getElementById("load-form");
const bankTable = document.getElementById("bank-table");
const loadsTable = document.getElementById("loads-table");
const pendingHint = document.getElementById("pending-hint");
const geoStatus = document.getElementById("geo-status");
const geoRefreshBtn = document.getElementById("geo-refresh");

const geoState = {
  latitude: null,
  longitude: null,
  geo_accuracy_m: null,
  error: null,
};

let pageUser = null;
let saving = false;

function parseAmount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function rpcErrorMessage(err) {
  const msg = err?.message || err?.error_description || String(err || "Request failed");
  return msg.replace(/^.*error:\s*/i, "").trim();
}

async function requireFreshGeo() {
  await refreshGeoStatus(geoStatus, geoState);
  if (geoState.latitude == null || geoState.longitude == null) {
    showToast("Location required. Enable GPS and tap Refresh location.", "error");
    return false;
  }
  return true;
}

async function refreshPendingHint() {
  const { data, error } = await supabaseClient
    .from("v_atm_summary")
    .select("pending_to_load")
    .maybeSingle();
  if (error) console.warn(error);
  if (pendingHint) pendingHint.textContent = formatINR(data?.pending_to_load || 0);
  return Number(data?.pending_to_load) || 0;
}

async function fetchCashData() {
  const [bankRes, loadsRes] = await Promise.all([
    supabaseClient
      .from("bank_draws")
      .select("id, amount, reference, receipt_path, recorded_at, latitude, longitude, geo_accuracy_m")
      .order("recorded_at", { ascending: false })
      .limit(30),
    supabaseClient
      .from("cash_loads")
      .select("id, amount, reference, atm_receipt_path, recorded_at, latitude, longitude, geo_accuracy_m")
      .order("recorded_at", { ascending: false })
      .limit(30),
  ]);
  return {
    banks: bankRes.data || [],
    loads: loadsRes.data || [],
    error: bankRes.error || loadsRes.error,
  };
}

function metaCell(row) {
  const when = formatDateTime(row.recorded_at || row.created_at);
  const geo = formatGeo(row.latitude, row.longitude, row.geo_accuracy_m);
  const link = mapsLink(row.latitude, row.longitude);
  const geoHtml = link
    ? `<a href="${link}" target="_blank" rel="noopener">${escapeHtml(geo)}</a>`
    : escapeHtml(geo);
  return `${escapeHtml(when)}<br><span class="muted" style="font-size:0.8rem">${geoHtml}</span>`;
}

async function renderBankTable(rows) {
  if (!bankTable) return;
  if (!rows.length) {
    bankTable.innerHTML = `<p class="muted">No bank draws yet.</p>`;
    return;
  }
  const urlMap = await getReceiptSignedUrlMap(rows.map((r) => r.receipt_path));
  bankTable.innerHTML = `<table class="data-table"><thead><tr><th>When / where</th><th>Amount</th><th>Reference</th><th>Receipt</th></tr></thead><tbody>${rows
    .map(
      (r) => `<tr>
        <td data-label="When / where">${metaCell(r)}</td>
        <td data-label="Amount">${formatINRDecimal(r.amount)}</td>
        <td data-label="Reference">${escapeHtml(r.reference || "—")}</td>
        <td data-label="Receipt">${receiptLinkFromMap(r.receipt_path, "receipt", urlMap)}</td>
      </tr>`
    )
    .join("")}</tbody></table>`;
}

async function renderLoadsTable(rows) {
  if (!loadsTable) return;
  if (!rows.length) {
    loadsTable.innerHTML = `<p class="muted">No ATM loads yet.</p>`;
    return;
  }
  const urlMap = await getReceiptSignedUrlMap(rows.map((r) => r.atm_receipt_path));
  loadsTable.innerHTML = `<table class="data-table"><thead><tr><th>When / where</th><th>Amount</th><th>Reference</th><th>Receipt</th></tr></thead><tbody>${rows
    .map(
      (r) => `<tr>
        <td data-label="When / where">${metaCell(r)}</td>
        <td data-label="Amount">${formatINRDecimal(r.amount)}</td>
        <td data-label="Reference">${escapeHtml(r.reference || "—")}</td>
        <td data-label="Receipt">${receiptLinkFromMap(r.atm_receipt_path, "receipt", urlMap)}</td>
      </tr>`
    )
    .join("")}</tbody></table>`;
}

async function refreshTables() {
  const { banks, loads, error } = await fetchCashData();
  if (error) {
    showToast(error.message, "error");
    return;
  }
  await Promise.all([renderBankTable(banks), renderLoadsTable(loads), refreshPendingHint()]);
}

async function handleBankSubmit(event) {
  event.preventDefault();
  if (saving) return;

  const button = bankForm.querySelector('button[type="submit"]');
  const amount = parseAmount(bankForm.amount.value);
  const file = bankForm.bank_receipt.files?.[0];

  if (amount == null) {
    showToast("Enter a valid bank draw amount.", "error");
    return;
  }
  if (!file) {
    showToast("Bank receipt photo is required.", "error");
    return;
  }
  if (!(await requireFreshGeo())) return;

  saving = true;
  setButtonLoading(button, true, "Uploading…");
  let uploadedPath = null;

  try {
    uploadedPath = await uploadReceipt(file, "bank");
    setButtonLoading(button, true, "Saving…");

    const { error } = await supabaseClient.rpc("record_bank_draw", {
      p_amount: amount,
      p_receipt_path: uploadedPath,
      p_latitude: geoState.latitude,
      p_longitude: geoState.longitude,
      p_geo_accuracy_m: geoState.geo_accuracy_m,
      p_reference: bankForm.reference.value.trim() || null,
    });
    if (error) throw error;

    bankForm.reset();
    clearReceiptPreview(document.getElementById("bank_receipt_preview"), bankForm.bank_receipt);
    showToast("Bank draw saved (server time + GPS locked).", "success");
    await refreshTables();
  } catch (err) {
    if (uploadedPath) await removeReceipt(uploadedPath);
    showToast(rpcErrorMessage(err), "error");
  } finally {
    saving = false;
    setButtonLoading(button, false);
  }
}

async function handleLoadSubmit(event) {
  event.preventDefault();
  if (saving) return;

  const button = loadForm.querySelector('button[type="submit"]');
  const amount = parseAmount(loadForm.amount.value);
  const file = loadForm.atm_receipt.files?.[0];

  if (amount == null) {
    showToast("Enter a valid ATM load amount.", "error");
    return;
  }
  if (!file) {
    showToast("ATM load receipt photo is required.", "error");
    return;
  }
  if (!(await requireFreshGeo())) return;

  const pending = await refreshPendingHint();
  let force = false;
  if (amount > pending + 0.009) {
    if (!isAdmin(pageUser)) {
      showToast(
        `ATM load ${formatINR(amount)} exceeds pending bank cash ${formatINR(pending)}. Draw from bank first.`,
        "error"
      );
      return;
    }
    force = window.confirm(
      `ATM load exceeds pending bank cash (${formatINR(pending)}).\n\nAdmin override and save anyway?`
    );
    if (!force) return;
  }

  saving = true;
  setButtonLoading(button, true, "Uploading…");
  let uploadedPath = null;

  try {
    uploadedPath = await uploadReceipt(file, "atm");
    setButtonLoading(button, true, "Saving…");

    const { error } = await supabaseClient.rpc("record_atm_load", {
      p_amount: amount,
      p_receipt_path: uploadedPath,
      p_latitude: geoState.latitude,
      p_longitude: geoState.longitude,
      p_geo_accuracy_m: geoState.geo_accuracy_m,
      p_reference: loadForm.reference.value.trim() || null,
      p_force: force,
    });
    if (error) throw error;

    loadForm.reset();
    clearReceiptPreview(document.getElementById("atm_receipt_preview"), loadForm.atm_receipt);
    showToast("ATM load saved (server time + GPS locked).", "success");
    await refreshTables();
  } catch (err) {
    if (uploadedPath) await removeReceipt(uploadedPath);
    showToast(rpcErrorMessage(err), "error");
  } finally {
    saving = false;
    setButtonLoading(button, false);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  pageUser = await requireAuth();
  if (!pageUser) return;
  renderTopbar("Cash", "cash.html", pageUser);

  bindLiveClock(document.getElementById("bank-clock"));
  bindLiveClock(document.getElementById("atm-clock"));
  bindReceiptPreview(bankForm?.bank_receipt, document.getElementById("bank_receipt_preview"));
  bindReceiptPreview(loadForm?.atm_receipt, document.getElementById("atm_receipt_preview"));

  geoRefreshBtn?.addEventListener("click", () => refreshGeoStatus(geoStatus, geoState));
  bankForm?.addEventListener("submit", handleBankSubmit);
  loadForm?.addEventListener("submit", handleLoadSubmit);

  await Promise.all([refreshGeoStatus(geoStatus, geoState), refreshTables()]);
});
