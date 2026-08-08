/* global supabaseClient, requireAuth, renderTopbar, isAdmin, formatINR */

const els = {
  pending: document.getElementById("kpi-pending"),
  pendingDetail: document.getElementById("kpi-pending-detail"),
  capital: document.getElementById("kpi-capital"),
  bank: document.getElementById("kpi-bank"),
  loaded: document.getElementById("kpi-loaded"),
  pendingCallout: document.getElementById("pending-callout"),
  bankToday: document.getElementById("kpi-bank-today"),
  loadedToday: document.getElementById("kpi-loaded-today"),
  adminPanel: document.getElementById("admin-commission-panel"),
  commission: document.getElementById("kpi-commission"),
  transactions: document.getElementById("kpi-transactions"),
};

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfTomorrowIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

async function loadDashboard(user) {
  const from = startOfTodayIso();
  const to = startOfTomorrowIso();

  const [summaryRes, bankTodayRes, loadsTodayRes] = await Promise.all([
    supabaseClient.from("v_atm_summary").select("*").maybeSingle(),
    supabaseClient
      .from("bank_draws")
      .select("amount")
      .gte("recorded_at", from)
      .lt("recorded_at", to),
    supabaseClient
      .from("cash_loads")
      .select("amount")
      .gte("recorded_at", from)
      .lt("recorded_at", to),
  ]);

  if (summaryRes.error || bankTodayRes.error || loadsTodayRes.error) {
    const err = summaryRes.error || bankTodayRes.error || loadsTodayRes.error;
    showToast(err.message, "error");
  }

  const summary = summaryRes.data || {};
  const bankToday = (bankTodayRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const loadedToday = (loadsTodayRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const pending = Number(summary.pending_to_load) || 0;

  if (els.pending) els.pending.textContent = formatINR(pending);
  if (els.pendingDetail) els.pendingDetail.textContent = formatINR(pending);
  if (els.capital) els.capital.textContent = formatINR(summary.total_capital);
  if (els.bank) els.bank.textContent = formatINR(summary.total_bank_drawn);
  if (els.loaded) els.loaded.textContent = formatINR(summary.total_loaded);
  if (els.bankToday) els.bankToday.textContent = formatINR(bankToday);
  if (els.loadedToday) els.loadedToday.textContent = formatINR(loadedToday);

  if (els.pendingCallout) {
    els.pendingCallout.classList.toggle("is-urgent", pending > 0);
    els.pendingCallout.classList.toggle("is-clear", pending <= 0);
  }

  if (isAdmin(user) && els.adminPanel) {
    els.adminPanel.hidden = false;
    if (els.commission) els.commission.textContent = formatINR(summary.total_commission_net);
    if (els.transactions) els.transactions.textContent = String(summary.total_transactions || 0);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;
  renderTopbar("Home", "dashboard.html", user);
  await loadDashboard(user);
});
