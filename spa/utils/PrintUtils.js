import { sanitizeToFragment } from './SecurityUtils.js';

/**
 * Paper styles for a report printed from its own window.
 *
 * A print window has none of the app's stylesheet, so everything a report
 * relies on is here: 10pt text and tight cells keep a roster to few pages,
 * header rows repeat on each page, and no row or card is cut between two
 * pages. Cards flow in two columns, which halves the paper a card report
 * takes. Black on white, with labels rather than colour, survives a
 * greyscale printer.
 */
export const REPORT_PRINT_STYLES = `
  @page { margin: 12mm; }
  html, body { background: #fff; color: #000; }
  body { margin: 0; font: 10pt/1.3 Arial, Helvetica, sans-serif; }
  h1 { font-size: 14pt; margin: 0 0 4pt; }
  h2 { font-size: 13pt; margin: 0 0 4pt; }
  h3 { font-size: 10.5pt; margin: 0; }
  h4 { font-size: 10pt; margin: 4pt 0 2pt; }
  p { margin: 0 0 6pt; }
  button, select, input, .no-print { display: none !important; }
  .visually-hidden {
    position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden;
    clip: rect(0 0 0 0); white-space: nowrap;
  }
  .print-date { float: right; margin: 0 0 4pt 8pt; font-size: 8.5pt; color: #333; }
  .report-meta { font-size: 9pt; color: #333; }
  table { border-collapse: collapse; inline-size: 100%; margin: 0 0 8pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { border: 0.5pt solid #777; padding: 2pt 4pt; text-align: start; vertical-align: top; }
  thead th { background: #e8e8e8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .text-right { text-align: end; }
  .health-records { column-count: 2; column-gap: 6mm; }
  .health-record {
    break-inside: avoid; page-break-inside: avoid; display: block;
    box-sizing: border-box; margin: 0 0 4pt; padding: 3pt 5pt; border: 0.5pt solid #777;
  }
  .health-record__header {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 2pt 6pt;
    padding-block-end: 2pt; margin-block-end: 2pt; border-bottom: 0.5pt solid #bbb;
  }
  .health-record__group { font-size: 9pt; }
  .health-record__fields { margin: 0; }
  .health-record__field { display: grid; grid-template-columns: 35% 1fr; gap: 4pt; margin: 0 0 1pt; }
  .health-record__field dt { font-weight: bold; }
  .health-record__field dd { margin: 0; overflow-wrap: anywhere; }
  .health-record__contacts ul { margin: 0; padding-inline-start: 12pt; }
  .health-record__no-contacts { margin: 2pt 0 0; font-size: 9pt; }
  .badge-epipen {
    border: 1pt solid #000; padding: 0 3pt; font-size: 8.5pt; font-weight: bold;
    text-transform: uppercase;
  }
`;

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
  if (!printWindow) {return false;}
  const printDocument = printWindow.document;
  printDocument.title = String(title);
  printDocument.body.replaceChildren(
    sanitizeToFragment(html, printDocument, { allowStyleTags: true }),
  );
  return true;
}
