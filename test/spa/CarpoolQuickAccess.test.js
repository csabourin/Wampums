/**
 * @jest-environment jsdom
 *
 * The /carpool landing's "open the carpool selector" button called
 * `Dashboard.showCarpoolQuickAccess()`, a method removed when the picker moved
 * to CarpoolQuickAccessModal. The TypeError was reported as "Error loading
 * activities" on every click. The landing now opens the shared modal, which is
 * a labelled dialog that traps focus, closes on Escape and returns focus.
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
jest.mock('../../spa/modules/modals/QuickCreateActivityModal.js', () => ({
  QuickCreateActivityModal: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
}));

const { getActivities } = require('../../spa/api/api-activities.js');
const { CarpoolLanding } = require('../../spa/carpool.js');
const { QuickCreateActivityModal } = require('../../spa/modules/modals/QuickCreateActivityModal.js');

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

async function openFromLanding(app = { lang: 'fr', showMessage: jest.fn() }) {
  document.body.innerHTML = '<main id="app"></main>';
  const landing = new CarpoolLanding(app);
  landing.render();
  landing.attachEventListeners();
  const trigger = document.getElementById('carpool-open-selector');
  trigger.focus();
  await landing.openActivityPicker();
  await nextFrame();
  return { app, trigger, dialog: document.querySelector('#carpool-quick-access-modal [role="dialog"]') };
}

beforeEach(() => {
  getActivities.mockReset();
  QuickCreateActivityModal.mockClear();
});

// Let the dialog's focus-return observer settle before jsdom tears down.
afterEach(async () => {
  document.body.innerHTML = '';
  await flushObservers();
});

describe('carpool landing activity picker', () => {
  test('opens the picker instead of reporting a loading error', async () => {
    getActivities.mockResolvedValue([UPCOMING, PAST]);
    const { app, dialog } = await openFromLanding();

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
    const { app } = await openFromLanding();

    expect(app.showMessage).toHaveBeenCalledWith('error_loading_activities', 'error');
    expect(document.getElementById('carpool-quick-access-modal')).toBeNull();
  });

  test('shows the empty state when nothing is upcoming', async () => {
    getActivities.mockResolvedValue([PAST]);
    const { dialog } = await openFromLanding();

    expect(dialog.textContent).toContain('no_upcoming_activities');
    expect(dialog.querySelector('a.carpool-quick-access__activity')).toBeNull();
  });
});

describe('carpool quick access dialog accessibility', () => {
  test('is a labelled modal dialog with a named close button', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { dialog } = await openFromLanding();

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(document.getElementById(titleId).textContent).toBe('carpool_coordination');
    expect(dialog.querySelector('.modal-close').getAttribute('aria-label')).toBe('close');
  });

  test('moves focus into the dialog and wraps Tab inside it', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { dialog } = await openFromLanding();
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
    const { dialog, trigger } = await openFromLanding();

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flushObservers();

    expect(document.getElementById('carpool-quick-access-modal')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('the close button closes it', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { dialog } = await openFromLanding();

    dialog.querySelector('.modal-close').click();

    expect(document.getElementById('carpool-quick-access-modal')).toBeNull();
  });

  test('quick create closes the picker and opens the activity form', async () => {
    getActivities.mockResolvedValue([]);
    const { dialog } = await openFromLanding();

    dialog.querySelector('[data-action="quick-create"]').click();

    expect(document.getElementById('carpool-quick-access-modal')).toBeNull();
    expect(QuickCreateActivityModal).toHaveBeenCalledWith(expect.anything(), { redirectPath: '/carpool/{id}' });
  });

  test('opening twice keeps a single dialog', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { app } = await openFromLanding();
    await new CarpoolLanding(app).openActivityPicker();

    expect(document.querySelectorAll('#carpool-quick-access-modal')).toHaveLength(1);
  });

  test('has no WCAG A/AA violations', async () => {
    getActivities.mockResolvedValue([UPCOMING]);
    const { dialog } = await openFromLanding();

    const results = await axe.run(dialog, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
