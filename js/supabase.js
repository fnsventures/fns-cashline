/* global supabase */

const runtimeConfig = window.__APP_CONFIG__ || {};
const SUPABASE_URL = runtimeConfig.SUPABASE_URL;
const SUPABASE_ANON_KEY = runtimeConfig.SUPABASE_ANON_KEY;

function isAppConfigValid() {
  return Boolean(
    SUPABASE_URL &&
      SUPABASE_ANON_KEY &&
      !String(SUPABASE_URL).includes("YOUR-PROJECT-ID")
  );
}

const configValid = isAppConfigValid();

if (!configValid) {
  console.warn("Supabase config invalid. Copy js/env.example.js to js/env.js.");
}

if (typeof supabase === "undefined") {
  throw new Error("Supabase library failed to load.");
}

const supabaseClient = supabase.createClient(
  SUPABASE_URL || "https://invalid.local",
  SUPABASE_ANON_KEY || "invalid"
);

function showConfigBanner() {
  if (!document.body || configValid) return;
  if (document.getElementById("app-config-banner")) return;

  const banner = document.createElement("div");
  banner.id = "app-config-banner";
  banner.className = "app-config-banner";
  banner.setAttribute("role", "alert");
  banner.innerHTML =
    "<span>Missing config: copy <code>js/env.example.js</code> to <code>js/env.js</code> and add Supabase credentials.</span>";
  document.body.insertBefore(banner, document.body.firstChild);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", showConfigBanner);
} else {
  showConfigBanner();
}

window.supabaseClient = supabaseClient;
window.isAppConfigValid = isAppConfigValid;
