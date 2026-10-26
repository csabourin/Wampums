/**
 * @jest-environment jsdom
 */

/**
 * My units: a district administrator moves between the units they belong to,
 * the one they just created included.
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({ getUserOrganizations: jest.fn() }));
jest.mock('../../spa/modules/session/UnitSwitch.js', () => ({ switchActiveUnit: jest.fn() }));

import { getUserOrganizations } from '../../spa/api/api-endpoints.js';
import { switchActiveUnit } from '../../spa/modules/session/UnitSwitch.js';
import { UnitSwitcher } from '../../spa/modules/organizations/UnitSwitcher.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

const page = () => document.getElementById('app');
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const buttonNamed = (name) => Array.from(page().querySelectorAll('button'))
  .find((button) => button.getAttribute('aria-label') === name);

const UNITS = [
  { id: 3, name: 'Meute Ada' },
  { id: 9, name: 'Colonie Léa' },
];

async function openScreen() {
  const app = { organizationId: '3', showMessage: jest.fn(), router: { navigate: jest.fn() } };
  const screen = new UnitSwitcher(app);
  await screen.init();
  return { app, screen };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  getUserOrganizations.mockResolvedValue({ success: true, data: UNITS });
});

test('lists every unit, marks the current one, and reads the list fresh', async () => {
  await openScreen();

  expect(getUserOrganizations).toHaveBeenCalledWith({ forceRefresh: true });
  const items = page().querySelectorAll('li');
  expect(items).toHaveLength(2);
  expect(items[0].getAttribute('aria-current')).toBe('true');
  expect(items[0].textContent).toContain('unit_switcher_current');
  expect(items[0].querySelector('button')).toBeNull();
  expect(buttonNamed('unit_switcher_open_named')).not.toBeUndefined();
  // The back link comes first, above the heading.
  expect(page().querySelector('section').firstElementChild.textContent).toContain('back');
});

test('opening another unit makes it the active one, then shows its dashboard', async () => {
  switchActiveUnit.mockResolvedValue();
  const { app } = await openScreen();

  const open = page().querySelector('[data-unit-id="9"]');
  open.click();
  expect(open.disabled).toBe(true);
  await flush();

  expect(switchActiveUnit).toHaveBeenCalledWith(app, 9);
  expect(app.router.navigate).toHaveBeenCalledWith('/dashboard');
});

test('a unit that cannot be opened is explained, and the person can try again', async () => {
  switchActiveUnit.mockRejectedValue(Object.assign(new Error('refused'), { status: 403 }));
  const { app } = await openScreen();

  const open = page().querySelector('[data-unit-id="9"]');
  open.click();
  await flush();

  expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
  expect(app.router.navigate).not.toHaveBeenCalled();
  expect(open.disabled).toBe(false);
});

test('a failed load is shown as an error with a retry, not as an empty list', async () => {
  getUserOrganizations.mockRejectedValueOnce(new Error('offline'));
  await openScreen();

  expect(page().querySelector('[role="alert"]').textContent).toContain('unit_switcher_load_failed');
  expect(page().textContent).not.toContain('unit_switcher_empty');

  page().querySelector('button').click();
  await flush();
  expect(page().querySelectorAll('li')).toHaveLength(2);
});

test('no unit says what would fill the list', async () => {
  getUserOrganizations.mockResolvedValue({ success: true, data: [] });
  await openScreen();

  expect(page().textContent).toContain('unit_switcher_empty');
});

test('a unit named with markup is shown as text', async () => {
  getUserOrganizations.mockResolvedValue({ success: true, data: [{ id: 4, name: '<img src=x onerror=alert(1)>' }] });
  await openScreen();

  expect(page().querySelector('img')).toBeNull();
  expect(page().querySelector('.unit-switcher__name').textContent).toBe('<img src=x onerror=alert(1)>');
});

test('nothing is drawn after the person has left', async () => {
  let answer;
  getUserOrganizations.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  const app = { organizationId: 3, showMessage: jest.fn(), router: { navigate: jest.fn() } };
  const screen = new UnitSwitcher(app);
  const loading = screen.init();
  screen.destroy();
  page().textContent = 'next screen';
  answer({ success: true, data: UNITS });
  await loading;

  expect(page().textContent).toBe('next screen');
});

test('the list has no accessibility violations', async () => {
  await openScreen();
  expect((await axe.run(page(), AXE_OPTIONS)).violations).toEqual([]);
});
