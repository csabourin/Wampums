/**
 * @jest-environment jsdom
 */

/**
 * Display — the colour theme of the dashboard on this device, reached from the
 * tile beside "My account". Each theme is a labelled radio button: choosing one
 * applies it at once and says so; the reset goes back to the defaults.
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: { ROLES: {} } }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
const mockPermissions = new Set(['scout_year.view']);
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: (permission) => mockPermissions.has(permission),
}));
const mockInitScoutYearBanner = jest.fn(() => Promise.resolve());
jest.mock('../../spa/modules/scout-year/ScoutYearBanner.js', () => ({
  initScoutYearBanner: (...args) => mockInitScoutYearBanner(...args),
}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => { element.innerHTML = html; },
  loadStylesheet: jest.fn(() => Promise.resolve()),
}));

import { DisplaySettings } from '../../spa/modules/display-settings/DisplaySettings.js';
import { getDashboardPrefs } from '../../spa/utils/DashboardPreferences.js';
import { DEFAULT_PALETTE_ID, PALETTES } from '../../spa/config/dashboard-customization.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

async function openScreen() {
  const screen = new DisplaySettings({});
  await screen.init();
  return screen;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockPermissions.clear();
  mockPermissions.add('scout_year.view');
  mockInitScoutYearBanner.mockClear();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
});

test('opens with the back link and a heading, and lists every theme as a labelled radio button', async () => {
  await openScreen();

  const app = document.getElementById('app');
  expect(app.querySelector('.page').firstElementChild.getAttribute('href')).toBe('/dashboard');
  expect(app.querySelector('h1').textContent).toBe('display_settings_title');
  const radios = Array.from(app.querySelectorAll('input[type="radio"][name="display_palette"]'));
  expect(radios.map((radio) => radio.value)).toEqual(Object.keys(PALETTES));
  radios.forEach((radio) => expect(radio.labels).toHaveLength(1));
  expect(app.querySelector('input:checked').value).toBe(DEFAULT_PALETTE_ID);
  expect(app.querySelector('fieldset legend').textContent.trim()).toBe('dashboard_palette');
});

test('choosing high contrast applies it on this device and says so', async () => {
  await openScreen();

  const radio = document.getElementById('display-palette-highContrast');
  radio.click();

  expect(getDashboardPrefs().paletteId).toBe('highContrast');
  expect(document.documentElement.dataset.dashboardPalette).toBe('highContrast');
  expect(radio.closest('label').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('display-settings-status').textContent)
    .toBe('display_settings_palette_applied'.replace('{name}', 'dashboard_palette_high_contrast'));
});

test('a theme chosen earlier is the one checked when the screen opens again', async () => {
  await openScreen();
  document.getElementById('display-palette-colorblindSafe').click();

  await openScreen();
  expect(document.querySelector('input:checked').value).toBe('colorblindSafe');
});

test('the reset returns to the default theme and announces it', async () => {
  await openScreen();
  document.getElementById('display-palette-mono').click();

  document.getElementById('display-settings-reset').click();

  expect(getDashboardPrefs().paletteId).toBe(DEFAULT_PALETTE_ID);
  expect(document.querySelector('input:checked').value).toBe(DEFAULT_PALETTE_ID);
  expect(document.getElementById('display-settings-status').textContent).toBe('display_settings_reset_done');
});

test('the year selector is off until asked for, then shown at once and remembered', async () => {
  await openScreen();
  const yearSwitch = document.getElementById('display-scout-year-selector');
  expect(yearSwitch.checked).toBe(false);
  expect(yearSwitch.labels[0].textContent).toBe('display_settings_scout_year_label');
  expect(document.getElementById(yearSwitch.getAttribute('aria-describedby')).textContent)
    .toBe('display_settings_scout_year_hint');

  yearSwitch.click();
  await flush();

  expect(getDashboardPrefs().showScoutYearSelector).toBe(true);
  expect(mockInitScoutYearBanner).toHaveBeenCalledWith({ enabled: true });
  expect(document.getElementById('display-settings-status').textContent).toBe('display_settings_scout_year_shown');

  await openScreen();
  expect(document.getElementById('display-scout-year-selector').checked).toBe(true);
});

test('the reset hides the year selector again', async () => {
  await openScreen();
  document.getElementById('display-scout-year-selector').click();
  await flush();

  document.getElementById('display-settings-reset').click();
  await flush();

  expect(getDashboardPrefs().showScoutYearSelector).toBe(false);
  expect(document.getElementById('display-scout-year-selector').checked).toBe(false);
  expect(mockInitScoutYearBanner).toHaveBeenLastCalledWith({ enabled: false });
});

test('someone who may not consult earlier years is not offered the year selector', async () => {
  mockPermissions.clear();
  await openScreen();
  expect(document.getElementById('display-scout-year-selector')).toBeNull();
});

test('while an archived year is consulted, every display choice stays usable', async () => {
  const { initArchiveReadOnly } = jest.requireActual('../../spa/modules/scout-year/ArchiveReadOnly.js');
  const { setSelectedScoutYear, clearSelectedScoutYear } = jest.requireActual('../../spa/modules/scout-year/ScoutYearContext.js');
  setSelectedScoutYear({ id: 4, label: '2024-2025', status: 'closed' });
  try {
    await openScreen();
    initArchiveReadOnly();
    await new Promise((resolve) => setTimeout(resolve, 120));

    const controls = Array.from(document.querySelectorAll('#app input, #app button'));
    expect(controls.length).toBeGreaterThan(Object.keys(PALETTES).length);
    controls.forEach((control) => expect(control.disabled).toBe(false));

    document.getElementById('display-palette-highContrast').click();
    expect(getDashboardPrefs().paletteId).toBe('highContrast');
  } finally {
    clearSelectedScoutYear();
  }
});

test('the screen has no WCAG A/AA violations', async () => {
  await openScreen();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});
