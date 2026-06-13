/* global supabaseClient, requireAuth, renderTopbar, formatINR, formatINRDecimal, formatDisplayDate, formatMonthYear */

const monthInput = document.getElementById("report-month");
const reportBody = document.getElementById("report-body");
const printBtn = document.getElementById("print-btn");

function monthRangeFromInput(value) {
  const [year, month] = value.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    start: toLocalDateString(start),
    end: toLocalDateString(end),
    label: formatMonthYear(toLocalDateString(start)),
  };
}

async function buildReport(monthValue) {
  const { start, end, label } = monthRangeFromInput(monthValue);

  const [summaryRes, loadsRes, settlementsRes, commissionRes] = await Promise.all([
    supabaseClient.from("v_atm_summary").select("*").maybeSingle(),
    supabaseClient
      .from("cash_loads")
      .select("*")
      .gte("load_date", start)
      .lte("load_date", end)
      .order("load_date"),
    supabaseClient
      .from("cash_settlements")
      .select("*")
      .gte("settlement_date", start)
      .lte("settlement_date", end)
      .order("settlement_date"),
    supabaseClient
      .from("commission_settlements")
      .select("*")
      .gte("period_start", start)
      .lte("period_end", end)
      .order("period_start"),
  ]);

  const summary = summaryRes.data || {};
  const loads = loadsRes.data || [];
  const settlements = settlementsRes.data || [];
  const commissions = commissionRes.data || [];

  const loadedMonth = loads.reduce((s, r) => s + Number(r.amount), 0);
  const settledMonth = settlements.reduce((s, r) => s + Number(r.amount), 0);
  const commissionNet = commissions.reduce((s, r) => s + Number(r.net_commission), 0);
  const txnCount = commissions.reduce((s, r) => s + Number(r.transaction_count), 0);

  const loadsRows = loads
    .map(
      (r) =>
        `<tr><td>${formatDisplayDate(r.load_date)}</td><td>${formatINRDecimal(r.amount)}</td><td>${escapeHtml(r.mode)}</td><td>${escapeHtml(r.reference || "—")}</td></tr>`
    )
    .join("");

  const settlementRows = settlements
    .map(
      (r) =>
        `<tr><td>${formatDisplayDate(r.settlement_date)}</td><td>${formatINRDecimal(r.amount)}</td><td>${escapeHtml(r.reference || "—")}</td></tr>`
    )
    .join("");

  const commissionRows = commissions
    .map(
      (r) =>
        `<tr><td>${formatDisplayDate(r.period_start)} – ${formatDisplayDate(r.period_end)}</td><td>${r.transaction_count}</td><td>${formatINRDecimal(r.gross_commission)}</td><td>${formatINRDecimal(r.tds)}</td><td>${formatINRDecimal(r.net_commission)}</td></tr>`
    )
    .join("");

  reportBody.innerHTML = `
    <header class="report-header">
      <h2>${escapeHtml(AppConfig.APP_NAME)}</h2>
      <p class="muted">Monthly reconciliation — ${escapeHtml(label)}</p>
      <p class="muted">Generated ${formatDisplayDate(getLocalDateString())}</p>
    </header>

    <section class="report-kpis">
      <div class="kpi-card"><span class="kpi-label">Cash loaded (month)</span><strong>${formatINR(loadedMonth)}</strong></div>
      <div class="kpi-card"><span class="kpi-label">Cash settled (month)</span><strong>${formatINR(settledMonth)}</strong></div>
      <div class="kpi-card"><span class="kpi-label">Net commission (month)</span><strong>${formatINR(commissionNet)}</strong></div>
      <div class="kpi-card"><span class="kpi-label">Transactions (month)</span><strong>${txnCount}</strong></div>
      <div class="kpi-card"><span class="kpi-label">Cash deployed (all time)</span><strong>${formatINR(summary.cash_deployed)}</strong></div>
    </section>

    <section class="report-section">
      <h3>Cash loads</h3>
      ${loads.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Mode</th><th>Reference</th></tr></thead><tbody>${loadsRows}</tbody></table>` : `<p class="muted">No loads this month.</p>`}
    </section>

    <section class="report-section">
      <h3>Cash settlements</h3>
      ${settlements.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Reference</th></tr></thead><tbody>${settlementRows}</tbody></table>` : `<p class="muted">No settlements this month.</p>`}
    </section>

    <section class="report-section">
      <h3>Commission settlements</h3>
      ${commissions.length ? `<table class="data-table"><thead><tr><th>Period</th><th>Txns</th><th>Gross</th><th>TDS</th><th>Net</th></tr></thead><tbody>${commissionRows}</tbody></table>` : `<p class="muted">No commission this month.</p>`}
    </section>
  `;
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;
  renderTopbar("Reports", "reports.html");

  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const run = () => buildReport(monthInput.value);
  monthInput.addEventListener("change", run);
  printBtn?.addEventListener("click", () => window.print());
  await run();
});
