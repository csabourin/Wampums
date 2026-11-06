/**
 * @jest-environment jsdom
 *
 * The carpool picker (the dashboard's carpool tile) is a labelled dialog that
 * traps focus, closes on Escape and returns focus. The /carpool landing lists
 * the same upcoming outings directly on the page: choosing an outing is the
 * whole task, and a page of grey placeholders under a "selector" button read
 * as a page that never finished loading (#1371).
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/api/api-activities.js', () => ({ getActivities: jest.fn() }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true) }));
jest.mock('../../spa/modules/modals/QuickCreateActivityModal.js', () => ({
  QuickCreateActivityModal: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
}));

const { getActivities } = require('../../spa/api/api-activities.js');
const { CarpoolLanding } = require('../../spa/modules/carpool/CarpoolLanding.js');
const { QuickCreateActivityModal } = require('../../spa/modules/modals/QuickCreateActivityModal.js');
const { CarpoolQuickAccessModal } = require('../../spa/modules/modals/CarpoolQuickAccessModal.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const UPCOMING = {
  id: 42,
  name: 'Camp <b>hiver</b>',
  activity_start_date: '2099-01-10',
  activity_end_date: '2099-01-12',
  meeting_location_going: 'Église',
  carpool_offer_count: 3,
  assigned_participant_count: 7,
};
const PAST = { ...UPCOMING, id: 7, name: 'Old camp', activity_start_date: '2000-01-01', activity_end_date: '2000-01-02' };

function nextFrame() {
  return new Promise((resolve) => { requestAnimationFrame(() => resolve()); });
}

function flushObservers() {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

async function openPicker(app = { lang: 'fr', showMessage: jest.fn() }) {
  document.body.innerHTML = '<main id="app"><button type="button" id="picker-trigger">open</button></main>';
  const trigger = document.getElementById('picker-trigger');
  trigger.focus();
  await new CarpoolQuickAccessModal(app).show();
  await nextFrame();
  return { app, trigger, dialog: document.querySelector('#carpool-quick-access-modal [role="dialog"]') };
}

async function openLanding(app = { lang: 'fr', showMessage: jest.fn() }) {
  document.body.innerHTML = '<main id="app"></main>';
  const landing = new CarpoolLanding(app);
  landing.render();
  landing.attachEventListeners();
  await landing.loadActivities();
  return { app, landing, page: document.getElementById('app') };
}

beforeEach(() => {
  getActivities.mockReset();
  hasPermission.mockReset();
  hasPermission.mockReturnValue(true);
  QuickCreateActivityModal.mockClear();
});

// Let the dialog's focus-return observer settle before jsdom tears down.
afterEach(async () => {
  document.body.innerHTML = '';
  await flushObservers();
});

describe('carpool activity picker', () => {
  test('lists only upcoming activities, names escaped', async () => {
    getActivities.mockResolvedValue([UPCOMING, PAST]);
    const { app, dialog } = await openPicker();

    expect(app.showMessage).not.toHaveBeenCalled();
    expect(dialog).not.toBeNull();
    const links = dialog.querySelectorAll('a.carpool-quick-access__activity');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/carpool/42');
    expect(links[0].textContent).toContain('Camp <b>hiver</b>');
    expect(dialog.querySelector('b')).toBeNull();
  });

  test('reports a real API failure', async () => {
    getActivities.mockRejectedValue(new Error('500'));
    const { app } = await openPicker();

    expect(app.showMessage).toHaveBeenCalledWith('error_loading_activities', 'error');
    expect(document.getElementById('carpool-quick-access-modal')).toBeNull();
  });

  test('shows the empty state when nothing is upcoming', async () => {
    getActivities.mockResolvedValue([PAST]);
    const { dialog } = await openPicker();

    expect(dialog.textContent).toContain('no_upcoming_activities');
    expect(dialog.querySelector('a.carpool-quick-access__activity')).toBeNull();
  });
});

describe('carpool quick access dialog accessibility', () => {
  test('is a labelled modal dialog with a named close button', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { dialog } = await openPicker();

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(document.getElementById(titleId).textContent).toBe('carpool_coordination');
    expect(dialog.querySelector('.modal-close').getAttribute('aria-label')).toMatch(/^close$/i);
  });

  test('moves focus into the dialog and wraps Tab inside it', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { dialog } = await openPicker();
    // jsdom has no layout, so offsetParent is null; the focus trap filters on it.
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode; } });

    try {
      const closeButton = dialog.querySelector('.modal-close');
      const createButton = dialog.querySelector('[data-action="quick-create"]');
      expect(dialog.contains(document.activeElement)).toBe(true);

      createButton.focus();
      createButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(closeButton);

      closeButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(createButton);
    } finally {
      delete HTMLElement.prototype.offsetParent;
    }
  });

  test('Escape closes it and returns focus to the trigger', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { dialog, trigger } = await openPicker();

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flushObservers();

    expect(document.getElementById('carpool-quick-access-modal')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('the close button closes it', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { dialog } = await openPicker();

    dialog.querySelector('.modal-close').click();

    expect(document.getElementById('carpool-quick-access-modal')).toBeNull();
  });

  test('quick create closes the picker and opens the activity form', async () => {
    getActivities.mockResolvedValue([]);
    const { dialog } = await openPicker();

    dialog.querySelector('[data-action="quick-create"]').click();

    expect(document.getElementById('carpool-quick-access-modal')).toBeNull();
    expect(QuickCreateActivityModal).toHaveBeenCalledWith(expect.anything(), { redirectPath: '/carpool/{id}' });
  });

  test('opening twice keeps a single dialog', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { app } = await openPicker();
    await new CarpoolQuickAccessModal(app).show();

    expect(document.querySelectorAll('#carpool-quick-access-modal')).toHaveLength(1);
  });

  test('has no WCAG A/AA violations', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { dialog } = await openPicker();

    const results = await axe.run(dialog, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

describe('carpool picker offers to create an activity only to who may', () => {
  test('someone without activities.create sees no create button', async () => {
    hasPermission.mockImplementation((key) => key !== 'activities.create');
    getActivities.mockResolvedValue([UPCOMING]);
    const { dialog } = await openPicker();

    expect(dialog.querySelector('[data-action="quick-create"]')).toBeNull();
  });
});

describe('carpool landing page (/carpool)', () => {
  test('lists the upcoming outings directly, each a link to its rides, names escaped', async () => {
    getActivities.mockResolvedValue([UPCOMING, PAST]);
    const { page } = await openLanding();

    const links = page.querySelectorAll('a.carpool-quick-access__activity');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/carpool/42');
    expect(links[0].textContent).toContain('Camp <b>hiver</b>');
    expect(page.querySelector('b')).toBeNull();
    // No placeholder that never finishes loading, and no dialog to open first.
    expect(page.querySelector('.skeleton, .skeleton-text')).toBeNull();
    expect(page.querySelector('#carpool-open-selector')).toBeNull();
    expect(page.querySelector('[role="status"]')).toBeNull();
  });

  test('shows a loading status while the outings load', () => {
    getActivities.mockReturnValue(new Promise(() => {}));
    document.body.innerHTML = '<main id="app"></main>';
    const landing = new CarpoolLanding({ lang: 'fr', showMessage: jest.fn() });
    landing.render();
    landing.loadActivities();

    expect(document.querySelector('#carpool-landing-list [role="status"]').textContent).toBe('loading');
  });

  test('says what would fill an empty list', async () => {
    getActivities.mockResolvedValue([PAST]);
    const { page } = await openLanding();

    expect(page.querySelector('.carpool-landing__empty').textContent).toBe('carpool_landing_empty');
  });

  test('a failed load is an error with a retry that loads again', async () => {
    getActivities.mockRejectedValueOnce(Object.assign(new Error('Internal detail'), { status: 500 }));
    const { page } = await openLanding();

    const alert = page.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert.textContent).not.toContain('Internal detail');

    getActivities.mockResolvedValueOnce([UPCOMING]);
    page.querySelector('#carpool-landing-retry').click();
    await flushObservers();
    expect(page.querySelectorAll('a.carpool-quick-access__activity')).toHaveLength(1);
  });

  test('offers to create an outing only with activities.create', async () => {
    getActivities.mockResolvedValue([]);
    let { page } = await openLanding();
    page.querySelector('#carpool-landing-create').click();
    expect(QuickCreateActivityModal).toHaveBeenCalledWith(expect.anything(), { redirectPath: '/carpool/{id}' });

    hasPermission.mockImplementation((key) => key !== 'activities.create');
    ({ page } = await openLanding());
    expect(page.querySelector('#carpool-landing-create')).toBeNull();
  });

  test('a response arriving after leaving the page draws nothing', async () => {
    let resolve;
    getActivities.mockReturnValue(new Promise((r) => { resolve = r; }));
    document.body.innerHTML = '<main id="app"></main>';
    const landing = new CarpoolLanding({ lang: 'fr', showMessage: jest.fn() });
    landing.render();
    const loading = landing.loadActivities();
    landing.destroy();
    resolve([UPCOMING]);
    await loading;

    expect(document.querySelector('a.carpool-quick-access__activity')).toBeNull();
  });

  test('has no WCAG A/AA violations', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { page } = await openLanding();

    const results = await axe.run(page, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
