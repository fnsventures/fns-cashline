/* global supabaseClient, requireAuth, renderTopbar, isAdmin, formatINR, formatINRDecimal, formatDisplayDate, formatMonthYear, AppConfig, AtmCycle */

const monthInput = document.getElementById("report-month");
const yearInput = document.getElementById("report-year");
const yearWrap = document.getElementById("report-year-wrap");
const reportBody = document.getElementById("report-body");
const printBtn = document.getElementById("print-btn");
const commissionTab = document.getElementById("commission-tab");
const segmentBtns = Array.from(document.querySelectorAll("[data-report]"));

let reportUser = null;
let activeReport = "daily";

/** Local calendar month → range helpers for timestamptz / date filters */
function monthRangeFromInput(value) {
  const [year, month] = String(value || "").split("-").map(Number);
  if (!year || !month) {
    const now = new Date();
    return monthRangeFromInput(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  }
  const start = new Date(year, month - 1, 1);
  const endExclusive = new Date(year, month, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    year,
    month,
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
    startDate: toLocalDateString(start),
    endDate: toLocalDateString(new Date(year, month, 0)),
    daysInMonth,
    label: formatMonthYear(toLocalDateString(start)),
  };
}

function yearRange(year) {
  const y = Number(year) || new Date().getFullYear();
  const start = new Date(y, 0, 1);
  const endExclusive = new Date(y + 1, 0, 1);
  return {
    year: y,
    startDate: toLocalDateString(start),
    endDate: toLocalDateString(new Date(y, 11, 31)),
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
  };
}

function metaLine(row) {
  return AtmCycle.metaLineText(row);
}

function inquiryStatus(row) {
  return AtmCycle.inquiryStatus(row);
}

function weekdayShort(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { weekday: "short" });
}

function dayLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function maxOf(values) {
  return values.reduce((m, v) => Math.max(m, Number(v) || 0), 0);
}

function barChartHtml(items, { valueKey = "value", labelKey = "label", empty = "No data." } = {}) {
  if (!items.length) return `<p class="muted">${escapeHtml(empty)}</p>`;
  const max = Math.max(maxOf(items.map((i) => i[valueKey])), 1);
  return `<div class="track-chart" role="img" aria-label="Amount by day">
    ${items
      .map((item) => {
        const value = Number(item[valueKey]) || 0;
        const pct = Math.max(2, Math.round((value / max) * 100));
        const title = `${item[labelKey]}: ${formatINR(value)}`;
        return `<div class="track-bar" title="${escapeHtml(title)}">
          <div class="track-bar__fill" style="height:${pct}%"></div>
          <span class="track-bar__label">${escapeHtml(item.shortLabel || item[labelKey])}</span>
        </div>`;
      })
      .join("")}
  </div>`;
}

function reportHeader(subtitle) {
  return `<header class="report-header">
      <h2>${escapeHtml(AppConfig.PRODUCT_NAME || AppConfig.APP_NAME)}</h2>
      <p class="muted">${escapeHtml(AppConfig.SITE_LINE)}</p>
      <p class="muted">${escapeHtml(subtitle)}</p>
      <p class="muted">Generated ${formatDisplayDate(getLocalDateString())}</p>
    </header>`;
}

function kpiHtml(items) {
  return `<section class="report-kpis">${items
    .map(
      (k) =>
        `<div class="kpi-card"><span class="kpi-label">${escapeHtml(k.label)}</span><strong>${escapeHtml(
          k.value
        )}</strong>${k.hint ? `<span class="kpi-hint">${escapeHtml(k.hint)}</span>` : ""}</div>`
    )
    .join("")}</section>`;
}

/** Build day-by-day cash track for a month */
function buildDailyCashRows(range, inquiries, loads) {
  const byDate = new Map();
  for (let day = 1; day <= range.daysInMonth; day++) {
    const date = `${range.year}-${String(range.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    byDate.set(date, {
      date,
      dispensed: 0,
      loaded: 0,
      inquiry: null,
      loadCount: 0,
    });
  }

  for (const row of inquiries) {
    const date = row.inquiry_date || toLocalDateString(row.recorded_at);
    const bucket = byDate.get(date);
    if (!bucket) continue;
    bucket.dispensed += Number(row.dispensed) || 0;
    bucket.inquiry = row;
  }

  for (const row of loads) {
    const date = row.load_date || toLocalDateString(row.recorded_at);
    const bucket = byDate.get(date) || {
      date,
      dispensed: 0,
      loaded: 0,
      inquiry: null,
      loadCount: 0,
    };
    bucket.loaded += Number(row.amount) || 0;
    bucket.loadCount += 1;
    byDate.set(date, bucket);
  }

  return Array.from(byDate.values());
}

function activeDays(dailyRows) {
  return dailyRows.filter((d) => d.dispensed > 0 || d.loaded > 0 || d.inquiry);
}

async function fetchCashMonth(range) {
  const [summaryRes, inquiryRes, loadsRes] = await Promise.all([
    supabaseClient.from("v_atm_summary").select("*").maybeSingle(),
    supabaseClient
      .from("atm_inquiries")
      .select(
        "inquiry_date, opening_balance, cash_left, dispensed, reference, recorded_at, replenished_at, latitude, longitude, geo_accuracy_m"
      )
      .gte("recorded_at", range.startIso)
      .lt("recorded_at", range.endExclusiveIso)
      .order("recorded_at"),
    supabaseClient
      .from("cash_loads")
      .select("load_date, amount, reference, recorded_at, latitude, longitude, geo_accuracy_m")
      .gte("recorded_at", range.startIso)
      .lt("recorded_at", range.endExclusiveIso)
      .order("recorded_at"),
  ]);

  if (summaryRes.error || inquiryRes.error || loadsRes.error) {
    throw summaryRes.error || inquiryRes.error || loadsRes.error;
  }

  return {
    summary: summaryRes.data || {},
    inquiries: inquiryRes.data || [],
    loads: loadsRes.data || [],
  };
}

async function fetchCommissionsForMonth(range) {
  const { data, error } = await supabaseClient
    .from("commission_settlements")
    .select("*")
    .gte("period_start", range.startDate)
    .lte("period_start", range.endDate)
    .order("period_start");
  if (error) throw error;
  return data || [];
}

async function fetchCommissionsForYear(yr) {
  const { data, error } = await supabaseClient
    .from("commission_settlements")
    .select("*")
    .gte("period_start", yr.startDate)
    .lte("period_start", yr.endDate)
    .order("period_start");
  if (error) throw error;
  return data || [];
}

async function fetchInquiriesForYear(yr) {
  const { data, error } = await supabaseClient
    .from("atm_inquiries")
    .select("inquiry_date, dispensed, recorded_at")
    .gte("recorded_at", yr.startIso)
    .lt("recorded_at", yr.endExclusiveIso)
    .order("recorded_at");
  if (error) throw error;
  return data || [];
}

function renderDailyTrack(range, { inquiries, loads, summary }) {
  const daily = buildDailyCashRows(range, inquiries, loads);
  const tracked = activeDays(daily);
  const dispensedMonth = tracked.reduce((s, d) => s + d.dispensed, 0);
  const loadedMonth = tracked.reduce((s, d) => s + d.loaded, 0);
  const avgDaily = tracked.length ? dispensedMonth / tracked.length : 0;
  const peak = tracked.reduce((best, d) => (d.dispensed > (best?.dispensed || 0) ? d : best), null);

  const chartItems = tracked.map((d) => ({
    label: formatDisplayDate(d.date),
    shortLabel: String(Number(d.date.slice(-2))),
    value: d.dispensed,
  }));

  const tableRows = tracked
    .map((d) => {
      const status = d.inquiry ? inquiryStatus(d.inquiry) : d.loaded > 0 ? "Load only" : "—";
      return `<tr>
        <td data-label="Date">${escapeHtml(dayLabel(d.date))} <span class="muted">${escapeHtml(
          weekdayShort(d.date)
        )}</span></td>
        <td data-label="Dispensed">${formatINRDecimal(d.dispensed)}</td>
        <td data-label="ATM load">${formatINRDecimal(d.loaded)}</td>
        <td data-label="Status">${escapeHtml(status)}</td>
      </tr>`;
    })
    .join("");

  reportBody.innerHTML = `
    ${reportHeader(`Daily transaction track — ${range.label}`)}
    ${kpiHtml([
      { label: "Dispensed (month)", value: formatINR(dispensedMonth) },
      { label: "ATM load (month)", value: formatINR(loadedMonth) },
      { label: "Days with activity", value: String(tracked.length) },
      { label: "Avg daily dispensed", value: formatINR(avgDaily), hint: "On active days" },
      {
        label: "Peak day",
        value: peak ? formatINR(peak.dispensed) : "—",
        hint: peak ? formatDisplayDate(peak.date) : "",
      },
      { label: "Cash in ATM now", value: formatINR(summary.cash_in_atm) },
    ])}
    <section class="report-section">
      <h3>Daily dispensed amount</h3>
      <p class="muted report-lead">Customer withdrawals (opening − cash left) by inquiry date.</p>
      ${barChartHtml(chartItems, { empty: "No inquiries this month." })}
    </section>
    <section class="report-section">
      <h3>Day-by-day</h3>
      ${
        tracked.length
          ? `<table class="data-table"><thead><tr><th>Date</th><th>Dispensed</th><th>ATM load</th><th>Status</th></tr></thead><tbody>${tableRows}</tbody>
            <tfoot><tr>
              <td data-label="">Total</td>
              <td data-label="Dispensed">${formatINRDecimal(dispensedMonth)}</td>
              <td data-label="ATM load">${formatINRDecimal(loadedMonth)}</td>
              <td data-label=""></td>
            </tr></tfoot></table>`
          : `<p class="muted">No daily activity this month.</p>`
      }
    </section>
  `;
}

function renderMonthlyReport(range, { inquiries, loads, summary }, yearMonthly) {
  const daily = buildDailyCashRows(range, inquiries, loads);
  const tracked = activeDays(daily);
  const dispensedMonth = inquiries.reduce((s, r) => s + Number(r.dispensed), 0);
  const loadedMonth = loads.reduce((s, r) => s + Number(r.amount), 0);
  const avgDaily = tracked.length ? dispensedMonth / tracked.length : 0;
  const peak = tracked.reduce((best, d) => (d.dispensed > (best?.dispensed || 0) ? d : best), null);

  const yearChart = yearMonthly.map((m) => ({
    label: m.label,
    shortLabel: m.shortLabel,
    value: m.dispensed,
  }));

  const inquiryRows = inquiries
    .map(
      (r) => `<tr>
          <td data-label="Date">${escapeHtml(metaLine(r))}</td>
          <td data-label="Opening">${formatINRDecimal(r.opening_balance)}</td>
          <td data-label="Closing">${formatINRDecimal(r.cash_left)}</td>
          <td data-label="Dispensed">${formatINRDecimal(r.dispensed)}</td>
          <td data-label="Status">${escapeHtml(inquiryStatus(r))}</td>
        </tr>`
    )
    .join("");

  const loadRows = loads
    .map(
      (r) =>
        `<tr>
          <td data-label="Date">${escapeHtml(metaLine(r))}</td>
          <td data-label="Amount">${formatINRDecimal(r.amount)}</td>
          <td data-label="Reference">${escapeHtml(r.reference || "—")}</td>
        </tr>`
    )
    .join("");

  const monthRollupRows = yearMonthly
    .filter((m) => m.dispensed > 0 || m.days > 0)
    .map(
      (m) => `<tr>
        <td data-label="Month">${escapeHtml(m.label)}</td>
        <td data-label="Days">${m.days}</td>
        <td data-label="Dispensed">${formatINRDecimal(m.dispensed)}</td>
        <td data-label="Avg / day">${formatINRDecimal(m.days ? m.dispensed / m.days : 0)}</td>
      </tr>`
    )
    .join("");

  reportBody.innerHTML = `
    ${reportHeader(`Monthly summary — ${range.label}`)}
    ${kpiHtml([
      { label: "Cash in ATM", value: formatINR(summary.cash_in_atm) },
      { label: "Pending to load", value: formatINR(AtmCycle.deriveCycleState(summary).pending) },
      { label: "Dispensed (month)", value: formatINR(dispensedMonth) },
      { label: "ATM load (month)", value: formatINR(loadedMonth) },
      { label: "Avg daily dispensed", value: formatINR(avgDaily) },
      {
        label: "Peak day",
        value: peak ? formatINR(peak.dispensed) : "—",
        hint: peak ? formatDisplayDate(peak.date) : "",
      },
      { label: "Inquiries", value: String(inquiries.length) },
      { label: "Total capital", value: formatINR(summary.total_capital) },
    ])}
    <section class="report-section">
      <h3>Year overview — dispensed by month (${range.year})</h3>
      ${barChartHtml(yearChart, { empty: "No inquiries this year." })}
      ${
        monthRollupRows
          ? `<table class="data-table" style="margin-top:1rem"><thead><tr><th>Month</th><th>Days</th><th>Dispensed</th><th>Avg / day</th></tr></thead><tbody>${monthRollupRows}</tbody></table>`
          : ""
      }
    </section>
    <section class="report-section">
      <h3>Night inquiries</h3>
      ${
        inquiries.length
          ? `<table class="data-table"><thead><tr><th>Date &amp; location</th><th>Opening</th><th>Closing</th><th>Dispensed</th><th>Status</th></tr></thead><tbody>${inquiryRows}</tbody></table>`
          : `<p class="muted">No night inquiries this month.</p>`
      }
    </section>
    <section class="report-section">
      <h3>ATM loads</h3>
      ${
        loads.length
          ? `<table class="data-table"><thead><tr><th>Date &amp; location</th><th>Amount</th><th>Reference</th></tr></thead><tbody>${loadRows}</tbody></table>`
          : `<p class="muted">No ATM loads this month.</p>`
      }
    </section>
  `;
}

function aggregateCommissionByMonth(settlements, year) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const start = new Date(year, m - 1, 1);
    months.push({
      month: m,
      label: formatMonthYear(toLocalDateString(start)),
      shortLabel: start.toLocaleDateString("en-IN", { month: "short" }),
      txns: 0,
      gross: 0,
      tds: 0,
      net: 0,
      entries: 0,
    });
  }
  for (const row of settlements) {
    const d = new Date(`${row.period_start}T12:00:00`);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue;
    const bucket = months[d.getMonth()];
    bucket.txns += Number(row.transaction_count) || 0;
    bucket.gross += Number(row.gross_commission) || 0;
    bucket.tds += Number(row.tds) || 0;
    bucket.net += Number(row.net_commission) || 0;
    bucket.entries += 1;
  }
  return months;
}

function aggregateDispensedByMonth(inquiries, year) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const start = new Date(year, m - 1, 1);
    months.push({
      month: m,
      label: formatMonthYear(toLocalDateString(start)),
      shortLabel: start.toLocaleDateString("en-IN", { month: "short" }),
      dispensed: 0,
      days: 0,
    });
  }
  const seenDays = new Set();
  for (const row of inquiries) {
    const date = row.inquiry_date || toLocalDateString(row.recorded_at);
    const d = new Date(`${date}T12:00:00`);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue;
    const bucket = months[d.getMonth()];
    bucket.dispensed += Number(row.dispensed) || 0;
    if (!seenDays.has(date)) {
      seenDays.add(date);
      bucket.days += 1;
    }
  }
  return months;
}

function renderCommissionReport(range, monthSettlements, yearSettlements) {
  const monthNet = monthSettlements.reduce((s, r) => s + Number(r.net_commission), 0);
  const monthGross = monthSettlements.reduce((s, r) => s + Number(r.gross_commission), 0);
  const monthTds = monthSettlements.reduce((s, r) => s + Number(r.tds), 0);
  const monthTxns = monthSettlements.reduce((s, r) => s + Number(r.transaction_count), 0);
  const avgRate =
    monthTxns > 0
      ? monthSettlements.reduce((s, r) => s + Number(r.rate_per_txn || 0) * Number(r.transaction_count || 0), 0) /
        monthTxns
      : 0;

  const byMonth = aggregateCommissionByMonth(yearSettlements, range.year);
  const yearNet = byMonth.reduce((s, m) => s + m.net, 0);
  const yearTxns = byMonth.reduce((s, m) => s + m.txns, 0);

  const chartItems = byMonth.map((m) => ({
    label: m.label,
    shortLabel: m.shortLabel,
    value: m.net,
  }));

  const settlementRows = monthSettlements
    .map(
      (r) => `<tr>
        <td data-label="Period">${formatDisplayDate(r.period_start)} – ${formatDisplayDate(r.period_end)}</td>
        <td data-label="Txns">${r.transaction_count}</td>
        <td data-label="Rate">${r.rate_per_txn != null ? formatINRDecimal(r.rate_per_txn) : "—"}</td>
        <td data-label="Gross">${formatINRDecimal(r.gross_commission)}</td>
        <td data-label="TDS">${formatINRDecimal(r.tds)}</td>
        <td data-label="Net">${formatINRDecimal(r.net_commission)}</td>
        <td data-label="Paid">${r.paid_on ? formatDisplayDate(r.paid_on) : "—"}</td>
      </tr>`
    )
    .join("");

  const monthlyRows = byMonth
    .filter((m) => m.entries > 0)
    .map(
      (m) => `<tr>
        <td data-label="Month">${escapeHtml(m.label)}</td>
        <td data-label="Entries">${m.entries}</td>
        <td data-label="Txns">${m.txns}</td>
        <td data-label="Gross">${formatINRDecimal(m.gross)}</td>
        <td data-label="TDS">${formatINRDecimal(m.tds)}</td>
        <td data-label="Net">${formatINRDecimal(m.net)}</td>
      </tr>`
    )
    .join("");

  reportBody.innerHTML = `
    ${reportHeader(`Commission report — ${range.label}`)}
    ${kpiHtml([
      { label: "Net commission (month)", value: formatINR(monthNet) },
      { label: "Gross (month)", value: formatINR(monthGross) },
      { label: "TDS (month)", value: formatINR(monthTds) },
      { label: "Transactions (month)", value: String(monthTxns) },
      { label: "Effective rate", value: formatINRDecimal(avgRate), hint: "Weighted by txns" },
      { label: `Net YTD ${range.year}`, value: formatINR(yearNet) },
      { label: `Txns YTD ${range.year}`, value: String(yearTxns) },
    ])}
    <section class="report-section">
      <h3>Monthly commission track (${range.year})</h3>
      <p class="muted report-lead">Net commission by settlement period start month.</p>
      ${barChartHtml(chartItems, { empty: "No commission settlements this year." })}
      ${
        monthlyRows
          ? `<table class="data-table" style="margin-top:1rem"><thead><tr><th>Month</th><th>Entries</th><th>Txns</th><th>Gross</th><th>TDS</th><th>Net</th></tr></thead><tbody>${monthlyRows}</tbody>
            <tfoot><tr>
              <td data-label="">Year total</td>
              <td data-label=""></td>
              <td data-label="Txns">${yearTxns}</td>
              <td data-label="Gross">${formatINRDecimal(byMonth.reduce((s, m) => s + m.gross, 0))}</td>
              <td data-label="TDS">${formatINRDecimal(byMonth.reduce((s, m) => s + m.tds, 0))}</td>
              <td data-label="Net">${formatINRDecimal(yearNet)}</td>
            </tr></tfoot></table>`
          : ""
      }
    </section>
    <section class="report-section">
      <h3>Settlements in ${escapeHtml(range.label)}</h3>
      ${
        monthSettlements.length
          ? `<table class="data-table"><thead><tr><th>Period</th><th>Txns</th><th>Rate</th><th>Gross</th><th>TDS</th><th>Net</th><th>Paid</th></tr></thead><tbody>${settlementRows}</tbody></table>`
          : `<p class="muted">No commission settlements starting this month.</p>`
      }
    </section>
  `;
}

function syncControls() {
  const isCommission = activeReport === "commission";
  if (yearWrap) yearWrap.hidden = !isCommission;
  segmentBtns.forEach((btn) => {
    const on = btn.dataset.report === activeReport;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

async function buildReport() {
  const range = monthRangeFromInput(monthInput.value);
  if (yearInput && !yearInput.value) yearInput.value = String(range.year);
  if (activeReport === "commission" && yearInput?.value) {
    range.year = Number(yearInput.value) || range.year;
  }
  syncControls();
  reportBody.innerHTML = `<p class="muted">Loading report…</p>`;

  try {
    if (activeReport === "daily") {
      const data = await fetchCashMonth(range);
      renderDailyTrack(range, data);
      return;
    }

    if (activeReport === "monthly") {
      const yr = yearRange(range.year);
      const [data, yearInquiries] = await Promise.all([fetchCashMonth(range), fetchInquiriesForYear(yr)]);
      const yearMonthly = aggregateDispensedByMonth(yearInquiries, range.year);
      renderMonthlyReport(range, data, yearMonthly);
      return;
    }

    if (activeReport === "commission") {
      if (!isAdmin(reportUser)) {
        reportBody.innerHTML = `<p class="muted">Commission reports are admin only.</p>`;
        return;
      }
      const yr = yearRange(yearInput?.value || range.year);
      const commissionRange = { ...range, year: yr.year };
      const [monthSettlements, yearSettlements] = await Promise.all([
        fetchCommissionsForMonth(range),
        fetchCommissionsForYear(yr),
      ]);
      renderCommissionReport(commissionRange, monthSettlements, yearSettlements);
    }
  } catch (err) {
    showToast(err.message || "Failed to load report", "error");
    reportBody.innerHTML = `<p class="muted">Could not load report.</p>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;
  reportUser = user;
  renderTopbar("Reports", "reports.html", user);

  const admin = isAdmin(user);
  if (commissionTab) commissionTab.hidden = !admin;

  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (yearInput) yearInput.value = String(now.getFullYear());

  segmentBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.hidden) return;
      activeReport = btn.dataset.report;
      buildReport();
    });
  });

  monthInput.addEventListener("change", () => {
    if (yearInput && monthInput.value) {
      yearInput.value = monthInput.value.slice(0, 4);
    }
    buildReport();
  });
  yearInput?.addEventListener("change", () => buildReport());
  printBtn?.addEventListener("click", () => window.print());

  await buildReport();
});
