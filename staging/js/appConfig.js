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

  /** Persisted on cash_loads.mode (UI does not expose a selector). */
  const ATM_LOAD_MODE = "bank_cc";

  const ATM_RPCS = {
    INQUIRY: "record_atm_inquiry",
    LOAD: "record_replenish",
    DELETE_INQUIRY: "admin_delete_atm_inquiry",
    DELETE_LOAD: "admin_delete_cash_load",
  };

  const RECEIPT_KINDS = {
    INQUIRY: "inquiry",
    ATM: "atm",
  };

  const NAV_ITEMS = [
    { href: "dashboard.html", label: "Dashboard", icon: "◉", roles: ["admin", "operator"] },
    { href: "cash.html", label: "Cash desk", icon: "₹", roles: ["admin", "operator"] },
    { href: "commissions.html", label: "Commissions", icon: "%", roles: ["admin"] },
    { href: "users.html", label: "Settings", icon: "◎", roles: ["admin"] },
    { href: "reports.html", label: "Reports", icon: "▤", roles: ["admin", "operator"] },
  ];

  global.AppConfig = {
    DEFAULT_STATION,
    ATM_LOAD_MODE,
    ATM_RPCS,
    RECEIPT_KINDS,
    NAV_ITEMS,
    APP_NAME: "FiNDi",
    PRODUCT_NAME: "FNS Cashline",
    VENTURE_NAME: "F & S Ventures",
    SITE_LINE: "Bishnupriya Fuels · Padmanavpur",
    STATION_NAME: "Bishnupriya Fuels",
    TAGLINE: "ATM cash operations",
  };
})(typeof window !== "undefined" ? window : globalThis);
