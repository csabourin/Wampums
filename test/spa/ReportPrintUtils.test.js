/**
 * @jest-environment jsdom
 *
 * A report on paper: as few sheets as it can take while staying easy to read.
 */

jest.mock('../../spa/utils/SecurityUtils.js', () => ({
  escapeHTML: (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'),
}));

import { buildReportPrintDocument, dropEmptyColumns } from '../../spa/utils/ReportPrintUtils.js';

/**
 * @param {string} html - Output of buildReportPrintDocument
 * @returns {Document} The document the print window would show
 */
function parse(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * @param {string} markup - Report markup
 * @returns {HTMLElement} A `#report-content` element holding it
 */
function reportWith(markup) {
  const container = document.createElement('div');
  container.id = 'report-content';
  container.innerHTML = markup;
  return container;
}

const ALLERGY_TABLE = `
  <h2>allergies_report</h2>
  <p class="report-meta">participants: 2</p>
  <div class="table-scroll">
    <table class="data-table">
      <caption class="visually-hidden">allergies_report</caption>
      <thead><tr>
        <th scope="col">name</th><th scope="col">group</th><th scope="col">allergies</th>
        <th scope="col">severity</th><th scope="col">reaction</th><th scope="col">notes</th>
      </tr></thead>
      <tbody>
        <tr><th scope="row">Léa Roy</th><td>Rouge</td><td>Arachides</td><td>—</td><td>—</td><td>—</td></tr>
        <tr><th scope="row">Sam Roy</th><td>Rouge</td><td>Lait</td><td>—</td><td> </td><td>—</td></tr>
      </tbody>
    </table>
  </div>
`;

describe('columns nobody filled', () => {
  test('a column holding only dashes or blanks is left out of the printed table', () => {
    const printed = parse(buildReportPrintDocument(reportWith(ALLERGY_TABLE), { title: 'Allergies' }));
    const headers = [...printed.querySelectorAll('thead th')].map((th) => th.textContent);

    expect(headers).toEqual(['name', 'group', 'allergies']);
    expect(printed.querySelectorAll('tbody tr')[0].cells).toHaveLength(3);
  });

  test('the column naming the row stays even when it is blank', () => {
    const table = reportWith(`
      <table><thead><tr><th>name</th><th>group</th></tr></thead>
      <tbody><tr><td>—</td><td>Rouge</td></tr></tbody></table>
    `).querySelector('table');

    dropEmptyColumns(table);

    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['name', 'group']);
  });

  test('a column with an answer in a single row is kept', () => {
    const table = reportWith(`
      <table><thead><tr><th>name</th><th>notes</th></tr></thead>
      <tbody><tr><td>Léa</td><td>—</td></tr><tr><td>Sam</td><td>Garder deux auto-injecteurs</td></tr></tbody></table>
    `).querySelector('table');

    dropEmptyColumns(table);

    expect(table.querySelectorAll('thead th')).toHaveLength(2);
  });

  test('a "no" answer is an answer and is kept', () => {
    const table = reportWith(`
      <table><thead><tr><th>name</th><th>vaccines</th></tr></thead>
      <tbody><tr><td>Léa</td><td>no</td></tr><tr><td>Sam</td><td>no</td></tr></tbody></table>
    `).querySelector('table');

    dropEmptyColumns(table);

    expect(table.querySelectorAll('thead th')).toHaveLength(2);
  });

  test('a table with cells spanning rows or columns is printed as it is', () => {
    const table = reportWith(`
      <table><thead><tr><th>den</th><th>name</th><th>role</th></tr></thead>
      <tbody><tr><td rowspan="2">Rouge</td><td>Léa</td><td></td></tr><tr><td>Sam</td><td></td></tr></tbody></table>
    `).querySelector('table');

    dropEmptyColumns(table);

    expect(table.querySelectorAll('thead th')).toHaveLength(3);
  });

  test('the report on screen is not touched', () => {
    const report = reportWith(ALLERGY_TABLE);

    buildReportPrintDocument(report, { title: 'Allergies' });

    expect(report.querySelectorAll('thead th')).toHaveLength(6);
    expect(report.id).toBe('report-content');
  });
});

describe('sheet layout', () => {
  test('the header row is repeated on every sheet and a row is never split', () => {
    const { head } = parse(buildReportPrintDocument(reportWith(ALLERGY_TABLE), { title: 'Allergies' }));
    const css = head.querySelector('style').textContent;

    expect(css).toMatch(/thead\s*{\s*display:\s*table-header-group/);
    expect(css).toMatch(/tr\s*{\s*break-inside:\s*avoid/);
  });

  test('a narrow table is printed upright', () => {
    const { head } = parse(buildReportPrintDocument(reportWith(ALLERGY_TABLE), { title: 'Allergies' }));

    expect(head.querySelector('style').textContent).not.toContain('size: landscape');
  });

  test('a wide table is printed on a sideways sheet', () => {
    const wide = `
      <table><thead><tr>${'<th>col</th>'.repeat(7)}</tr></thead>
      <tbody><tr>${'<td>x</td>'.repeat(7)}</tr></tbody></table>
    `;
    const { head } = parse(buildReportPrintDocument(reportWith(wide), { title: 'Wide' }));

    expect(head.querySelector('style').textContent).toContain('size: landscape');
  });

  test('a table with a column per date gets smaller type', () => {
    const dates = `
      <table class="attendance-table"><thead><tr><th>name</th><th>group</th>${'<th>d</th>'.repeat(12)}</tr></thead>
      <tbody><tr><td>Léa</td><td>Rouge</td>${'<td>P</td>'.repeat(12)}</tr></tbody></table>
    `;
    const { head } = parse(buildReportPrintDocument(reportWith(dates), { title: 'Attendance' }));

    expect(head.querySelector('style').textContent).toContain('writing-mode: vertical-rl');
  });

  test('the sheet states what it is and when it was printed', () => {
    const printed = parse(buildReportPrintDocument(reportWith(ALLERGY_TABLE), {
      title: 'Rapport des allergies',
      dateLabel: '18 oct. 2026',
    }));

    expect(printed.title).toBe('Rapport des allergies');
    expect(printed.querySelector('.report-sheet__header').textContent).toContain('Rapport des allergies');
    expect(printed.querySelector('.report-sheet__header').textContent).toContain('18 oct. 2026');
  });
});

describe('what is not printed', () => {
  test('buttons and loading messages of the dialog stay off the sheet', () => {
    const report = reportWith(`
      <p role="status">loading</p>
      <button type="button">retry</button>
      ${ALLERGY_TABLE}
    `);

    const printed = parse(buildReportPrintDocument(report, { title: 'Allergies' }));

    expect(printed.querySelector('button')).toBeNull();
    expect(printed.querySelector('[role="status"]')).toBeNull();
  });

  test('a title that is markup is printed as text', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const printed = parse(buildReportPrintDocument(reportWith(ALLERGY_TABLE), { title: hostile, dateLabel: hostile }));

    expect(printed.querySelector('img')).toBeNull();
    expect(printed.querySelector('.report-sheet__header').textContent).toContain(hostile);
  });
});
