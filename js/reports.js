/* global supabaseClient, requireAuth, renderTopbar, isAdmin, formatINR, formatINRDecimal, formatDisplayDate, formatMonthYear, formatDateTime, formatGeo, AppConfig */

const monthInput = document.getElementById("report-month");
const reportBody = document.getElementById("report-body");
const printBtn = document.getElementById("print-btn");

let reportUser = null;

/** Local calendar month → [startIso, endExclusiveIso) for timestamptz filters */
function monthRangeFromInput(value) {
  const [year, month] = String(value || "").split("-").map(Number);
  if (!year || !month) {
    const now = new Date();
    return monthRangeFromInput(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  }
  const start = new Date(year, month - 1, 1);
  const endExclusive = new Date(year, month, 1);
  return {
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
    startDate: toLocalDateString(start),
    endDate: toLocalDateString(new Date(year, month, 0)),
    label: formatMonthYear(toLocalDateString(start)),
  };
}

function metaLine(row) {
  const when =
    typeof formatDateTime === "function"
      ? formatDateTime(row.recorded_at || row.created_at)
      : formatDisplayDate(row.load_date);
  const geo =
    typeof formatGeo === "function"
      ? formatGeo(row.latitude, row.longitude, row.geo_accuracy_m)
      : "";
  return `${when}${geo && geo !== "Location not captured" ? ` · ${geo}` : ""}`;
}

async function buildReport(monthValue) {
  const { startIso, endExclusiveIso, startDate, endDate, label } = monthRangeFromInput(monthValue);
  const admin = isAdmin(reportUser);

  const queries = [
    supabaseClient.from("v_atm_summary").select("*").maybeSingle(),
    supabaseClient
      .from("bank_draws")
      .select("amount, reference, recorded_at, latitude, longitude, geo_accuracy_m")
      .gte("recorded_at", startIso)
      .lt("recorded_at", endExclusiveIso)
      .order("recorded_at"),
    supabaseClient
      .from("cash_loads")
      .select("amount, reference, recorded_at, latitude, longitude, geo_accuracy_m")
      .gte("recorded_at", startIso)
      .lt("recorded_at", endExclusiveIso)
      .order("recorded_at"),
  ];

  if (admin) {
    queries.push(
      supabaseClient
        .from("commission_settlements")
        .select("period_start, period_end, transaction_count, rate_per_txn, net_commission")
        .gte("period_start", startDate)
        .lte("period_end", endDate)
        .order("period_start")
    );
  }

  const results = await Promise.all(queries);
  const [summaryRes, bankRes, loadsRes, commissionRes] = results;

  if (summaryRes.error || bankRes.error || loadsRes.error || commissionRes?.error) {
    const err = summaryRes.error || bankRes.error || loadsRes.error || commissionRes.error;
    showToast(err.message, "error");
  }

  const summary = summaryRes.data || {};
  const banks = bankRes.data || [];
  const loads = loadsRes.data || [];
  const commissions = admin ? commissionRes?.data || [] : [];

  const bankMonth = banks.reduce((s, r) => s + Number(r.amount), 0);
  const loadedMonth = loads.reduce((s, r) => s + Number(r.amount), 0);
  const commissionNet = commissions.reduce((s, r) => s + Number(r.net_commission), 0);
  const txnCount = commissions.reduce((s, r) => s + Number(r.transaction_count), 0);

  const bankRows = banks
    .map(
      (r) =>
        `<tr>
          <td data-label="When">${escapeHtml(metaLine(r))}</td>
          <td data-label="Amount">${formatINRDecimal(r.amount)}</td>
          <td data-label="Reference">${escapeHtml(r.reference || "—")}</td>
        </tr>`
    )
    .join("");

  const loadRows = loads
    .map(
      (r) =>
        `<tr>
          <td data-label="When">${escapeHtml(metaLine(r))}</td>
          <td data-label="Amount">${formatINRDecimal(r.amount)}</td>
          <td data-label="Reference">${escapeHtml(r.reference || "—")}</td>
        </tr>`
    )
    .join("");

  const commissionRows = commissions
    .map(
      (r) =>
        `<tr>
          <td data-label="Period">${formatDisplayDate(r.period_start)} – ${formatDisplayDate(r.period_end)}</td>
          <td data-label="Txns">${r.transaction_count}</td>
          <td data-label="Rate">${r.rate_per_txn != null ? formatINRDecimal(r.rate_per_txn) : "—"}</td>
          <td data-label="Net">${formatINRDecimal(r.net_commission)}</td>
        </tr>`
    )
    .join("");

  const commissionBlock = admin
    ? `
    <section class="report-section">
      <h3>Commission</h3>
      ${
        commissions.length
          ? `<table class="data-table"><thead><tr><th>Period</th><th>Txns</th><th>Rate</th><th>Net</th></tr></thead><tbody>${commissionRows}</tbody></table>`
          : `<p class="muted">No commission this month.</p>`
      }
    </section>`
    : "";

  reportBody.innerHTML = `
    <header class="report-header">
      <h2>${escapeHtml(AppConfig.APP_NAME)} ATM</h2>
      <p class="muted">${escapeHtml(AppConfig.SITE_LINE)}</p>
      <p class="muted">Monthly summary — ${escapeHtml(label)}</p>
      <p class="muted">Generated ${formatDisplayDate(getLocalDateString())}</p>
    </header>

    <section class="report-kpis">
      <div class="kpi-card"><span class="kpi-label">Bank drawn (month)</span><strong>${formatINR(bankMonth)}</strong></div>
      <div class="kpi-card"><span class="kpi-label">ATM loaded (month)</span><strong>${formatINR(loadedMonth)}</strong></div>
      <div class="kpi-card"><span class="kpi-label">Pending to load</span><strong>${formatINR(summary.pending_to_load)}</strong></div>
      <div class="kpi-card"><span class="kpi-label">Total capital</span><strong>${formatINR(summary.total_capital)}</strong></div>
      ${
        admin
          ? `<div class="kpi-card"><span class="kpi-label">Net commission (month)</span><strong>${formatINR(commissionNet)}</strong></div>
             <div class="kpi-card"><span class="kpi-label">Transactions (month)</span><strong>${txnCount}</strong></div>`
          : ""
      }
    </section>

    <section class="report-section">
      <h3>Bank draws</h3>
      ${
        banks.length
          ? `<table class="data-table"><thead><tr><th>When / where</th><th>Amount</th><th>Reference</th></tr></thead><tbody>${bankRows}</tbody></table>`
          : `<p class="muted">No bank draws this month.</p>`
      }
    </section>

    <section class="report-section">
      <h3>ATM loads</h3>
      ${
        loads.length
          ? `<table class="data-table"><thead><tr><th>When / where</th><th>Amount</th><th>Reference</th></tr></thead><tbody>${loadRows}</tbody></table>`
          : `<p class="muted">No ATM loads this month.</p>`
      }
    </section>

    ${commissionBlock}
  `;
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;
  reportUser = user;
  renderTopbar("Reports", "reports.html", user);

  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const run = () => buildReport(monthInput.value);
  monthInput.addEventListener("change", run);
  printBtn?.addEventListener("click", () => window.print());
  await run();
});
