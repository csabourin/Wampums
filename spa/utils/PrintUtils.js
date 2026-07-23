import { sanitizeToFragment } from './SecurityUtils.js';

/**
 * Open an isolated same-origin print window.
 * @returns {Window|null} Popup window, or null when blocked
 */
export function openPrintWindow() {
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.opener = null;
  }
  return printWindow;
}

/**
 * Replace a print window's body with sanitized markup.
 *
 * @param {Window|null} printWindow - Window returned by openPrintWindow()
 * @param {string} html - Print markup
 * @param {string} title - Plain-text document title
 * @returns {boolean} Whether content was written
 */
export function setPrintContent(printWindow, html, title = '') {
  if (!printWindow) return false;
  const printDocument = printWindow.document;
  printDocument.title = String(title);
  printDocument.body.replaceChildren(
    sanitizeToFragment(html, printDocument, { allowStyleTags: true }),
  );
  return true;
}
