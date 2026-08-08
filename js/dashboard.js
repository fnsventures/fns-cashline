/* global requireAuth, renderTopbar, isAdmin, formatINR, showToast, AtmCycle */

/**
 * Float desk: pending ATM load as the hero number.
 */

const els = {
  hero: document.getElementById("dash-hero"),
  pending: document.getElementById("kpi-pending"),
  capital: document.getElementById("kpi-capital"),
  inAtm: document.getElementById("kpi-in-atm"),
  trading: document.getElementById("kpi-trading"),
  actionDetail: document.getElementById("action-detail"),
  actionAmount: document.getElementById("action-amount"),
  actionCta: document.getElementById("action-cta"),
  adminLine: document.getElementById("admin-line"),
  commission: document.getElementById("kpi-commission"),
};

function renderDashboard(summary) {
  const state = AtmCycle.deriveCycleState(summary);

  if (els.pending) els.pending.textContent = formatINR(state.pending);
  if (els.capital) els.capital.textContent = formatINR(state.capital);
  if (els.inAtm) els.inAtm.textContent = formatINR(state.cashInAtm);
  if (els.trading) els.trading.textContent = formatINR(state.trading);
  if (els.actionAmount) els.actionAmount.textContent = formatINR(state.pending);

  if (els.hero) {
    els.hero.classList.toggle("is-due", state.due);
    els.hero.classList.toggle("is-clear", !state.due);
  }

  if (state.due) {
    const date = state.openInquiryDate ? ` · night inquiry ${state.openInquiryDate}` : "";
    if (els.actionDetail) {
      els.actionDetail.textContent = `Must match last night’s dispensed amount${date}`;
    }
    if (els.actionCta) els.actionCta.textContent = "Record ATM load";
  } else if (state.hasOpen) {
    if (els.actionDetail) els.actionDetail.textContent = "Night inquiry recorded — nothing pending to load";
    if (els.actionCta) els.actionCta.textContent = "Open cash desk";
  } else {
    if (els.actionDetail) els.actionDetail.textContent = "No open night inquiry — record tonight’s closing balance";
    if (els.actionCta) els.actionCta.textContent = "Record night inquiry";
  }
}

async function loadDashboard(user) {
  let data = {};
  try {
    data = await AtmCycle.fetchAtmSummary();
  } catch (error) {
    showToast(error.message, "error");
  }
  renderDashboard(data);

  if (isAdmin(user) && els.adminLine) {
    els.adminLine.hidden = false;
    if (els.commission) els.commission.textContent = formatINR(data?.total_commission_net);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAuth();
  if (!user) return;
  renderTopbar("Dashboard", "dashboard.html", user);
  await loadDashboard(user);
});
