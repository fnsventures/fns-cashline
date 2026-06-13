/* global supabaseClient, requireAuth, renderTopbar, AppConfig, formatINRDecimal, formatDisplayDate, showToast */

const loadForm = document.getElementById("load-form");
const settlementForm = document.getElementById("settlement-form");
const loadsTable = document.getElementById("loads-table");
const settlementsTable = document.getElementById("settlements-table");

function populateModeSelect(select) {
  if (!select || !AppConfig?.CASH_MODES) return;
  select.innerHTML = AppConfig.CASH_MODES.map(
    (m) => `<option value="${m.key}">${escapeHtml(m.label)}</option>`
  ).join("");
}

async function fetchCashData() {
  const [loadsRes, settlementsRes] = await Promise.all([
    supabaseClient
      .from("cash_loads")
      .select("*")
      .order("load_date", { ascending: false }),
    supabaseClient
      .from("cash_settlements")
      .select("*")
      .order("settlement_date", { ascending: false }),
  ]);

  return {
    loads: loadsRes.data || [],
    settlements: settlementsRes.data || [],
    error: loadsRes.error || settlementsRes.error,
  };
}

function renderLoadsTable(rows) {
  if (!loadsTable) return;
  loadsTable.innerHTML = rows.length
    ? `<table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Reference</th><th>Notes</th></tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr><td>${formatDisplayDate(r.load_date)}</td><td>${formatINRDecimal(r.amount)}</td><td>${escapeHtml(r.mode)}</td><td>${escapeHtml(r.reference || "—")}</td><td>${escapeHtml(r.notes || "—")}</td></tr>`
        )
        .join("")}</tbody></table>`
    : `<p class="muted">No cash loads yet.</p>`;
}

function renderSettlementsTable(rows) {
  if (!settlementsTable) return;
  settlementsTable.innerHTML = rows.length
    ? `<table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Reference</th><th>Notes</th></tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr><td>${formatDisplayDate(r.settlement_date)}</td><td>${formatINRDecimal(r.amount)}</td><td>${escapeHtml(r.reference || "—")}</td><td>${escapeHtml(r.notes || "—")}</td></tr>`
        )
        .join("")}</tbody></table>`
    : `<p class="muted">No cash settlements yet.</p>`;
}

async function refreshTables() {
  const { loads, settlements, error } = await fetchCashData();
  if (error) {
    showToast(error.message, "error");
    return;
  }
  renderLoadsTable(loads);
  renderSettlementsTable(settlements);
}

async function handleLoadSubmit(event) {
  event.preventDefault();
  const button = loadForm.querySelector('button[type="submit"]');
  const user = await getCurrentUser();

  const payload = {
    load_date: loadForm.load_date.value,
    amount: Number(loadForm.amount.value),
    mode: loadForm.mode.value,
    reference: loadForm.reference.value.trim() || null,
    notes: loadForm.notes.value.trim() || null,
    created_by: user?.id || null,
  };

  setButtonLoading(button, true, "Saving…");
  const { error } = await supabaseClient.from("cash_loads").insert(payload);
  setButtonLoading(button, false);

  if (error) {
    showToast(error.message, "error");
    return;
  }

  loadForm.reset();
  loadForm.load_date.value = getLocalDateString();
  showToast("Cash load recorded.", "success");
  await refreshTables();
}

async function handleSettlementSubmit(event) {
  event.preventDefault();
  const button = settlementForm.querySelector('button[type="submit"]');
  const user = await getCurrentUser();

  const payload = {
    settlement_date: settlementForm.settlement_date.value,
    amount: Number(settlementForm.amount.value),
    reference: settlementForm.reference.value.trim() || null,
    notes: settlementForm.notes.value.trim() || null,
    created_by: user?.id || null,
  };

  setButtonLoading(button, true, "Saving…");
  const { error } = await supabaseClient.from("cash_settlements").insert(payload);
  setButtonLoading(button, false);

  if (error) {
    showToast(error.message, "error");
    return;
  }

  settlementForm.reset();
  settlementForm.settlement_date.value = getLocalDateString();
  showToast("Cash settlement recorded.", "success");
  await refreshTables();
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;
  renderTopbar("Cash loads & settlements", "cash-loads.html");

  populateModeSelect(loadForm?.mode);
  if (loadForm?.load_date) loadForm.load_date.value = getLocalDateString();
  if (settlementForm?.settlement_date) settlementForm.settlement_date.value = getLocalDateString();

  loadForm?.addEventListener("submit", handleLoadSubmit);
  settlementForm?.addEventListener("submit", handleSettlementSubmit);

  await refreshTables();
});
