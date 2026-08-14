/* global supabaseClient */

const RECEIPT_BUCKET = "receipts";
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function validateReceiptFile(file) {
  if (!file) return "Photo is required.";
  if (!ALLOWED_TYPES.has(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || "")) {
    return "Use a photo (JPG, PNG, WEBP, or HEIC).";
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return "Photo must be under 5 MB.";
  }
  return null;
}

function bindReceiptPreview(input, previewEl) {
  if (!input || !previewEl) return;
  input.addEventListener("change", () => {
    if (previewEl.dataset.objectUrl) {
      URL.revokeObjectURL(previewEl.dataset.objectUrl);
      delete previewEl.dataset.objectUrl;
    }

    const file = input.files?.[0];
    if (!file) {
      previewEl.hidden = true;
      previewEl.removeAttribute("src");
      return;
    }
    const err = validateReceiptFile(file);
    if (err) {
      showToast(err, "error");
      input.value = "";
      previewEl.hidden = true;
      return;
    }
    const url = URL.createObjectURL(file);
    previewEl.dataset.objectUrl = url;
    previewEl.src = url;
    previewEl.hidden = false;
  });
}

function clearReceiptPreview(previewEl, input) {
  if (previewEl?.dataset.objectUrl) {
    URL.revokeObjectURL(previewEl.dataset.objectUrl);
    delete previewEl.dataset.objectUrl;
  }
  if (previewEl) {
    previewEl.hidden = true;
    previewEl.removeAttribute("src");
  }
  if (input) input.value = "";
}

async function uploadReceipt(file, kind) {
  const err = validateReceiptFile(file);
  if (err) throw new Error(err);

  const {
    data: { user },
    error: userError,
  } = await supabaseClient.auth.getUser();
  if (userError || !user) throw new Error("Sign in again to upload photos.");

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${user.id}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabaseClient.storage.from(RECEIPT_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/jpeg",
  });

  if (error) throw error;
  return path;
}

async function removeReceipt(path) {
  if (!path || path.startsWith("migrated/")) return;
  try {
    const { error } = await supabaseClient.storage.from(RECEIPT_BUCKET).remove([path]);
    if (error) console.warn("Could not remove orphan receipt", error);
  } catch (err) {
    console.warn("Could not remove orphan receipt", err);
  }
}

async function getReceiptSignedUrlMap(paths) {
  const unique = [...new Set((paths || []).filter((p) => p && !String(p).startsWith("migrated/")))];
  const map = new Map();
  if (!unique.length) return map;

  const { data, error } = await supabaseClient.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrls(unique, 60 * 60);

  if (error) {
    console.warn("Signed URLs failed", error);
    return map;
  }

  for (const row of data || []) {
    if (row?.path && row?.signedUrl) map.set(row.path, row.signedUrl);
  }
  return map;
}

function receiptLinkFromMap(path, label, urlMap) {
  if (!path) return `<span class="muted">No photo</span>`;
  const url = urlMap?.get(path);
  if (!url) return `<span class="muted">Photo unavailable</span>`;
  return `<a class="receipt-link" href="${url}" target="_blank" rel="noopener">View ${escapeHtml(label)}</a>`;
}

async function receiptLinkHtml(path, label) {
  const map = await getReceiptSignedUrlMap([path]);
  return receiptLinkFromMap(path, label, map);
}

window.validateReceiptFile = validateReceiptFile;
window.bindReceiptPreview = bindReceiptPreview;
window.clearReceiptPreview = clearReceiptPreview;
window.uploadReceipt = uploadReceipt;
window.removeReceipt = removeReceipt;
window.getReceiptSignedUrlMap = getReceiptSignedUrlMap;
window.receiptLinkFromMap = receiptLinkFromMap;
window.receiptLinkHtml = receiptLinkHtml;
