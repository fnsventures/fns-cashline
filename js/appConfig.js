/**
 * FINDI Cashline — app constants.
 */
(function (global) {
  const DEFAULT_STATION = {
    displayName: "FiNDi",
    location: "Bishnupriya Fuels Petrol Pump, Padmanavpur",
    franchisePartner: "FiNDi",
    machineId: "",
    totalCapital: 200000,
    commissionPerTxn: 0,
    minFloat: 0,
    supportEmail: "official@fnsventures.in",
    supportWhatsapp: "+91 96689 13299",
    geo: {
      latitude: null,
      longitude: null,
      radiusM: 3000,
      requireLocation: true,
    },
  };

  const CASH_MODES = [
    { key: "bank_cc", label: "Bank CC draw" },
    { key: "bank_transfer", label: "Bank transfer" },
    { key: "cash", label: "Cash" },
    { key: "other", label: "Other" },
  ];

  const NAV_ITEMS = [
    { href: "dashboard.html", label: "Home", icon: "◉", roles: ["admin", "operator"] },
    { href: "cash.html", label: "Cash", icon: "₹", roles: ["admin", "operator"] },
    { href: "commissions.html", label: "Commission", icon: "%", roles: ["admin"] },
    { href: "users.html", label: "Users", icon: "◎", roles: ["admin"] },
    { href: "reports.html", label: "Reports", icon: "▤", roles: ["admin", "operator"] },
  ];

  global.AppConfig = {
    DEFAULT_STATION,
    CASH_MODES,
    NAV_ITEMS,
    APP_NAME: "FiNDi",
    PRODUCT_NAME: "FNS Cashline",
    VENTURE_NAME: "F & S Ventures",
    SITE_LINE: "at Bishnupriya Fuels · Padmanavpur",
    STATION_NAME: "Bishnupriya Fuels",
    TAGLINE: "ATM float desk",
  };
})(typeof window !== "undefined" ? window : globalThis);
