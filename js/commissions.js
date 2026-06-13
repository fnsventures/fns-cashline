/* global supabaseClient, requireAuth, renderTopbar, formatINRDecimal, formatDisplayDate, showToast */

const commissionForm = document.getElementById("commission-form");
const commissionTable = document.getElementById("commission-table");

function firstDayOfMonth(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return toLocalDateString(new Date(d.getFullYear(), d.getMonth(), 1));
}

function lastDayOfMonth(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return toLocalDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function updateNetPreview() {
  const gross = Number(commissionForm.gross_commission.value) || 0;
  const tds = Number(commissionForm.tds.value) || 0;
  const netField = commissionForm.net_commission;
  if (netField && !netField.dataset.manual) {
    netField.value = Math.max(0, gross - tds).toFixed(2);
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
    ? `<table class="data-table"><thead><tr><th>Period</th><th>Txns</th><th>Gross</th><th>TDS</th><th>Net</th><th>Paid on</th><th>Reference</th></tr></thead><tbody>${rows
        .map((r) => {
          const perTxn =
            r.transaction_count > 0
              ? ` <span class="muted">(${formatINRDecimal(r.net_commission / r.transaction_count)}/txn)</span>`
              : "";
          return `<tr>
            <td>${formatDisplayDate(r.period_start)} – ${formatDisplayDate(r.period_end)}</td>
            <td>${r.transaction_count}${perTxn}</td>
            <td>${formatINRDecimal(r.gross_commission)}</td>
            <td>${formatINRDecimal(r.tds)}</td>
            <td>${formatINRDecimal(r.net_commission)}</td>
            <td>${r.paid_on ? formatDisplayDate(r.paid_on) : "—"}</td>
            <td>${escapeHtml(r.reference || "—")}</td>
          </tr>`;
        })
        .join("")}</tbody></table>`
    : `<p class="muted">No commission settlements yet.</p>`;
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

  const payload = {
    period_start: commissionForm.period_start.value,
    period_end: commissionForm.period_end.value,
    transaction_count: Number(commissionForm.transaction_count.value) || 0,
    gross_commission: Number(commissionForm.gross_commission.value) || 0,
    tds: Number(commissionForm.tds.value) || 0,
    net_commission: Number(commissionForm.net_commission.value) || 0,
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
  showToast("Commission settlement recorded.", "success");
  await refreshTable();
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;
  renderTopbar("Commission settlements", "commissions.html");

  const today = getLocalDateString();
  if (commissionForm?.period_start) commissionForm.period_start.value = firstDayOfMonth(today);
  if (commissionForm?.period_end) commissionForm.period_end.value = lastDayOfMonth(today);

  commissionForm?.gross_commission?.addEventListener("input", updateNetPreview);
  commissionForm?.tds?.addEventListener("input", updateNetPreview);
  commissionForm?.net_commission?.addEventListener("input", () => {
    commissionForm.net_commission.dataset.manual = "1";
  });

  commissionForm?.addEventListener("submit", handleSubmit);
  await refreshTable();
});
