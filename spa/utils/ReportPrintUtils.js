/**
 * ReportPrintUtils.js
 * Prepares a report shown in the reports dialog for paper.
 *
 * The aim is the fewest sheets that stay easy to read: small but not tiny type,
 * tight rows, columns nobody filled left out, the header repeated on every
 * page, no row split across two pages, and the page turned sideways when the
 * table is wide. The print window is a blank document, so nothing here
 * depends on the app's stylesheet.
 */

import { escapeHTML } from './SecurityUtils.js';

/** A cell with nothing to read: blank, or only a dash standing for "no answer". */
const EMPTY_CELL = /^[\s—–-]*$/;

/** From this many columns the table is printed on a sideways page. */
const LANDSCAPE_MIN_COLUMNS = 6;

/** From this many columns the type is made smaller still (attendance dates…). */
const DENSE_MIN_COLUMNS = 12;

/**
 * Print stylesheet of a report.
 * Lengths are in points and millimetres, which is what paper is measured in.
 */
const REPORT_PRINT_CSS = `
  @page { margin: 10mm; }
  @page { @bottom-right { content: counter(page) " / " counter(pages); font: 8pt Arial, sans-serif; color: #444; } }

  * { box-sizing: border-box; }
  html { font-size: 9.5pt; }
  body {
    margin: 0;
    background: #fff;
    color: #000;
    font: 9.5pt/1.3 Arial, Helvetica, sans-serif;
  }

  .report-sheet__header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8mm;
    margin: 0 0 3mm;
    padding-bottom: 1.5mm;
    border-bottom: 1pt solid #000;
    font-size: 8.5pt;
  }
  .report-sheet__title { margin: 0; font-size: 12pt; }

  h1, h2, h3, h4 { margin: 3mm 0 1.5mm; line-height: 1.2; break-after: avoid; }
  h2 { font-size: 12pt; }
  h3 { font-size: 10.5pt; }
  h4 { font-size: 9.5pt; }
  .report-sheet > h2:first-child { display: none; }
  p { margin: 0 0 1.5mm; }
  .report-meta { font-size: 8.5pt; }

  .table-scroll { overflow: visible; }
  table {
    width: 100%;
    margin: 0 0 3mm;
    border-collapse: collapse;
    font-size: 9pt;
  }
  caption.visually-hidden { display: none; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td {
    padding: 1mm 1.8mm;
    border-bottom: 0.5pt solid #888;
    text-align: left;
    vertical-align: top;
    overflow-wrap: break-word;
  }
  thead th { border-bottom: 1pt solid #000; font-weight: 700; }
  tbody th { font-weight: 700; }

  .badge-epipen {
    display: inline-block;
    padding: 0 1.5mm;
    border: 1.2pt solid #000;
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .health-records { column-count: 2; column-gap: 8mm; }
  .health-record {
    margin: 0 0 3mm;
    padding: 1.5mm 2.5mm;
    border: 0.5pt solid #555;
    break-inside: avoid;
  }
  .health-record__header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2mm; }
  .health-record__header h3 { margin: 0; }
  .health-record__fields { margin: 1mm 0 0; }
  .health-record__field { display: flex; gap: 2mm; }
  .health-record__field dt { flex: 0 0 34%; font-weight: 700; }
  .health-record__field dd { margin: 0; flex: 1; overflow-wrap: break-word; }
  .health-record__contacts ul { margin: 0; padding-left: 4mm; }
  .health-record__contacts span { margin-left: 1.5mm; }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
`;

/** Sideways page, for wide tables. */
const LANDSCAPE_CSS = '@page { size: landscape; }';

/** Smaller type and cells, for tables with a column per date. */
const DENSE_CSS = `
  table { font-size: 7.5pt; }
  th, td { padding: 0.6mm 1mm; }
  .attendance-table thead th:nth-child(n+3) {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    white-space: nowrap;
    text-align: right;
  }
  .attendance-table td:nth-child(n+3) { text-align: center; }
`;

/**
 * @param {HTMLTableCellElement} cell - A table cell
 * @returns {boolean} True when the cell says nothing
 */
function isEmptyCell(cell) {
  return EMPTY_CELL.test(cell.textContent || '');
}

/**
 * Remove the columns of a table that no row has anything in, except the first
 * one, which names the row. A table whose cells span several rows or columns is
 * left as it is, since its columns cannot be told apart by position.
 *
 * @param {HTMLTableElement} table - A table in the print copy of the report
 * @returns {void}
 */
export function dropEmptyColumns(table) {
  const bodyRows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
  const headerRow = table.tHead?.rows[0];
  if (!headerRow || bodyRows.length === 0) {return;}

  const spans = table.querySelectorAll('[rowspan], [colspan]');
  const columnCount = headerRow.cells.length;
  const regular = bodyRows.every((row) => row.cells.length === columnCount);
  if (spans.length > 0 || !regular) {return;}

  for (let column = columnCount - 1; column > 0; column -= 1) {
    if (bodyRows.every((row) => isEmptyCell(row.cells[column]))) {
      headerRow.deleteCell(column);
      bodyRows.forEach((row) => row.deleteCell(column));
    }
  }
}

/**
 * Build the document printed for a report: the report's own markup under a
 * title line carrying the date, with the print stylesheet.
 *
 * @param {HTMLElement} container - The report as shown in the dialog
 * @param {{title: string, dateLabel?: string}} options - Document title and the date printed under it
 * @returns {string} Markup to give to `setPrintContent`
 */
export function buildReportPrintDocument(container, { title, dateLabel = '' }) {
  const sheet = container.cloneNode(true);
  sheet.removeAttribute('id');
  sheet.classList.add('report-sheet');
  sheet.querySelectorAll('button, [role="status"]').forEach((element) => element.remove());

  const tables = Array.from(sheet.querySelectorAll('table'));
  tables.forEach(dropEmptyColumns);

  const widest = tables.reduce(
    (max, table) => Math.max(max, table.rows[0]?.cells.length || 0),
    0,
  );

  const styles = [
    REPORT_PRINT_CSS,
    widest >= LANDSCAPE_MIN_COLUMNS ? LANDSCAPE_CSS : '',
    widest >= DENSE_MIN_COLUMNS ? DENSE_CSS : '',
  ].join('\n');

  return `
    <html>
      <head>
        <title>${escapeHTML(title)}</title>
        <style>${styles}</style>
      </head>
      <body>
        <header class="report-sheet__header">
          <p class="report-sheet__title"><strong>${escapeHTML(title)}</strong></p>
          <p>${escapeHTML(dateLabel)}</p>
        </header>
        ${sheet.outerHTML}
      </body>
    </html>
  `;
}
