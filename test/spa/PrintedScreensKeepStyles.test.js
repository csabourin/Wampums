/**
 * @jest-environment jsdom
 *
 * The badge form, the fundraiser sales sheet and the meeting preparation print
 * with their own styles. Each one used to write a whole <html> document whose
 * <style> sat in <head>; the sanitizer keeps only the body of that, so they
 * printed in the browser's default look. These tests print through the real
 * setPrintContent() into a stand-in print window.
 */
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { TIME_FORMAT: { DEFAULT: '24h' } },
  getStorageKey: jest.fn((key) => key),
}));
jest.mock('../../spa/utils/NumberUtils.js', () => ({ formatCurrency: (value) => `${value} $` }));
jest.mock('../../spa/ajax-functions.js', () => ({}));
// The section catalogue is an ES module jest does not transform.
jest.mock('../../spa/utils/meetingSections.js', () => ({ getHonorLabel: () => 'youth_of_honor' }));
jest.mock('../../spa/indexedDB.js', () => ({ clearFundraiserRelatedCaches: jest.fn() }));

import { BadgeForm } from '../../spa/modules/badges/BadgeForm.js';
import { Calendars } from '../../spa/modules/fundraising/Calendars.js';
import { PrintManager } from '../../spa/modules/PrintManager.js';

let printWindow;

beforeEach(() => {
  printWindow = {
    document: document.implementation.createHTMLDocument(''),
    print: jest.fn(),
    opener: null,
  };
  printWindow.document.close = jest.fn();
  jest.spyOn(window, 'open').mockReturnValue(printWindow);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** @returns {string} The print document's styles */
function printedStyles() {
  return [...printWindow.document.head.querySelectorAll('style')].map((style) => style.textContent).join('');
}

test('the badge application form prints with its form styles', () => {
  const form = new BadgeForm({ showMessage: jest.fn() });
  form.participant = { first_name: 'Max', last_name: 'S' };
  form.formData = { badge_template_label: 'Kaa', fierte: false };

  form.renderPrintView();

  expect(printedStyles()).toContain('.signature-line');
  expect(printWindow.document.title).toBe('badge_application_form');
  expect(printWindow.document.body.querySelector('h1').textContent).toBe('badge_application_form');
  expect(printWindow.print).toHaveBeenCalled();
});

test('the fundraiser sales sheet prints with its table styles', () => {
  const calendars = new Calendars({ showMessage: jest.fn(), lang: 'fr' });
  calendars.fundraiser = { name: 'Calendriers', start_date: '2026-10-01', end_date: '2026-11-01' };
  calendars.calendars = [{ first_name: 'Alex', last_name: 'Roy', amount: 10, amount_paid: 10, paid: true }];

  calendars.showPrintView();

  expect(printedStyles()).toContain('.print-table');
  expect(printWindow.document.title).toBe('Calendriers - fundraiser_sales_title');
  expect(printWindow.document.body.querySelector('table.print-table')).not.toBeNull();
  expect(printWindow.document.body.textContent).toContain('Alex Roy');
});

test('the meeting preparation prints with its layout styles', () => {
  document.body.innerHTML = `
    <select id="animateur-responsable"><option selected>Akela</option></select>
    <input id="date" value="2026-10-20">
    <input id="endroit" value="Local">
    <textarea id="notes">Apporter les foulards</textarea>
  `;
  const manager = new PrintManager({ getSelectedActivities: () => [] }, {}, 'Meute');

  manager.printPreparation();

  expect(printedStyles()).toContain('.note-line');
  expect(printWindow.document.title).toBe('weekly_meeting');
  expect(printWindow.document.body.querySelector('.print-preparation h1').textContent).toBe('Meute');
});

test('what leaders typed in the meeting preparation prints as text, line breaks kept', () => {
  const HOSTILE = '<img src=x onerror=alert(1)>';
  document.body.innerHTML = `
    <select id="animateur-responsable"><option selected></option></select>
    <input id="date" value="2026-10-20">
    <input id="endroit">
    <textarea id="notes"></textarea>
    <ul id="youth-of-honor"><li></li></ul>
  `;
  document.querySelector('#animateur-responsable option').textContent = HOSTILE;
  document.getElementById('endroit').value = 'Salle < 2';
  document.getElementById('notes').value = `Apporter ${HOSTILE}\nPuis ranger`;
  document.querySelector('#youth-of-honor li').textContent = HOSTILE;
  const manager = new PrintManager({
    getSelectedActivities: () => [{ time: '19:00', duration: 30, activity: HOSTILE, responsable: 'Akela', materiel: '<b>cordes</b>' }],
  }, {}, HOSTILE);

  manager.printPreparation();

  const body = printWindow.document.body;
  expect(body.querySelector('img')).toBeNull();
  expect(body.querySelector('b')).toBeNull();
  expect(body.querySelector('h1').textContent).toBe(HOSTILE);
  expect(body.textContent).toContain('Salle < 2');
  expect(body.querySelector('li').textContent).toBe(HOSTILE);
  expect(body.querySelector('.print-notes__text').textContent).toBe(`Apporter ${HOSTILE}\nPuis ranger`);
  const cells = [...body.querySelectorAll('tbody td')].map((td) => td.textContent);
  expect(cells).toEqual(['19:00', '30', HOSTILE, 'Akela', '<b>cordes</b>']);
  expect(printedStyles()).toContain('white-space: pre-wrap');
});
