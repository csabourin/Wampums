/**
 * @jest-environment jsdom
 *
 * What a print window receives: the sanitized markup, and the app's own print
 * styles intact. The sanitizer drops a <style> that opens a fragment, so a
 * report whose styles rode in its markup printed without them.
 */
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

import { setPrintContent, REPORT_PRINT_STYLES } from '../../spa/utils/PrintUtils.js';

/** @returns {{document: Document}} A stand-in print window with its own document */
function printWindow() {
  return { document: document.implementation.createHTMLDocument('') };
}

test('a printed report keeps its print styles', () => {
  const win = printWindow();
  setPrintContent(win, '<h2>Rapport</h2>', 'Allergies', { styles: REPORT_PRINT_STYLES });

  const style = win.document.head.querySelector('style');
  expect(style.textContent).toBe(REPORT_PRINT_STYLES);
  expect(style.textContent).toContain('column-count: 2');
  expect(win.document.title).toBe('Allergies');
  expect(win.document.body.querySelector('h2').textContent).toBe('Rapport');
});

test('the printed markup is still sanitized', () => {
  const win = printWindow();
  setPrintContent(win, '<p>ok</p><img src=x onerror="alert(1)"><script>alert(1)</script>', 'x');

  expect(win.document.body.querySelector('script')).toBeNull();
  expect(win.document.body.querySelector('img')?.getAttribute('onerror') ?? null).toBeNull();
  expect(win.document.body.textContent).toContain('ok');
});

test('a closed popup is reported, not written to', () => {
  expect(setPrintContent(null, '<p>x</p>', 'x')).toBe(false);
});
