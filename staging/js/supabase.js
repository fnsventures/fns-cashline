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
  console.warn("Supabase config invalid. Check js/env.js, DNS, or redeploy.");
}

if (typeof supabase === "undefined") {
  throw new Error("Supabase library failed to load.");
}

const supabaseClient = supabase.createClient(
  SUPABASE_URL || "https://invalid.local",
  SUPABASE_ANON_KEY || "invalid"
);

/**
 * @returns {Promise<"ok"|"unreachable"|"invalid"|"not-applied">}
 */
async function probeEnvJsStatus() {
  if (configValid) return "ok";
  const envUrl = new URL("js/env.js", window.location.href).href;
  try {
    const res = await fetch(envUrl, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return "unreachable";
    const text = await res.text();
    if (
      !/SUPABASE_URL\s*:\s*["'][^"']+["']/.test(text) ||
      text.includes("YOUR-PROJECT-ID")
    ) {
      return "invalid";
    }
    return "not-applied";
  } catch {
    return "unreachable";
  }
}

function configBannerHtml(status) {
  switch (status) {
    case "unreachable":
      return (
        "<span>Cannot reach <code>js/env.js</code> (network or DNS). Confirm this hostname still CNAMEs to " +
        "<code>fnsventures.github.io</code>, wait for DNS, then hard-refresh. " +
        "Ops: <code>./scripts/check-dns-siblings.sh --fix</code></span>"
      );
    case "not-applied":
      return (
        "<span>Configuration file is present but did not load in this tab. " +
        "Hard-refresh and try again.</span>"
      );
    default:
      return (
        "<span>Missing config: copy <code>js/env.example.js</code> to <code>js/env.js</code> " +
        "and add Supabase credentials — or redeploy prod so CI regenerates <code>env.js</code>.</span>"
      );
  }
}

function configErrorText(status) {
  switch (status) {
    case "unreachable":
      return (
        "Cannot reach server configuration (network or DNS). " +
        "Confirm this hostname still points at fnsventures.github.io, then hard-refresh."
      );
    case "not-applied":
      return "Configuration did not load in this tab. Hard-refresh and try again.";
    default:
      return "Missing config: copy js/env.example.js to js/env.js and add Supabase credentials.";
  }
}

async function getAppConfigErrorMessage() {
  if (configValid) return null;
  return configErrorText(await probeEnvJsStatus());
}

async function showConfigBanner() {
  if (!document.body || configValid) return;
  if (document.getElementById("app-config-banner")) return;

  const status = await probeEnvJsStatus();
  const banner = document.createElement("div");
  banner.id = "app-config-banner";
  banner.className = "app-config-banner";
  banner.setAttribute("role", "alert");
  banner.dataset.configStatus = status;
  banner.innerHTML = configBannerHtml(status);
  document.body.insertBefore(banner, document.body.firstChild);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void showConfigBanner();
  });
} else {
  void showConfigBanner();
}

window.supabaseClient = supabaseClient;
window.isAppConfigValid = isAppConfigValid;
window.getAppConfigErrorMessage = getAppConfigErrorMessage;
