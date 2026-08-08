/* global supabaseClient, AppConfig, findiLogoHtml */

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginButton = document.getElementById("login-button");

let currentAppUser = null;

async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await supabaseClient
    .from("users")
    .select("id, email, role, display_name")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load user profile", error);
    return null;
  }
  currentAppUser = data;
  return data;
}

function isAdmin(user = currentAppUser) {
  return user?.role === "admin";
}

async function requireAuth(redirectTo = "login.html") {
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(window.location.pathname.split("/").pop() || "dashboard.html");
    window.location.href = `${redirectTo}?next=${next}`;
    return null;
  }

  const user = await getCurrentUser();
  if (!user) {
    await supabaseClient.auth.signOut();
    window.location.href = `${redirectTo}?error=unprovisioned`;
    return null;
  }
  return user;
}

async function requireAdmin(redirectTo = "dashboard.html") {
  const user = await requireAuth();
  if (!user) return null;
  if (!isAdmin(user)) {
    window.location.href = redirectTo;
    return null;
  }
  return user;
}

function navItemsFor(user) {
  const role = user?.role || "operator";
  return (AppConfig?.NAV_ITEMS || []).filter((item) => (item.roles || []).includes(role));
}

function renderNavLinks(items, activeHref, className = "nav-link") {
  return items
    .map((item) => {
      const active = item.href === activeHref ? " is-active" : "";
      return `<a href="${item.href}" class="${className}${active}"><span class="nav-icon" aria-hidden="true">${item.icon}</span><span class="nav-label">${escapeHtml(item.label)}</span></a>`;
    })
    .join("");
}

function renderNav(activeHref, user = currentAppUser) {
  const nav = document.getElementById("app-nav");
  if (!nav) return;
  nav.innerHTML = renderNavLinks(navItemsFor(user), activeHref);
}

function renderBottomNav(activeHref, user = currentAppUser) {
  let bottom = document.getElementById("app-bottom-nav");
  if (!bottom) {
    bottom = document.createElement("nav");
    bottom.id = "app-bottom-nav";
    bottom.className = "bottom-nav no-print";
    bottom.setAttribute("aria-label", "Primary mobile");
    document.body.appendChild(bottom);
  }
  bottom.innerHTML = renderNavLinks(navItemsFor(user), activeHref);
}

function renderTopbar(pageTitle, activeHref, user = currentAppUser) {
  const topbar = document.getElementById("app-topbar");
  if (!topbar) return;

  const logo = typeof findiLogoHtml === "function" ? findiLogoHtml() : "FiNDi";
  topbar.innerHTML = `
    <div class="topbar-inner">
      <a class="brand" href="dashboard.html">
        <span class="brand-mark" aria-hidden="true">${logo}</span>
        <span class="brand-text">
          <span class="brand-title">FiNDi ATM</span>
          <span class="brand-sub"><span class="station">Bishnupriya Fuels</span> · Padmanavpur</span>
        </span>
      </a>
      <p class="page-title">${escapeHtml(pageTitle)}</p>
      <nav class="nav-wrap" id="app-nav" aria-label="Primary"></nav>
      <button type="button" class="btn btn--ghost btn--sm" id="logout-btn">Sign out</button>
    </div>
  `;

  renderNav(activeHref, user);
  renderBottomNav(activeHref, user);

  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
  });
}

function safeNextPath(raw) {
  if (!raw) return "dashboard.html";
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return "dashboard.html";
  }
  if (!/^[a-z0-9][a-z0-9._-]*\.html$/i.test(value)) return "dashboard.html";
  return value;
}

async function initLoginPage() {
  if (!loginForm) return;

  const params = new URLSearchParams(window.location.search);
  const nextPath = safeNextPath(params.get("next"));

  if (params.get("error") === "unprovisioned" && loginError) {
    loginError.textContent = "Your account is not provisioned. Contact the administrator.";
    loginError.hidden = false;
  }

  const session = await getSession();
  if (session) {
    const user = await getCurrentUser();
    if (user) {
      window.location.href = nextPath;
      return;
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loginError) loginError.hidden = true;

    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;

    setButtonLoading(loginButton, true, "Signing in…");

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    setButtonLoading(loginButton, false);

    if (error) {
      if (loginError) {
        loginError.textContent = error.message;
        loginError.hidden = false;
      }
      return;
    }

    window.location.href = nextPath;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (loginForm) initLoginPage();
});

window.requireAuth = requireAuth;
window.requireAdmin = requireAdmin;
window.renderTopbar = renderTopbar;
window.getCurrentUser = getCurrentUser;
window.isAdmin = isAdmin;
