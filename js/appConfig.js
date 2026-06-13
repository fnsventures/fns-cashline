/**
 * ATM franchise application constants.
 */
(function (global) {
  const DEFAULT_STATION = {
    displayName: "FNS Cashline",
    location: "Bishnupriya Fuels · Padmanavpur",
    franchisePartner: "",
    machineId: "",
    commissionPerTxn: 0,
    minFloat: 0,
    supportEmail: "official@fnsventures.in",
    supportWhatsapp: "+91 96689 13299",
  };

  const CASH_MODES = [
    { key: "bank_transfer", label: "Bank transfer" },
    { key: "cash", label: "Cash" },
    { key: "other", label: "Other" },
  ];

  const NAV_ITEMS = [
    { href: "dashboard.html", label: "Dashboard", icon: "◉" },
    { href: "cash-loads.html", label: "Cash", icon: "₹" },
    { href: "commissions.html", label: "Commission", icon: "%" },
    { href: "reports.html", label: "Reports", icon: "▤" },
  ];

  global.AppConfig = {
    DEFAULT_STATION,
    CASH_MODES,
    NAV_ITEMS,
    APP_NAME: "FNS Cashline",
    VENTURE_NAME: "F & S Ventures",
    TAGLINE: "Cash franchise desk",
  };
})(typeof window !== "undefined" ? window : globalThis);
