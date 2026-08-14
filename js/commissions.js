/* global supabaseClient, requireAdmin, renderTopbar, formatINR, formatINRDecimal, formatDisplayDate, showToast */

const commissionForm = document.getElementById("commission-form");
const commissionTable = document.getElementById("commission-table");
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
  renderCommissionTable(data || []);
}

async function handleSubmit(event) {
  event.preventDefault();
  const button = commissionForm.querySelector('button[type="submit"]');
  const user = await getCurrentUser();
  const { txns, rate, tds, gross, net } = calcCommission();

  if (txns <= 0 || rate <= 0) {
    showToast("Enter transactions and rate per txn.", "error");
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
  renderTopbar("Commission", "commissions.html", user);

  const today = getLocalDateString();
  if (commissionForm?.period_start) commissionForm.period_start.value = firstDayOfMonth(today);
  if (commissionForm?.period_end) commissionForm.period_end.value = lastDayOfMonth(today);

  ["transaction_count", "rate_per_txn", "tds"].forEach((name) => {
    commissionForm?.[name]?.addEventListener("input", updatePreview);
  });

  commissionForm?.addEventListener("submit", handleSubmit);
  updatePreview();
  await refreshTable();
});
