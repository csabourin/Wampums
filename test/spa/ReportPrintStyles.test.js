/**
 * Reports read well on a phone and print on little paper.
 *
 * jsdom does not lay out or print, so this reads the rules. The layouts were
 * checked in a browser at 390px and in a print preview when they were written.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

jest.mock('../../spa/utils/SecurityUtils.js', () => ({ sanitizeToFragment: jest.fn() }));

import { REPORT_PRINT_STYLES } from '../../spa/utils/PrintUtils.js';

// Comments stripped, so one sitting above a rule does not stick to its selector.
const STYLES = readFileSync(path.join(__dirname, '../../css/styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The body of the first `@media` block whose condition matches.
 *
 * @param {RegExp} condition - Matches the text between `@media` and `{`
 * @param {string} [after] - Only look after this text
 * @returns {string} The block's rules
 */
function mediaBlock(condition, after = '') {
  const pattern = /@media([^{]+)\{/g;
  pattern.lastIndex = after ? STYLES.indexOf(after) : 0;
  let match;
  while ((match = pattern.exec(STYLES)) !== null) {
    if (condition.test(match[1])) {
      let depth = 1;
      let index = pattern.lastIndex;
      while (depth > 0 && index < STYLES.length) {
        if (STYLES[index] === '{') {
          depth += 1;
        } else if (STYLES[index] === '}') {
          depth -= 1;
        }
        index += 1;
      }
      return STYLES.slice(pattern.lastIndex, index - 1);
    }
  }
  return '';
}

describe('tables on a phone', () => {
  const stacking = mediaBlock(/width\s*<=\s*600px/);

  test('a table in the reports dialog keeps its columns and headers', () => {
    const displayBlock = stacking.match(/([^{}]+)\{\s*display:\s*block;\s*\}/)[1];
    for (const element of ['table', 'thead', 'tbody', 'th', 'td']) {
      expect(displayBlock).toMatch(new RegExp(`${element}:where\\(:not\\(\\.report-modal-content ${element}\\)\\)`));
    }
    expect(stacking).toMatch(/thead tr:where\(:not\(\.report-modal-content tr\)\)/);
  });

  test('a wide report table scrolls in its own region, not the page', () => {
    expect(STYLES).toMatch(/\.report-table-scroll\s*\{[^}]*overflow-x:\s*auto/);
  });
});

describe('printing the app', () => {
  test('the floating settings button and page chrome stay off paper', () => {
    const print = mediaBlock(/print/);
    const hidden = print.match(/([^{}]+)\{\s*display:\s*none\s*!important;\s*\}/)[1];
    for (const selector of ['.settings-icon', '.skip-link', '.privacy-policy-link', '#news-widget', '.button']) {
      expect(hidden).toContain(selector);
    }
  });

  test('the den list prints in two columns and never splits a den between pages', () => {
    const print = mediaBlock(/print/, '.den-list-card {');
    expect(print).toMatch(/\.den-list-grid\s*\{[^}]*column-count:\s*2/);
    expect(print).toMatch(/\.den-list-card\s*\{[^}]*break-inside:\s*avoid/);
    expect(print).toMatch(/\.den-list-report__printed\s*\{[^}]*display:\s*block/);
  });
});

describe('a report printed from its own window', () => {
  test('repeats the column headers on each page and never cuts a row or card', () => {
    expect(REPORT_PRINT_STYLES).toMatch(/thead\s*\{\s*display:\s*table-header-group;/);
    expect(REPORT_PRINT_STYLES).toMatch(/tr\s*\{[^}]*break-inside:\s*avoid/);
    expect(REPORT_PRINT_STYLES).toMatch(/\.report-record\s*\{[^}]*break-inside:\s*avoid/);
  });

  test('uses compact type and flows cards in two columns', () => {
    expect(REPORT_PRINT_STYLES).toMatch(/body\s*\{[^}]*font:\s*10pt/);
    expect(REPORT_PRINT_STYLES).toMatch(/\.report-records\s*\{[^}]*column-count:\s*2/);
  });

  test('keeps a visually hidden caption off the paper and controls out of it', () => {
    expect(REPORT_PRINT_STYLES).toMatch(/\.visually-hidden\s*\{[^}]*clip:/);
    expect(REPORT_PRINT_STYLES).toMatch(/button, select, input[^{]*\{\s*display:\s*none/);
  });
});
