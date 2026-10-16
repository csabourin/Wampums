/**
 * @jest-environment jsdom
 */

/**
 * Fundraising and carpool screens moved out of the spa/ root, held to
 * CLAUDE.md §7: the way back and the title in every state, a loading state,
 * a failed load shown as an alert with a retry (never as "no fundraisers",
 * "no entries" or "activity not found"), names shown as text, and no WCAG
 * 2.x A/AA violation axe can find without layout.
 *
 * @module test/spa/FundraisingCarpoolScreens
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { CACHE_DURATION: {}, DEFAULT_CURRENCY: 'CAD', DEFAULT_LANG: 'fr' },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  ...jest.requireActual('../../spa/utils/DOMUtils.js'),
  // jsdom fires no load event for a stylesheet; the page's styles are not what is tested.
  loadStylesheet: jest.fn().mockResolvedValue(),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewFundraisers: () => true,
  canCreateFundraisers: () => true,
  canEditFundraisers: () => true,
  canDeleteFundraisers: () => true,
  canManageCarpools: () => false,
  canViewCarpools: () => true,
  isParent: () => true,
}));
jest.mock('../../spa/indexedDB.js', () => ({
  clearFundraiserRelatedCaches: jest.fn(),
  getCachedData: jest.fn(),
  setCachedData: jest.fn(),
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirmDestructive: jest.fn(),
  confirm: jest.fn(),
  prompt: jest.fn(),
}));
jest.mock('../../spa/ajax-functions.js', () => ({
  getFundraisers: jest.fn(),
  createFundraiser: jest.fn(),
  updateFundraiser: jest.fn(),
  archiveFundraiser: jest.fn(),
  deleteFundraiser: jest.fn(),
  getFundraiser: jest.fn(),
  getCalendarsForFundraiser: jest.fn(),
  updateCalendarEntry: jest.fn(),
  updateCalendarPayment: jest.fn(),
}));
jest.mock('../../spa/api/api-activities.js', () => ({
  getActivity: jest.fn(),
  getActivityParticipants: jest.fn(),
}));
jest.mock('../../spa/api/api-carpools.js', () => ({
  getCarpoolOffers: jest.fn(),
  createCarpoolOffer: jest.fn(),
  updateCarpoolOffer: jest.fn(),
  cancelCarpoolOffer: jest.fn(),
  assignParticipantToCarpool: jest.fn(),
  removeAssignment: jest.fn(),
  getUnassignedParticipants: jest.fn(),
}));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: { campMode: false, isOffline: false } }));
jest.mock('../../spa/modules/modals/CarpoolQuickAccessModal.js', () => ({ CarpoolQuickAccessModal: jest.fn() }));

import * as ajax from '../../spa/ajax-functions.js';
import * as activities from '../../spa/api/api-activities.js';
import * as carpools from '../../spa/api/api-carpools.js';
import { offlineManager } from '../../spa/modules/OfflineManager.js';
import { Calendars } from '../../spa/modules/fundraising/Calendars.js';
import { Fundraisers } from '../../spa/modules/fundraising/Fundraisers.js';
import { CarpoolDashboard } from '../../spa/modules/carpool/CarpoolDashboard.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const NOT_FOUND = Object.assign(new Error('Not found'), { status: 404 });
const FORBIDDEN = Object.assign(new Error('Forbidden'), { status: 403 });

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const page = () => document.getElementById('app');
const makeApp = () => ({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } });

/** @returns {Promise<Array>} axe violations inside #app */
async function violations() {
  return (await axe.run(page(), AXE_OPTIONS)).violations;
}

/** The first link on the page is the way back, before the title. */
function expectWayBack(href) {
  const back = page().querySelector('a');
  expect(back.getAttribute('href')).toBe(href);
  expect(back.compareDocumentPosition(page().querySelector('h1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

/** A load that never answers until the test lets it. */
function pending() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  offlineManager.isOffline = false;
});

describe('a fundraiser\'s entries', () => {
  const FUNDRAISER = { id: 3, name: HOSTILE, start_date: '2026-10-01', end_date: '2026-12-01', campaign_type: 'calendar_sale' };
  const ENTRIES = [{ id: 1, first_name: HOSTILE, last_name: 'Roy', group_name: HOSTILE, quantity: 2, amount_paid: 0, paid: false }];

  function loaded() {
    ajax.getFundraiser.mockResolvedValue({ success: true, data: { fundraiser: FUNDRAISER } });
    ajax.getCalendarsForFundraiser.mockResolvedValue({ success: true, data: { fundraiser_entries: ENTRIES, campaign: FUNDRAISER } });
  }

  test('says it is loading, with the way back to the fundraisers', async () => {
    const load = pending();
    ajax.getFundraiser.mockReturnValue(load.promise);
    ajax.getCalendarsForFundraiser.mockResolvedValue({ success: true, data: { fundraiser_entries: [] } });
    const screen = new Calendars(makeApp());
    const done = screen.init(3);

    expect(page().querySelector('[aria-busy="true"] [role="status"]')).not.toBeNull();
    expectWayBack('/fundraisers');
    load.resolve({ success: true, data: { fundraiser: FUNDRAISER } });
    await done;
  });

  test('shows the campaign and names as text and passes axe', async () => {
    loaded();
    await new Calendars(makeApp()).init(3);

    expectWayBack('/fundraisers');
    expect(page().querySelector('h1').textContent).toBe(HOSTILE);
    expect(page().querySelector('img')).toBeNull();
    expect(page().querySelector('#print-view-btn').className).toBe('button button--secondary');
    expect(await violations()).toEqual([]);
  });

  test('entries that did not load are an error with a retry, never "no entries"', async () => {
    loaded();
    ajax.getCalendarsForFundraiser.mockRejectedValueOnce(new Error('offline'));
    await new Calendars(makeApp()).init(3);

    expect(page().querySelector('.no-data')).toBeNull();
    expect(page().querySelector('[role="alert"]').textContent).toBe('error_fetching_fundraiser_entries');
    expect(page().querySelector('#page-retry')).not.toBeNull();
    expectWayBack('/fundraisers');
  });

  test('a fundraiser that does not exist says so, with the way back', async () => {
    ajax.getFundraiser.mockRejectedValue(NOT_FOUND);
    await new Calendars(makeApp()).init(3);

    expect(page().querySelector('[role="alert"]')).toBeNull();
    expect(page().querySelector('a[href="/fundraisers"]')).not.toBeNull();
    expect(page().querySelector('h1')).not.toBeNull();
  });
});

describe('fundraisers', () => {
  const LIST = { success: true, data: { fundraisers: [{ id: 3, name: HOSTILE, start_date: '2026-10-01', end_date: '2026-12-01', archived: false }] } };

  test('lists campaigns as text and passes axe', async () => {
    ajax.getFundraisers.mockResolvedValue(LIST);
    await new Fundraisers(makeApp()).init();

    expectWayBack('/dashboard');
    expect(page().querySelector('img')).toBeNull();
    expect(page().querySelector('#add-fundraiser-btn').className).toBe('button button--primary');
    expect(await violations()).toEqual([]);
  });

  test('a list that did not load is an error with a retry, never "no fundraisers"', async () => {
    ajax.getFundraisers.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(LIST);
    await new Fundraisers(makeApp()).init();

    expect(page().textContent).not.toContain('no_fundraisers');
    expect(page().querySelector('[role="alert"]').textContent).toBe('error_fetching_fundraisers');

    page().querySelector('#page-retry').click();
    await flush();
    expect(page().querySelectorAll('.fundraisers-list > *')).toHaveLength(1);
  });

  test('an archive the server accepted keeps the list when the reload after it fails', async () => {
    ajax.getFundraisers.mockResolvedValueOnce(LIST);
    const app = makeApp();
    const screen = new Fundraisers(app);
    await screen.init();
    ajax.archiveFundraiser.mockResolvedValue({ success: true });
    ajax.getFundraisers.mockRejectedValueOnce(new Error('offline'));

    await screen.archiveFundraiser(3);

    expect(app.showMessage).toHaveBeenCalledWith('fundraiser_archived', 'success');
    expect(app.showMessage).toHaveBeenCalledWith('error_loading_data', 'error');
    expect(screen.fundraisers).toHaveLength(1);
  });

  test('a refused archive says it was refused', async () => {
    ajax.getFundraisers.mockResolvedValue(LIST);
    const app = makeApp();
    const screen = new Fundraisers(app);
    await screen.init();
    ajax.archiveFundraiser.mockRejectedValue(FORBIDDEN);

    await screen.archiveFundraiser(3);

    expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
  });
});

describe('carpool dashboard', () => {
  const ACTIVITY = { id: 1, name: HOSTILE, meeting_location_going: 'Local', invites_everyone: true };

  function loaded() {
    activities.getActivity.mockResolvedValue(ACTIVITY);
    activities.getActivityParticipants.mockResolvedValue([]);
    carpools.getCarpoolOffers.mockResolvedValue([]);
  }

  test('while loading, shows the way back and its title and says it is loading', async () => {
    const load = pending();
    activities.getActivity.mockReturnValue(load.promise);
    activities.getActivityParticipants.mockResolvedValue([]);
    carpools.getCarpoolOffers.mockResolvedValue([]);
    const screen = new CarpoolDashboard(makeApp(), '1');
    const done = screen.init();
    await flush();

    expectWayBack('/dashboard');
    expect(page().querySelector('h1').textContent).toBe('carpool_coordination');
    expect(page().querySelector('[aria-busy="true"] [role="status"]').textContent).toBe('loading');
    load.resolve(ACTIVITY);
    await done;
  });

  test('passes axe once loaded, with the activity named as text', async () => {
    loaded();
    await new CarpoolDashboard(makeApp(), '1').init();

    expectWayBack('/dashboard');
    expect(page().querySelector('.activity-info-card h2').textContent).toBe(HOSTILE);
    expect(page().querySelector('img')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  test('an activity that did not load is an error with a retry, not "activity not found"', async () => {
    loaded();
    activities.getActivity.mockRejectedValueOnce(new Error('offline'));
    await new CarpoolDashboard(makeApp(), '1').init();

    expect(page().textContent).not.toContain('activity_not_found');
    expect(page().querySelector('[role="alert"]').textContent).toBe('error_loading_carpool_data');
    expect(page().querySelector('#page-retry')).not.toBeNull();
  });

  test('an activity that does not exist says so', async () => {
    loaded();
    activities.getActivity.mockRejectedValueOnce(NOT_FOUND);
    await new CarpoolDashboard(makeApp(), '1').init();

    expect(page().textContent).toContain('activity_not_found');
  });

  test('offline without prepared data, the page keeps its title and the way back', async () => {
    offlineManager.isOffline = true;
    await new CarpoolDashboard(makeApp(), '1').init();

    expectWayBack('/dashboard');
    expect(page().querySelector('h1').textContent).toBe('carpool_coordination');
    expect(page().textContent).toContain('offline_data_not_prepared');
  });
});
