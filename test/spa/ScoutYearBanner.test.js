/**
 * @jest-environment jsdom
 */

/**
 * The year selector is an occasional tool: it appears only once the unit turns
 * it on, but a leader already consulting an archived year always keeps the way
 * back to the current one.
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => { element.innerHTML = html; },
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true) }));
jest.mock('../../spa/api/api-scout-years.js', () => ({ getScoutYears: jest.fn() }));

const mockSelected = { current: null };
jest.mock('../../spa/modules/scout-year/ScoutYearContext.js', () => ({
  getSelectedScoutYear: () => mockSelected.current,
  setSelectedScoutYear: jest.fn(),
  clearSelectedScoutYear: jest.fn(),
  onScoutYearChange: jest.fn(),
}));

const YEARS = [
  { id: 2, label: '2026-2027', status: 'active' },
  { id: 1, label: '2025-2026 <b>', status: 'closed' },
];

let initScoutYearBanner;
let getScoutYears;

beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  mockSelected.current = null;
  ({ getScoutYears } = require('../../spa/api/api-scout-years.js'));
  getScoutYears.mockResolvedValue(YEARS);
  ({ initScoutYearBanner } = require('../../spa/modules/scout-year/ScoutYearBanner.js'));
});

test('a unit that has not turned the selector on shows no year picker and asks for no years', async () => {
  await initScoutYearBanner();

  expect(document.getElementById('scout-year-select')).toBeNull();
  expect(getScoutYears).not.toHaveBeenCalled();
});

test('once the unit turns it on, the labelled selector lists every year', async () => {
  await initScoutYearBanner({ enabled: true });

  const select = document.getElementById('scout-year-select');
  expect(select.labels[0].textContent.trim()).toBe('scout_year_selector_label');
  expect(Array.from(select.options).map((option) => option.textContent.trim()))
    .toEqual(['2026-2027 — scout_year_status_active', '2025-2026 <b>']);
  expect(document.querySelector('#scout-year-banner b')).toBeNull();

  const results = await axe.run(document.getElementById('scout-year-banner'), {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});

test('turning it off again hides the selector without reloading the page', async () => {
  await initScoutYearBanner({ enabled: true });
  await initScoutYearBanner({ enabled: false });

  expect(document.getElementById('scout-year-select')).toBeNull();
});

test('a leader consulting an archived year keeps the way back even with the selector off', async () => {
  mockSelected.current = { id: 1, label: '2025-2026', status: 'closed' };
  await initScoutYearBanner({ enabled: false });

  expect(document.getElementById('scout-year-select')).toBeNull();
  const exit = document.getElementById('scout-year-exit');
  expect(exit.tagName).toBe('BUTTON');
  expect(exit.textContent.trim()).toBe('scout_year_back_to_current');
});
