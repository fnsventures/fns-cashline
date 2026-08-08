/**
 * Shared ATM inquiry → load cycle read model.
 * Used by cash.js, dashboard.js, reports.js.
 */
(function (global) {
  const AMOUNT_EPS = 0.009;

  function inquiryStatus(row) {
    if (!row?.replenished_at) return "Open";
    return Number(row.dispensed) <= AMOUNT_EPS ? "No ATM load" : "Loaded";
  }

  function isAdminOverrideLoad(row) {
    if (!row) return false;
    const ref = String(row.reference || "");
    return ref === "admin-override" || ref.startsWith("admin-override:");
  }

  function deriveCycleState(summary = {}) {
    const capital = Number(summary.total_capital) || 0;
    const cashInAtmRaw = summary.cash_in_atm;
    const cashInAtm =
      cashInAtmRaw != null && cashInAtmRaw !== "" ? Number(cashInAtmRaw) || 0 : 0;
    const pending = Number(summary.pending_replenish ?? summary.pending_to_load) || 0;
    const openId = summary.open_inquiry_id || null;
    const hasOpen = Boolean(openId);
    const due = hasOpen && pending > AMOUNT_EPS;
    const openOpening =
      summary.open_opening_balance != null ? Number(summary.open_opening_balance) : null;
    const openLeft = summary.open_cash_left != null ? Number(summary.open_cash_left) : null;
    const openDispensed =
      summary.open_dispensed != null ? Number(summary.open_dispensed) : null;
    // Prefer open inquiry opening; otherwise use cash_in_atm (incl. ₹0); fall back to capital only when unknown.
    const openingBalance = hasOpen
      ? openOpening ?? cashInAtm
      : cashInAtmRaw != null && cashInAtmRaw !== ""
        ? cashInAtm
        : capital;

    return {
      capital,
      cashInAtm,
      pending,
      openId,
      hasOpen,
      due,
      openOpening,
      openLeft,
      openDispensed,
      openingBalance,
      openInquiryDate: summary.open_inquiry_date || null,
      totalCommissionNet: Number(summary.total_commission_net) || 0,
      trading: capital - cashInAtm,
    };
  }

  async function fetchAtmSummary() {
    const { data, error } = await global.supabaseClient
      .from("v_atm_summary")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data || {};
  }

  function metaCellHtml(row) {
    const when = global.formatDateTime(row.recorded_at || row.created_at);
    const geo = global.formatGeo(row.latitude, row.longitude, row.geo_accuracy_m);
    const link = global.mapsLink(row.latitude, row.longitude);
    const geoHtml = link
      ? `<a href="${link}" target="_blank" rel="noopener">${global.escapeHtml(geo)}</a>`
      : global.escapeHtml(geo);
    return `${global.escapeHtml(when)}<br><span class="muted" style="font-size:0.8rem">${geoHtml}</span>`;
  }

  function metaLineText(row) {
    const when =
      typeof global.formatDateTime === "function"
        ? global.formatDateTime(row.recorded_at || row.created_at)
        : global.formatDisplayDate(row.load_date || row.inquiry_date);
    const geo =
      typeof global.formatGeo === "function"
        ? global.formatGeo(row.latitude, row.longitude, row.geo_accuracy_m)
        : "";
    return `${when}${geo && geo !== "Location not captured" ? ` · ${geo}` : ""}`;
  }

  global.AtmCycle = {
    AMOUNT_EPS,
    inquiryStatus,
    isAdminOverrideLoad,
    deriveCycleState,
    fetchAtmSummary,
    metaCellHtml,
    metaLineText,
  };
})(typeof window !== "undefined" ? window : globalThis);
