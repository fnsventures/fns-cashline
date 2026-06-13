/* global supabaseClient, requireAuth, renderTopbar, formatINR, formatINRDecimal, formatDisplayDate */

const kpiEls = {
  deployed: document.getElementById("kpi-deployed"),
  loadedMonth: document.getElementById("kpi-loaded-month"),
  commissionMonth: document.getElementById("kpi-commission-month"),
  transactions: document.getElementById("kpi-transactions"),
};

const recentLoadsEl = document.getElementById("recent-loads");
const recentCommissionEl = document.getElementById("recent-commissions");

function monthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: toLocalDateString(start),
    end: toLocalDateString(end),
  };
}

async function loadDashboard() {
  const { start, end } = monthBounds();

  const [summaryRes, loadsMonthRes, commissionMonthRes, loadsRes, commissionRes] =
    await Promise.all([
      supabaseClient.from("v_atm_summary").select("*").maybeSingle(),
      supabaseClient
        .from("cash_loads")
        .select("amount")
        .gte("load_date", start)
        .lte("load_date", end),
      supabaseClient
        .from("commission_settlements")
        .select("net_commission, transaction_count")
        .gte("period_start", start)
        .lte("period_end", end),
      supabaseClient
        .from("cash_loads")
        .select("load_date, amount, mode, reference")
        .order("load_date", { ascending: false })
        .limit(5),
      supabaseClient
        .from("commission_settlements")
        .select("period_start, period_end, net_commission, transaction_count")
        .order("period_start", { ascending: false })
        .limit(5),
    ]);

  const summary = summaryRes.data || {};
  const loadedMonth = (loadsMonthRes.data || []).reduce((s, r) => s + Number(r.amount), 0);
  const commissionMonth = (commissionMonthRes.data || []).reduce(
    (s, r) => s + Number(r.net_commission),
    0
  );
  const txnMonth = (commissionMonthRes.data || []).reduce(
    (s, r) => s + Number(r.transaction_count),
    0
  );

  if (kpiEls.deployed) kpiEls.deployed.textContent = formatINR(summary.cash_deployed);
  if (kpiEls.loadedMonth) kpiEls.loadedMonth.textContent = formatINR(loadedMonth);
  if (kpiEls.commissionMonth) kpiEls.commissionMonth.textContent = formatINR(commissionMonth);
  if (kpiEls.transactions) kpiEls.transactions.textContent = String(txnMonth);

  if (recentLoadsEl) {
    const rows = loadsRes.data || [];
    recentLoadsEl.innerHTML = rows.length
      ? `<table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Mode</th></tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr><td>${formatDisplayDate(r.load_date)}</td><td>${formatINRDecimal(r.amount)}</td><td>${escapeHtml(r.mode)}</td></tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="muted">No cash loads recorded yet.</p>`;
  }

  if (recentCommissionEl) {
    const rows = commissionRes.data || [];
    recentCommissionEl.innerHTML = rows.length
      ? `<table class="data-table"><thead><tr><th>Period</th><th>Txns</th><th>Net</th></tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr><td>${formatDisplayDate(r.period_start)} – ${formatDisplayDate(r.period_end)}</td><td>${r.transaction_count}</td><td>${formatINRDecimal(r.net_commission)}</td></tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="muted">No commission settlements recorded yet.</p>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;
  renderTopbar("Dashboard", "dashboard.html");
  await loadDashboard();
});
