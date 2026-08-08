/* global showToast */

/**
 * Capture device geolocation (optional but attempted automatically).
 * Returns { latitude, longitude, geo_accuracy_m } or nulls if denied/unavailable.
 */
function captureGeo(timeoutMs = 12000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({
        latitude: null,
        longitude: null,
        geo_accuracy_m: null,
        error: "Geolocation not supported on this device.",
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          geo_accuracy_m: pos.coords.accuracy,
          error: null,
        });
      },
      (err) => {
        resolve({
          latitude: null,
          longitude: null,
          geo_accuracy_m: null,
          error: err?.message || "Location permission denied.",
        });
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 30_000,
      }
    );
  });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatGeo(lat, lng, accuracy) {
  if (lat == null || lng == null) return "Location not captured";
  const acc = accuracy != null ? ` (±${Math.round(accuracy)}m)` : "";
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}${acc}`;
}

function mapsLink(lat, lng) {
  if (lat == null || lng == null) return null;
  return `https://maps.google.com/?q=${lat},${lng}`;
}

function bindLiveClock(el) {
  if (!el) return () => {};
  const tick = () => {
    el.textContent = new Date().toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}

async function refreshGeoStatus(statusEl, geoState) {
  if (statusEl) statusEl.textContent = "Capturing location…";
  const geo = await captureGeo();
  Object.assign(geoState, geo);
  if (statusEl) {
    if (geo.latitude != null) {
      statusEl.textContent = `Location OK · ${formatGeo(geo.latitude, geo.longitude, geo.geo_accuracy_m)}`;
      statusEl.classList.remove("geo-bad");
      statusEl.classList.add("geo-ok");
    } else {
      statusEl.textContent = `Location missing · ${geo.error || "Allow location and retry"}`;
      statusEl.classList.remove("geo-ok");
      statusEl.classList.add("geo-bad");
    }
  }
  return geo;
}

window.captureGeo = captureGeo;
window.formatDateTime = formatDateTime;
window.formatGeo = formatGeo;
window.mapsLink = mapsLink;
window.bindLiveClock = bindLiveClock;
window.refreshGeoStatus = refreshGeoStatus;
