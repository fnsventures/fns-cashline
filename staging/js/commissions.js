/* global supabaseClient, requireAdmin, renderTopbar, formatINR, formatINRDecimal, formatDisplayDate, formatMonthYear, showToast */

const commissionForm = document.getElementById("commission-form");
const commissionTable = document.getElementById("commission-table");
const commissionTrack = document.getElementById("commission-track");
const trackMonth = document.getElementById("track-month");
const previewEl = document.getElementById("commission-preview");
const previewDetailEl = document.getElementById("commission-preview-detail");

function firstDayOfMonth(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return toLocalDateString(new Date(d.getFullYear(), d.getMonth(), 1));
}

function lastDayOfMonth(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return toLocalDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function monthRangeFromInput(value) {
  const [year, month] = String(value || "").split("-").map(Number);
  if (!year || !month) {
    const now = new Date();
    return monthRangeFromInput(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  }
  const start = new Date(year, month - 1, 1);
  return {
    year,
    month,
    startDate: toLocalDateString(start),
    endDate: toLocalDateString(new Date(year, month, 0)),
    label: formatMonthYear(toLocalDateString(start)),
  };
}

function calcCommission() {
  const txns = Number(commissionForm.transaction_count.value) || 0;
  const rate = Number(commissionForm.rate_per_txn.value) || 0;
  const tds = Number(commissionForm.tds.value) || 0;
  const gross = Math.round(txns * rate * 100) / 100;
  const net = Math.max(0, Math.round((gross - tds) * 100) / 100);
  return { txns, rate, tds, gross, net };
}

function updatePreview() {
  const { txns, rate, tds, gross, net } = calcCommission();
  if (previewEl) previewEl.textContent = formatINR(net);
  if (previewDetailEl) {
    previewDetailEl.textContent = `${txns} txn × ${formatINRDecimal(rate)} = ${formatINRDecimal(gross)} − TDS ${formatINRDecimal(tds)}`;
  }
}

async function fetchCommissions() {
  return supabaseClient
    .from("commission_settlements")
    .select("*")
    .order("period_start", { ascending: false });
}

function aggregateByMonth(rows, year) {
  const months = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(year, i, 1);
    return {
      label: formatMonthYear(toLocalDateString(start)),
      shortLabel: start.toLocaleDateString("en-IN", { month: "short" }),
      txns: 0,
      net: 0,
      gross: 0,
      tds: 0,
      entries: 0,
    };
  });
  for (const row of rows) {
    const d = new Date(`${row.period_start}T12:00:00`);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue;
    const bucket = months[d.getMonth()];
    bucket.txns += Number(row.transaction_count) || 0;
    bucket.net += Number(row.net_commission) || 0;
    bucket.gross += Number(row.gross_commission) || 0;
    bucket.tds += Number(row.tds) || 0;
    bucket.entries += 1;
  }
  return months;
}

function renderTrack(rows) {
  if (!commissionTrack || !trackMonth) return;
  const range = monthRangeFromInput(trackMonth.value);
  const monthRows = rows.filter((r) => r.period_start >= range.startDate && r.period_start <= range.endDate);
  const yearRows = rows.filter((r) => String(r.period_start || "").startsWith(String(range.year)));

  const monthNet = monthRows.reduce((s, r) => s + Number(r.net_commission), 0);
  const monthTxns = monthRows.reduce((s, r) => s + Number(r.transaction_count), 0);
  const monthGross = monthRows.reduce((s, r) => s + Number(r.gross_commission), 0);
  const monthTds = monthRows.reduce((s, r) => s + Number(r.tds), 0);
  const yearNet = yearRows.reduce((s, r) => s + Number(r.net_commission), 0);
  const yearTxns = yearRows.reduce((s, r) => s + Number(r.transaction_count), 0);

  const byMonth = aggregateByMonth(yearRows, range.year);
  const maxNet = Math.max(...byMonth.map((m) => m.net), 1);
  const chart = byMonth
    .map((m) => {
      const pct = Math.max(2, Math.round((m.net / maxNet) * 100));
      return `<div class="track-bar" title="${escapeHtml(m.label)}: ${formatINR(m.net)}">
        <div class="track-bar__fill" style="height:${m.net > 0 ? pct : 2}%"></div>
        <span class="track-bar__label">${escapeHtml(m.shortLabel)}</span>
      </div>`;
    })
    .join("");

  const monthlyTable = byMonth
    .filter((m) => m.entries > 0)
    .map(
      (m) => `<tr>
        <td data-label="Month">${escapeHtml(m.label)}</td>
        <td data-label="Txns">${m.txns}</td>
        <td data-label="Gross">${formatINRDecimal(m.gross)}</td>
        <td data-label="TDS">${formatINRDecimal(m.tds)}</td>
        <td data-label="Net">${formatINRDecimal(m.net)}</td>
      </tr>`
    )
    .join("");

  commissionTrack.innerHTML = `
    <section class="report-kpis" style="margin-top:1rem">
      <div class="kpi-card"><span class="kpi-label">Net (${escapeHtml(range.label)})</span><strong>${formatINR(
        monthNet
      )}</strong></div>
      <div class="kpi-card"><span class="kpi-label">Txns (month)</span><strong>${monthTxns}</strong></div>
      <div class="kpi-card"><span class="kpi-label">Gross (month)</span><strong>${formatINR(monthGross)}</strong></div>
      <div class="kpi-card"><span class="kpi-label">TDS (month)</span><strong>${formatINR(monthTds)}</strong></div>
      <div class="kpi-card"><span class="kpi-label">Net YTD ${range.year}</span><strong>${formatINR(yearNet)}</strong></div>
      <div class="kpi-card"><span class="kpi-label">Txns YTD ${range.year}</span><strong>${yearTxns}</strong></div>
    </section>
    <section class="report-section">
      <h3>Monthly net (${range.year})</h3>
      <div class="track-chart">${chart}</div>
      ${
        monthlyTable
          ? `<table class="data-table" style="margin-top:1rem"><thead><tr><th>Month</th><th>Txns</th><th>Gross</th><th>TDS</th><th>Net</th></tr></thead><tbody>${monthlyTable}</tbody></table>`
          : `<p class="muted">No settlements in ${range.year} yet.</p>`
      }
    </section>
  `;
}

function renderCommissionTable(rows) {
  if (!commissionTable) return;
  commissionTable.innerHTML = rows.length
    ? `<table class="data-table"><thead><tr><th>Period</th><th>Txns</th><th>Rate</th><th>Gross</th><th>TDS</th><th>Net</th><th>Paid</th></tr></thead><tbody>${rows
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
        .join("")}</tbody></table>`
    : `<p class="muted">No commission entries yet.</p>`;
}

async function refreshTable() {
  const { data, error } = await fetchCommissions();
  if (error) {
    showToast(error.message, "error");
    return;
  }
  const rows = data || [];
  renderCommissionTable(rows);
  renderTrack(rows);
}

async function handleSubmit(event) {
  event.preventDefault();
  const button = commissionForm.querySelector('button[type="submit"]');
  const user = await getCurrentUser();
  const { txns, rate, tds, gross, net } = calcCommission();

  if (txns <= 0 || rate <= 0) {
    showToast("Enter transactions and rate per transaction.", "error");
    return;
  }

  const payload = {
    period_start: commissionForm.period_start.value,
    period_end: commissionForm.period_end.value,
    transaction_count: txns,
    rate_per_txn: rate,
    gross_commission: gross,
    tds,
    net_commission: net,
    paid_on: commissionForm.paid_on.value || null,
    reference: commissionForm.reference.value.trim() || null,
    notes: commissionForm.notes.value.trim() || null,
    created_by: user?.id || null,
  };

  setButtonLoading(button, true, "Saving…");
  const { error } = await supabaseClient.from("commission_settlements").insert(payload);
  setButtonLoading(button, false);

  if (error) {
    showToast(error.message, "error");
    return;
  }

  commissionForm.reset();
  const today = getLocalDateString();
  commissionForm.period_start.value = firstDayOfMonth(today);
  commissionForm.period_end.value = lastDayOfMonth(today);
  commissionForm.tds.value = "0";
  updatePreview();
  showToast(`Commission saved: ${formatINR(net)}.`, "success");
  await refreshTable();
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return;
  renderTopbar("Commissions", "commissions.html", user);

  const today = getLocalDateString();
  const now = new Date();
  if (trackMonth) {
    trackMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    trackMonth.addEventListener("change", refreshTable);
  }
  if (commissionForm?.period_start) commissionForm.period_start.value = firstDayOfMonth(today);
  if (commissionForm?.period_end) commissionForm.period_end.value = lastDayOfMonth(today);

  ["transaction_count", "rate_per_txn", "tds"].forEach((name) => {
    commissionForm?.[name]?.addEventListener("input", updatePreview);
  });

  commissionForm?.addEventListener("submit", handleSubmit);
  updatePreview();
  await refreshTable();
});
