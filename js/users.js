/* global supabaseClient, requireAdmin, renderTopbar, formatINR, showToast, AppConfig, captureGeo */

const capitalForm = document.getElementById("capital-form");
const userForm = document.getElementById("user-form");
const usersTable = document.getElementById("users-table");
const useMyLocationBtn = document.getElementById("use-my-location-btn");

let settingsRow = null;

function readGeoFromForm() {
  const latRaw = capitalForm.geo_lat.value.trim();
  const lngRaw = capitalForm.geo_lng.value.trim();
  const radius = Number(capitalForm.geo_radius.value);
  return {
    latitude: latRaw === "" ? null : Number(latRaw),
    longitude: lngRaw === "" ? null : Number(lngRaw),
    radiusM: Number.isFinite(radius) && radius >= 50 ? radius : 3000,
    requireLocation: Boolean(capitalForm.geo_require.checked),
  };
}

async function loadSettings() {
  const { data, error } = await supabaseClient.from("atm_settings").select("*").eq("id", 1).maybeSingle();
  if (error) {
    showToast(error.message, "error");
    return;
  }
  settingsRow = data;
  const station = data?.config?.station || {};
  const geo = station.geo || AppConfig.DEFAULT_STATION.geo || {};

  const capital =
    Number(station.totalCapital) || Number(AppConfig?.DEFAULT_STATION?.totalCapital) || 0;
  if (capitalForm?.total_capital) capitalForm.total_capital.value = capital;
  if (capitalForm?.geo_lat) capitalForm.geo_lat.value = geo.latitude ?? "";
  if (capitalForm?.geo_lng) capitalForm.geo_lng.value = geo.longitude ?? "";
  if (capitalForm?.geo_radius) capitalForm.geo_radius.value = geo.radiusM ?? 3000;
  if (capitalForm?.geo_require) {
    capitalForm.geo_require.checked = geo.requireLocation !== false;
  }
}

async function loadUsers() {
  const { data, error } = await supabaseClient
    .from("users")
    .select("id, email, role, display_name, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    showToast(error.message, "error");
    return;
  }

  const rows = data || [];
  usersTable.innerHTML = rows.length
    ? `<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${rows
        .map((r) => {
          const chip =
            r.role === "admin"
              ? `<span class="user-chip user-chip--admin">admin</span>`
              : `<span class="user-chip">operator</span>`;
          return `<tr>
            <td data-label="Name">${escapeHtml(r.display_name || "—")}</td>
            <td data-label="Email">${escapeHtml(r.email)}</td>
            <td data-label="Role">${chip}</td>
          </tr>`;
        })
        .join("")}</tbody></table>`
    : `<p class="muted">No users yet.</p>`;
}

async function handleCapitalSubmit(event) {
  event.preventDefault();
  const button = capitalForm.querySelector('button[type="submit"]');
  const totalCapital = Number(capitalForm.total_capital.value);
  if (!Number.isFinite(totalCapital) || totalCapital < 0) {
    showToast("Enter a valid capital amount.", "error");
    return;
  }

  const geo = readGeoFromForm();
  if (
    (geo.latitude == null) !== (geo.longitude == null) ||
    (geo.latitude != null && (!Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude)))
  ) {
    showToast("Set both latitude and longitude, or leave both empty.", "error");
    return;
  }

  const baseConfig = settingsRow?.config || { station: { ...AppConfig.DEFAULT_STATION } };
  const nextConfig = {
    ...baseConfig,
    station: {
      ...(baseConfig.station || AppConfig.DEFAULT_STATION),
      displayName: "FiNDi",
      franchisePartner: "FiNDi",
      location:
        baseConfig.station?.location ||
        AppConfig.DEFAULT_STATION.location,
      totalCapital,
      geo,
    },
  };

  setButtonLoading(button, true, "Saving…");
  const { data, error } = await supabaseClient
    .from("atm_settings")
    .upsert({ id: 1, config: nextConfig, updated_at: new Date().toISOString() })
    .select()
    .maybeSingle();
  setButtonLoading(button, false);

  if (error) {
    showToast(error.message, "error");
    return;
  }

  settingsRow = data;
  showToast(`Settings saved. Capital ${formatINR(totalCapital)}.`, "success");
}

async function handleUserSubmit(event) {
  event.preventDefault();
  const button = userForm.querySelector('button[type="submit"]');
  const email = userForm.email.value.trim();
  const role = userForm.role.value;
  const displayName = userForm.display_name.value.trim() || null;

  setButtonLoading(button, true, "Adding…");
  const { error } = await supabaseClient.rpc("provision_user", {
    p_email: email,
    p_role: role,
    p_display_name: displayName,
  });
  setButtonLoading(button, false);

  if (error) {
    showToast(error.message, "error");
    return;
  }

  userForm.reset();
  userForm.role.value = "operator";
  showToast("User provisioned.", "success");
  await loadUsers();
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return;
  renderTopbar("Users", "users.html", user);

  capitalForm?.addEventListener("submit", handleCapitalSubmit);
  userForm?.addEventListener("submit", handleUserSubmit);
  useMyLocationBtn?.addEventListener("click", async () => {
    useMyLocationBtn.disabled = true;
    const geo = await captureGeo();
    useMyLocationBtn.disabled = false;
    if (geo.latitude == null) {
      showToast(geo.error || "Could not get location.", "error");
      return;
    }
    capitalForm.geo_lat.value = Number(geo.latitude).toFixed(6);
    capitalForm.geo_lng.value = Number(geo.longitude).toFixed(6);
    showToast("Station coordinates filled from your GPS. Save settings to apply.", "success");
  });

  await Promise.all([loadSettings(), loadUsers()]);
});
