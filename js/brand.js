/**
 * Shared FiNDi wordmark HTML (red square dots on i).
 */
function findiLogoHtml(extraClass = "") {
  const cls = extraClass ? `findi-logo ${extraClass}` : "findi-logo";
  // Dotless ı so the red square marks replace the letter dots
  return `<span class="${cls}" aria-label="FiNDi">F<span class="i-dot">ı</span>ND<span class="i-dot">ı</span></span>`;
}

window.findiLogoHtml = findiLogoHtml;
