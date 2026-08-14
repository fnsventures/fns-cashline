/* global supabaseClient, requireAuth, renderTopbar, isAdmin, formatINR, formatINRDecimal, showToast, bindReceiptPreview, clearReceiptPreview, bindLiveClock, refreshGeoStatus, escapeHtml, setButtonLoading, parseAmount, rpcErrorMessage, AMOUNT_EPS, AtmCycle, submitWithReceiptRpc, AppConfig, getReceiptSignedUrlMap, receiptLinkFromMap, removeReceipt */

const inquiryForm = document.getElementById("inquiry-form");
const replenishForm = document.getElementById("replenish-form");
const inquiryTable = document.getElementById("inquiry-table");
const replenishTable = document.getElementById("replenish-table");
const geoStatus = document.getElementById("geo-status");
const geoRefreshBtn = document.getElementById("geo-refresh");
const cashLeftInput = document.getElementById("cash_left");
const loadAmountInput = document.getElementById("load_amount");

const els = {
  cashInAtm: document.getElementById("kpi-cash-in-atm"),
  pendingReplenish: document.getElementById("kpi-pending-replenish"),
  cycleState: document.getElementById("kpi-cycle-state"),
  cycleDetail: document.getElementById("cycle-detail"),
  opening: document.getElementById("kpi-opening"),
  dispensedPreview: document.getElementById("kpi-dispensed-preview"),
  replenishAmount: document.getElementById("kpi-replenish-amount"),
  replenishSubmit: document.getElementById("replenish-submit"),
  replenishHelp: document.getElementById("replenish-help"),
  adminLoadNote: document.getElementById("admin-load-note"),
  adminAmountWrap: document.getElementById("admin-amount-wrap"),
  lockedAmountBox: document.getElementById("locked-amount-box"),
  inquiryCard: document.getElementById("inquiry-card"),
  replenishCard: document.getElementById("replenish-card"),
};

const geoState = {
  latitude: null,
  longitude: null,
  geo_accuracy_m: null,
  error: null,
};

let pageUser = null;
let saving = false;
let cycle = {
  openingBalance: 0,
  pendingReplenish: 0,
  openInquiryId: null,
  cashInAtm: 0,
  capital: 0,
  openCashLeft: null,
};

async function requireFreshGeo() {
  await refreshGeoStatus(geoStatus, geoState);
  if (geoState.latitude == null || geoState.longitude == null) {
    showToast("Location required. Enable GPS and tap Refresh location.", "error");
    return false;
  }
  return true;
}

function updateDispensedPreview() {
  const left = Number(cashLeftInput?.value);
  const opening = Number(cycle.openingBalance) || 0;
  if (!Number.isFinite(left) || left < 0) {
    if (els.dispensedPreview) els.dispensedPreview.textContent = "—";
    return;
  }
  const dispensed = Math.max(0, Math.round((opening - left) * 100) / 100);
  if (els.dispensedPreview) {
    els.dispensedPreview.textContent =
      left > opening + AMOUNT_EPS ? "Invalid (above opening balance)" : formatINR(dispensed);
  }
}

function applyCycleUi(summary) {
  const state = AtmCycle.deriveCycleState(summary);
  const admin = isAdmin(pageUser);

  cycle.cashInAtm = state.cashInAtm;
  cycle.pendingReplenish = state.pending;
  cycle.openInquiryId = state.openId;
  cycle.openingBalance = state.openingBalance;
  cycle.capital = state.capital;
  cycle.openCashLeft = state.openLeft;

  if (els.cashInAtm) els.cashInAtm.textContent = formatINR(state.cashInAtm);
  if (els.pendingReplenish) els.pendingReplenish.textContent = formatINR(state.pending);
  if (els.opening) els.opening.textContent = formatINR(state.openingBalance);
  if (els.replenishAmount) els.replenishAmount.textContent = formatINR(state.pending);

  if (els.cycleState) {
    els.cycleState.textContent = state.hasOpen
      ? state.due
        ? "ATM load due"
        : "Night inquiry done"
      : "Ready for night inquiry";
  }
  if (els.cycleDetail) {
    if (state.due) {
      els.cycleDetail.textContent = `Night inquiry: opening ${formatINR(state.openOpening)} − closing ${formatINR(state.openLeft)} = dispensed ${formatINR(state.openDispensed)}. Load this amount into the ATM.`;
    } else if (state.hasOpen) {
      els.cycleDetail.textContent = "Night inquiry recorded with zero dispensed — nothing to load.";
    } else {
      els.cycleDetail.textContent = `Opening balance for next night inquiry: ${formatINR(state.openingBalance)}.`;
    }
  }

  if (inquiryForm) {
    const lockInquiry = state.due;
    inquiryForm.querySelectorAll("input, button").forEach((el) => {
      el.disabled = lockInquiry;
    });
    els.inquiryCard?.classList.toggle("is-locked", lockInquiry);
  }

  const adminCanForce =
    admin &&
    !state.hasOpen &&
    (state.capital <= 0 || state.cashInAtm + AMOUNT_EPS < state.capital);
  const canLoad = state.due || adminCanForce;

  if (els.adminLoadNote) els.adminLoadNote.hidden = !admin;
  if (els.adminAmountWrap) els.adminAmountWrap.hidden = !admin;
  if (els.lockedAmountBox) els.lockedAmountBox.hidden = admin;
  if (els.replenishHelp) {
    els.replenishHelp.textContent = admin
      ? state.due
        ? "Admin: amount defaults to dispensed; you may override."
        : "Admin: load only when cash in ATM is below capital (e.g. after an under-load), or wait for the next night inquiry."
      : "Load cash into the ATM. Amount is locked to the open night inquiry.";
  }

  if (admin && loadAmountInput && !loadAmountInput.dataset.touched) {
    loadAmountInput.value = state.due ? String(state.pending) : "";
  }

  if (replenishForm) {
    replenishForm.querySelectorAll("input, button").forEach((el) => {
      el.disabled = !canLoad;
    });
    if (admin && canLoad && loadAmountInput) loadAmountInput.disabled = false;
    els.replenishCard?.classList.toggle("is-locked", !canLoad);
    if (els.replenishSubmit) {
      if (!canLoad) {
        els.replenishSubmit.textContent = admin
          ? state.hasOpen
            ? "Awaiting inquiry"
            : "ATM at capital — inquiry first"
          : "Awaiting inquiry";
      } else if (admin) {
        els.replenishSubmit.textContent = "Save ATM load (admin)";
      } else {
        els.replenishSubmit.textContent = `Load ${formatINR(state.pending)} into ATM`;
      }
    }
  }

  updateDispensedPreview();
}

async function refreshCycle() {
  try {
    const data = await AtmCycle.fetchAtmSummary();
    applyCycleUi(data);
    return data;
  } catch (error) {
    console.warn(error);
    showToast(error.message, "error");
    return null;
  }
}

async function fetchHistory() {
  const [inqRes, loadsRes] = await Promise.all([
    supabaseClient
      .from("atm_inquiries")
      .select(
        "id, inquiry_date, opening_balance, cash_left, dispensed, receipt_path, reference, recorded_at, replenished_at, latitude, longitude, geo_accuracy_m"
      )
      .order("recorded_at", { ascending: false })
      .limit(30),
    supabaseClient
      .from("cash_loads")
      .select(
        "id, amount, reference, atm_receipt_path, inquiry_id, recorded_at, latitude, longitude, geo_accuracy_m"
      )
      .order("recorded_at", { ascending: false })
      .limit(30),
  ]);

  return {
    inquiries: inqRes.data || [],
    loads: loadsRes.data || [],
    error: inqRes.error || loadsRes.error,
  };
}

function adminDeleteCell(kind, id, canDelete) {
  if (!isAdmin(pageUser)) return "";
  if (!canDelete) return `<td data-label="Actions" class="table-actions"></td>`;
  return `<td data-label="Actions" class="table-actions">
    <button type="button" class="btn-delete" data-delete="${escapeHtml(kind)}" data-id="${escapeHtml(id)}">Delete</button>
  </td>`;
}

async function renderInquiryTable(rows) {
  if (!inquiryTable) return;
  if (!rows.length) {
    inquiryTable.innerHTML = `<p class="muted">No night inquiries yet.</p>`;
    return;
  }
  const admin = isAdmin(pageUser);
  // History is newest-first; only the tip may be deleted (matches RPC rules).
  const tipId = rows[0]?.id;
  const urlMap = await getReceiptSignedUrlMap(rows.map((r) => r.receipt_path));
  inquiryTable.innerHTML = `<table class="data-table"><thead><tr>
    <th>Date &amp; location</th><th>Opening</th><th>Closing</th><th>Dispensed</th><th>Status</th><th>Slip</th>${
      admin ? "<th>Actions</th>" : ""
    }
  </tr></thead><tbody>${rows
    .map(
      (r) => `<tr>
        <td data-label="Date & location">${AtmCycle.metaCellHtml(r)}</td>
        <td data-label="Opening">${formatINRDecimal(r.opening_balance)}</td>
        <td data-label="Closing">${formatINRDecimal(r.cash_left)}</td>
        <td data-label="Dispensed">${formatINRDecimal(r.dispensed)}</td>
        <td data-label="Status">${escapeHtml(AtmCycle.inquiryStatus(r))}</td>
        <td data-label="Slip">${receiptLinkFromMap(r.receipt_path, "slip", urlMap)}</td>
        ${adminDeleteCell("inquiry", r.id, r.id === tipId)}
      </tr>`
    )
    .join("")}</tbody></table>`;
}

async function renderReplenishTable(loads, tipInquiryId) {
  if (!replenishTable) return;
  if (!loads.length) {
    replenishTable.innerHTML = `<p class="muted">No ATM loads yet.</p>`;
    return;
  }
  const admin = isAdmin(pageUser);
  const urlMap = await getReceiptSignedUrlMap(loads.map((r) => r.atm_receipt_path));

  replenishTable.innerHTML = `<table class="data-table"><thead><tr>
    <th>Date &amp; location</th><th>Amount</th><th>Reference</th><th>Receipt</th>${
      admin ? "<th>Actions</th>" : ""
    }
  </tr></thead><tbody>${loads
    .map((r) => {
      const badge = AtmCycle.isAdminOverrideLoad(r)
        ? ` <span class="muted" style="font-size:0.75rem">(admin)</span>`
        : "";
      // Linked loads: tip inquiry only. Orphan admin loads may always be removed.
      const canDelete = !r.inquiry_id || r.inquiry_id === tipInquiryId;
      return `<tr>
        <td data-label="Date & location">${AtmCycle.metaCellHtml(r)}</td>
        <td data-label="Amount">${formatINRDecimal(r.amount)}${badge}</td>
        <td data-label="Reference">${escapeHtml(r.reference || "—")}</td>
        <td data-label="Receipt">${receiptLinkFromMap(r.atm_receipt_path, "receipt", urlMap)}</td>
        ${adminDeleteCell("load", r.id, canDelete)}
      </tr>`;
    })
    .join("")}</tbody></table>`;
}

async function refreshAll() {
  const [, history] = await Promise.all([refreshCycle(), fetchHistory()]);
  if (history.error) {
    showToast(history.error.message, "error");
    return;
  }
  const tipInquiryId = history.inquiries[0]?.id || null;
  await Promise.all([
    renderInquiryTable(history.inquiries),
    renderReplenishTable(history.loads, tipInquiryId),
  ]);
}

async function cleanupReceiptPaths(...paths) {
  await Promise.all(paths.filter(Boolean).map((path) => removeReceipt(path)));
}

async function handleAdminDelete(event) {
  const button = event.target.closest("[data-delete][data-id]");
  if (!button || !isAdmin(pageUser) || saving) return;

  const kind = button.dataset.delete;
  const id = button.dataset.id;
  const rpcs = AppConfig.ATM_RPCS;

  let confirmMsg;
  let rpcName;
  if (kind === "inquiry") {
    confirmMsg =
      "Delete this night inquiry?\n\nIf an ATM load is linked, it will be deleted too. This cannot be undone.";
    rpcName = rpcs.DELETE_INQUIRY;
  } else if (kind === "load") {
    confirmMsg =
      "Delete this ATM load?\n\nIf it closed a night inquiry, that inquiry will reopen so you can load again. This cannot be undone.";
    rpcName = rpcs.DELETE_LOAD;
  } else {
    return;
  }

  if (!window.confirm(confirmMsg)) return;

  saving = true;
  button.disabled = true;
  try {
    const { data, error } = await supabaseClient.rpc(rpcName, { p_id: id });
    if (error) throw error;

    // Storage cleanup is best-effort; DB delete already succeeded.
    await cleanupReceiptPaths(data?.receipt_path, data?.atm_receipt_path);
    showToast(kind === "inquiry" ? "Night inquiry deleted." : "ATM load deleted.", "success");
    if (loadAmountInput) delete loadAmountInput.dataset.touched;
    await refreshAll();
  } catch (err) {
    showToast(rpcErrorMessage(err), "error");
    button.disabled = false;
  } finally {
    saving = false;
  }
}

async function handleInquirySubmit(event) {
  event.preventDefault();
  if (saving) return;

  const button = inquiryForm.querySelector('button[type="submit"]');
  const cashLeft = parseAmount(inquiryForm.cash_left.value, { allowZero: true });
  const file = inquiryForm.inquiry_receipt.files?.[0];
  const rpcs = AppConfig.ATM_RPCS;
  const kinds = AppConfig.RECEIPT_KINDS;

  if (cashLeft == null) {
    showToast("Enter closing balance (0 or more).", "error");
    return;
  }
  if (cashLeft > Number(cycle.openingBalance) + AMOUNT_EPS) {
    showToast(
      `Closing balance cannot exceed opening balance ${formatINR(cycle.openingBalance)}.`,
      "error"
    );
    return;
  }
  if (!file) {
    showToast("Inquiry slip photo is required.", "error");
    return;
  }
  if (!(await requireFreshGeo())) return;

  saving = true;
  try {
    await submitWithReceiptRpc({
      button,
      receiptFile: file,
      receiptKind: kinds.INQUIRY,
      rpcName: rpcs.INQUIRY,
      buildPayload: (path) => ({
        p_cash_left: cashLeft,
        p_receipt_path: path,
        p_latitude: geoState.latitude,
        p_longitude: geoState.longitude,
        p_geo_accuracy_m: geoState.geo_accuracy_m,
        p_reference: inquiryForm.reference.value.trim() || null,
      }),
      onSuccess: async () => {
        inquiryForm.reset();
        clearReceiptPreview(
          document.getElementById("inquiry_receipt_preview"),
          inquiryForm.inquiry_receipt
        );
        if (loadAmountInput) delete loadAmountInput.dataset.touched;
        showToast("Night inquiry saved.", "success");
        await refreshAll();
      },
    });
  } catch (err) {
    showToast(rpcErrorMessage(err), "error");
  } finally {
    saving = false;
  }
}

async function handleReplenishSubmit(event) {
  event.preventDefault();
  if (saving) return;

  const button = replenishForm.querySelector('button[type="submit"]');
  const atmFile = replenishForm.atm_receipt.files?.[0];
  const admin = isAdmin(pageUser);
  const pending = Number(cycle.pendingReplenish) || 0;
  const hasOpen = Boolean(cycle.openInquiryId);
  const rpcs = AppConfig.ATM_RPCS;
  const kinds = AppConfig.RECEIPT_KINDS;

  let amount = pending;
  let force = false;

  if (!admin && !hasOpen) {
    showToast("Record a night inquiry before ATM load.", "error");
    return;
  }

  if (admin) {
    amount = parseAmount(loadAmountInput?.value);
    if (amount == null) {
      showToast("Enter a valid ATM load amount.", "error");
      return;
    }
    force = !hasOpen;
    if (!hasOpen) {
      if (cycle.capital > 0 && cycle.cashInAtm + AMOUNT_EPS >= cycle.capital) {
        showToast(
          "ATM is already at total capital. Record a night inquiry before loading, or fix capital/history first.",
          "error"
        );
        return;
      }
      const ok = window.confirm(
        `Load ${formatINR(amount)} without a night inquiry?\n\nAdmin override only — use after an under-load or to top up below capital.`
      );
      if (!ok) return;
    } else if (Math.abs(amount - pending) > AMOUNT_EPS) {
      const under = amount + AMOUNT_EPS < pending;
      const ok = window.confirm(
        under
          ? `Under-load warning\n\nInquiry dispensed: ${formatINR(pending)}\nYou are loading: ${formatINR(amount)}\n\nThis closes the night cycle with a shortfall. Continue?`
          : `Override locked amount?\n\nInquiry dispensed: ${formatINR(pending)}\nYou are loading: ${formatINR(amount)}`
      );
      if (!ok) return;
    }
  } else if (amount <= AMOUNT_EPS) {
    showToast("Nothing to load. Record a night inquiry with dispensed cash first.", "error");
    return;
  }

  const atmBase = hasOpen
    ? Number(cycle.openCashLeft ?? cycle.cashInAtm) || 0
    : Number(cycle.cashInAtm) || 0;
  if (cycle.capital > 0 && atmBase + amount > cycle.capital + AMOUNT_EPS) {
    showToast(
      `Load would put ATM at ${formatINR(atmBase + amount)}, above total capital ${formatINR(cycle.capital)}.`,
      "error"
    );
    return;
  }

  if (!atmFile) {
    showToast("ATM load receipt is required.", "error");
    return;
  }
  if (!(await requireFreshGeo())) return;

  saving = true;
  try {
    await submitWithReceiptRpc({
      button,
      receiptFile: atmFile,
      receiptKind: kinds.ATM,
      rpcName: rpcs.LOAD,
      buildPayload: (path) => {
        const payload = {
          p_atm_receipt_path: path,
          p_latitude: geoState.latitude,
          p_longitude: geoState.longitude,
          p_geo_accuracy_m: geoState.geo_accuracy_m,
          p_reference: replenishForm.reference.value.trim() || null,
          p_force: force,
        };
        if (admin) payload.p_amount = amount;
        return payload;
      },
      onSuccess: async () => {
        replenishForm.reset();
        clearReceiptPreview(
          document.getElementById("atm_receipt_preview"),
          replenishForm.atm_receipt
        );
        if (loadAmountInput) delete loadAmountInput.dataset.touched;
        showToast(`ATM load saved — ${formatINR(amount)}.`, "success");
        await refreshAll();
      },
    });
  } catch (err) {
    showToast(rpcErrorMessage(err), "error");
  } finally {
    saving = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  pageUser = await requireAuth();
  if (!pageUser) return;
  renderTopbar("Cash desk", "cash.html", pageUser);

  bindLiveClock(document.getElementById("inquiry-clock"));
  bindLiveClock(document.getElementById("replenish-clock"));
  bindReceiptPreview(
    inquiryForm?.inquiry_receipt,
    document.getElementById("inquiry_receipt_preview")
  );
  bindReceiptPreview(replenishForm?.atm_receipt, document.getElementById("atm_receipt_preview"));

  cashLeftInput?.addEventListener("input", updateDispensedPreview);
  loadAmountInput?.addEventListener("input", () => {
    loadAmountInput.dataset.touched = "1";
  });
  geoRefreshBtn?.addEventListener("click", () => refreshGeoStatus(geoStatus, geoState));
  inquiryForm?.addEventListener("submit", handleInquirySubmit);
  replenishForm?.addEventListener("submit", handleReplenishSubmit);
  inquiryTable?.addEventListener("click", handleAdminDelete);
  replenishTable?.addEventListener("click", handleAdminDelete);

  await Promise.all([refreshGeoStatus(geoStatus, geoState), refreshAll()]);
});
