/**
 * Shared receipt-upload + RPC submit pattern for cash ops forms.
 */
(function (global) {
  async function submitWithReceiptRpc({
    button,
    receiptFile,
    receiptKind,
    rpcName,
    buildPayload,
    onSuccess,
    uploadLabel = "Uploading…",
    saveLabel = "Saving…",
  }) {
    global.setButtonLoading(button, true, uploadLabel);
    let uploadedPath = null;

    try {
      uploadedPath = await global.uploadReceipt(receiptFile, receiptKind);
      global.setButtonLoading(button, true, saveLabel);

      const payload = buildPayload(uploadedPath);
      const { error } = await global.supabaseClient.rpc(rpcName, payload);
      if (error) throw error;

      if (typeof onSuccess === "function") await onSuccess(uploadedPath);
      return { ok: true, path: uploadedPath };
    } catch (err) {
      if (uploadedPath) await global.removeReceipt(uploadedPath);
      throw err;
    } finally {
      global.setButtonLoading(button, false);
    }
  }

  global.submitWithReceiptRpc = submitWithReceiptRpc;
})(typeof window !== "undefined" ? window : globalThis);
