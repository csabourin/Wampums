/**
 * @jest-environment jsdom
 */

/**
 * The parent dashboard, the permission slip opened from an email, offline
 * preparation and the communication settings, held to CLAUDE.md §7.
 *
 * A failure is never shown as "nothing here": children that did not load are
 * not "no children", a slip that could not be fetched is not "no such slip",
 * camps that did not load are not "no camp coming up", and Google Chat that
 * could not be read is not "not set up". Names people typed show as text.
 *
 * @module test/spa/FamilyAndSettingsScreens
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key, registerPushSubscription: jest.fn() }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({ CONFIG: { DEFAULT_LANG: 'fr', CACHE_DURATION: {}, UI: {} } }));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  ...jest.requireActual('../../spa/utils/DOMUtils.js'),
  // jsdom never fires a stylesheet's load event.
  loadStylesheet: jest.fn().mockResolvedValue(),
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirm: jest.fn(),
  confirmDestructive: jest.fn(),
  prompt: jest.fn(),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  isParent: jest.fn(() => true),
  hasPermission: () => false,
  canViewBadges: () => false,
  canApproveBadges: () => false,
  canViewReports: () => false,
  canViewActivities: () => false,
  canViewCarpools: () => false,
  canSendCommunications: () => true,
  canAccessAdminPanel: () => true,
}));
jest.mock('../../spa/ajax-functions.js', () => ({
  getCurrentOrganizationId: jest.fn(() => 7),
  getAuthHeader: jest.fn(),
  fetchParticipants: jest.fn(),
  getOrganizationFormFormats: jest.fn(),
  getOrganizationSettings: jest.fn(),
  getPublicOrganizationSettings: jest.fn(),
  getParticipantStatement: jest.fn(),
  linkUserParticipants: jest.fn(),
  getCurrentUser: jest.fn(),
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  declinePermissionSlip: jest.fn(),
  getPermissionSlips: jest.fn(),
  signPermissionSlip: jest.fn(),
  declinePublicPermissionSlip: jest.fn(),
  getPublicPermissionSlip: jest.fn(),
  signPublicPermissionSlip: jest.fn(),
}));
jest.mock('../../spa/api/api-scout-years.js', () => ({
  getFormsNeedingReview: jest.fn(),
  confirmFormReview: jest.fn(),
  getAuthorizationsPendingSignature: jest.fn(),
}));
jest.mock('../../spa/config/parent-dashboard-buttons.js', () => ({
  loadHiddenParentDashboardButtons: jest.fn(),
}));
jest.mock('../../spa/modules/modals/CarpoolQuickAccessModal.js', () => ({ CarpoolQuickAccessModal: jest.fn() }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: {
    campMode: false,
    preparedActivities: new Map(),
    getUpcomingCamps: jest.fn(),
    prepareForActivity: jest.fn(),
  },
}));
jest.mock('../../spa/api/api-google-chat.js', () => ({
  getGoogleChatConfig: jest.fn(),
  getGoogleChatSpaces: jest.fn(),
  saveGoogleChatCredentials: jest.fn(),
  saveGoogleChatSpace: jest.fn(),
  sendGoogleChatTestMessage: jest.fn(),
}));
jest.mock('../../spa/modules/whatsapp-connection.js', () => ({
  WhatsAppConnectionModule: jest.fn().mockImplementation(() => ({
    connectionStatus: { connected: false },
    init: jest.fn().mockResolvedValue(),
    render: () => '<section><h2>WhatsApp</h2></section>',
    attachEventListeners: jest.fn(),
    destroy: jest.fn(),
  })),
}));

import * as ajax from '../../spa/ajax-functions.js';
import * as endpoints from '../../spa/api/api-endpoints.js';
import * as scoutYears from '../../spa/api/api-scout-years.js';
import * as googleChat from '../../spa/api/api-google-chat.js';
import { loadHiddenParentDashboardButtons } from '../../spa/config/parent-dashboard-buttons.js';
import { offlineManager } from '../../spa/modules/OfflineManager.js';
import { isParent } from '../../spa/utils/PermissionUtils.js';
import { ParentDashboard } from '../../spa/modules/dashboard/ParentDashboard.js';
import { PermissionSlipSign } from '../../spa/modules/permission-slips/PermissionSlipSign.js';
import { OfflinePreparation } from '../../spa/modules/offline/OfflinePreparation.js';
import { CommunicationSettings } from '../../spa/modules/communication-settings/CommunicationSettings.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const page = () => document.getElementById('app');
const makeApp = () => ({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() }, organizationSettings: {} });
const alertText = () => page().querySelector('[role="alert"]:not(:empty)')?.textContent.trim();

/** @returns {Promise<Array>} axe violations inside #app */
async function violations() {
  return (await axe.run(page(), AXE_OPTIONS)).violations;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  localStorage.clear();
  jest.clearAllMocks();
  isParent.mockReturnValue(true);
});

describe('parent dashboard', () => {
  beforeEach(() => {
    ajax.getOrganizationFormFormats.mockResolvedValue({});
    loadHiddenParentDashboardButtons.mockResolvedValue(new Set());
    scoutYears.getFormsNeedingReview.mockResolvedValue([]);
    scoutYears.getAuthorizationsPendingSignature.mockResolvedValue([]);
    endpoints.getPermissionSlips.mockResolvedValue({ data: [] });
    ajax.getParticipantStatement.mockResolvedValue({ data: null });
  });

  test('says it is loading, then greets the parent by a name shown as text', async () => {
    let resolve;
    ajax.fetchParticipants.mockReturnValue(new Promise((done) => { resolve = done; }));
    const app = { ...makeApp(), userFullName: HOSTILE };
    const done = new ParentDashboard(app).init();

    expect(page().querySelector('[role="status"]').textContent).toBe('loading');
    resolve([]);
    await done;

    expect(page().querySelector('h1').textContent).toContain(HOSTILE);
    expect(page().querySelector('h1 img')).toBeNull();
  });

  test('children that did not load are an error with a retry, not "no children"', async () => {
    ajax.fetchParticipants.mockRejectedValueOnce(new Error('offline'));
    await new ParentDashboard(makeApp()).init();

    expect(alertText()).toBe('error_loading_parent_dashboard');
    expect(page().textContent).not.toContain('no_participants');
    expect(await violations()).toEqual([]);

    ajax.fetchParticipants.mockResolvedValue([{ id: 4, first_name: 'Léa', last_name: 'Roy' }]);
    page().querySelector('#parent-dashboard-retry').click();
    await flush();
    await flush();
    expect(page().querySelector('#parent-dashboard-retry')).toBeNull();
    expect(page().textContent).toContain('Léa');
  });

  test('forms that did not load leave the children listed', async () => {
    ajax.getOrganizationFormFormats.mockResolvedValue({ formats: null });
    ajax.fetchParticipants.mockResolvedValue([{ id: 4, first_name: 'Léa', last_name: 'Roy' }]);
    await new ParentDashboard(makeApp()).init();

    expect(page().textContent).toContain('Léa');
    expect(page().querySelector('#parent-dashboard-retry')).toBeNull();
  });

  test('a leader looking at it has the way back first, above the heading', async () => {
    isParent.mockReturnValue(false);
    ajax.fetchParticipants.mockResolvedValue([]);
    await new ParentDashboard(makeApp()).init();

    const backLink = page().querySelector('a[href="/dashboard"]');
    expect(backLink).not.toBeNull();
    expect(backLink.compareDocumentPosition(page().querySelector('h1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('an answer arriving after the parent left draws nothing', async () => {
    let resolve;
    ajax.fetchParticipants.mockReturnValue(new Promise((done) => { resolve = done; }));
    const dashboard = new ParentDashboard(makeApp());
    const done = dashboard.init();
    dashboard.destroy();
    page().textContent = 'next screen';

    resolve([]);
    await done;
    expect(page().textContent).toBe('next screen');
  });
});

describe('permission slip opened from an email', () => {
  const SLIP = {
    status: 'pending',
    activity_title: HOSTILE,
    participant_name: `${HOSTILE} Roy`,
    meeting_date: '2099-01-07',
  };

  test('says it is loading, then shows the slip under the way back and a title, names as text', async () => {
    let resolve;
    endpoints.getPublicPermissionSlip.mockReturnValue(new Promise((done) => { resolve = done; }));
    const done = new PermissionSlipSign(makeApp(), 'token').init();
    expect(page().querySelector('[role="status"]').textContent).toBe('loading');

    resolve({ success: true, data: SLIP });
    await done;
    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('h1').textContent).toBe('permission_slip_title');
    expect(page().querySelector('h2').textContent).toBe(HOSTILE);
    expect(page().querySelector('img')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  test('the consent checkbox comes before its label', async () => {
    endpoints.getPublicPermissionSlip.mockResolvedValue({ success: true, data: SLIP });
    await new PermissionSlipSign(makeApp(), 'token').init();

    const checkbox = page().querySelector('#consent-checkbox');
    expect(checkbox.nextElementSibling.matches('label[for="consent-checkbox"]')).toBe(true);
  });

  test('a link to no slip says so', async () => {
    endpoints.getPublicPermissionSlip.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    await new PermissionSlipSign(makeApp(), 'token').init();

    expect(page().textContent).toContain('permission_slip_not_found');
    expect(page().querySelector('#page-retry')).toBeNull();
  });

  test('a slip that could not be fetched is an error with a retry, not "no such slip"', async () => {
    endpoints.getPublicPermissionSlip.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await new PermissionSlipSign(makeApp(), 'token').init();

    expect(alertText()).toBe('permission_slip_load_failed');
    expect(page().textContent).not.toContain('permission_slip_not_found');

    endpoints.getPublicPermissionSlip.mockResolvedValue({ success: true, data: SLIP });
    page().querySelector('#page-retry').click();
    await flush();
    expect(page().querySelector('#sign-btn')).not.toBeNull();
  });

  test('a refused signature says so and leaves the form to try again', async () => {
    endpoints.getPublicPermissionSlip.mockResolvedValue({ success: true, data: SLIP });
    endpoints.signPublicPermissionSlip.mockRejectedValue(Object.assign(new Error('no'), { status: 500 }));
    const app = makeApp();
    await new PermissionSlipSign(app, 'token').init();

    page().querySelector('#guardian-name').value = 'Ana';
    page().querySelector('#guardian-name').dispatchEvent(new Event('input'));
    page().querySelector('#consent-checkbox').click();
    page().querySelector('#sign-btn').click();
    await flush();

    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(page().querySelector('#sign-btn').disabled).toBe(false);
    expect(page().textContent).not.toContain('signature_registered_success');
  });

  test('a signature that went through is confirmed', async () => {
    endpoints.getPublicPermissionSlip.mockResolvedValue({ success: true, data: SLIP });
    endpoints.signPublicPermissionSlip.mockResolvedValue({ success: true });
    await new PermissionSlipSign(makeApp(), 'token').init();

    page().querySelector('#guardian-name').value = HOSTILE;
    page().querySelector('#guardian-name').dispatchEvent(new Event('input'));
    page().querySelector('#consent-checkbox').click();
    page().querySelector('#sign-btn').click();
    await flush();

    expect(page().querySelector('[role="status"]').textContent).toContain('signature_registered_success');
    expect(page().textContent).toContain(HOSTILE);
    expect(page().querySelector('img')).toBeNull();
  });
});

describe('offline preparation', () => {
  test('camps that did not load are an alert with a retry; the date range still works', async () => {
    offlineManager.getUpcomingCamps.mockRejectedValueOnce(new Error('offline'));
    await new OfflinePreparation(makeApp()).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(alertText()).toBe('error_loading_data');
    expect(page().textContent).not.toContain('no_upcoming_camps');
    expect(page().querySelector('#manual-prep-form')).not.toBeNull();
    expect(await violations()).toEqual([]);

    offlineManager.getUpcomingCamps.mockResolvedValue([{
      id: 3, name: HOSTILE, activity_start_date: '2099-07-01', activity_end_date: '2099-07-03',
    }]);
    page().querySelector('#offline-prep-retry').click();
    await flush();
    expect(page().querySelector('.activity-card h3').textContent).toBe(HOSTILE);
    expect(page().querySelector('.activity-card img')).toBeNull();
  });

  test('a wrong date range is said next to the dates, and goes as they change', async () => {
    offlineManager.getUpcomingCamps.mockResolvedValue([]);
    await new OfflinePreparation(makeApp()).init();
    const form = page().querySelector('#manual-prep-form');

    form.querySelector('button[type="submit"]').click();
    await flush();
    const start = form.elements.namedItem('start_date');
    expect(document.getElementById(start.getAttribute('aria-describedby')).textContent).toBe('dates_required');
    expect(start.getAttribute('aria-invalid')).toBe('true');
    expect(offlineManager.prepareForActivity).not.toHaveBeenCalled();

    start.value = '2099-07-01';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('manual-prep-error').textContent).toBe('');
  });
});

describe('communication settings', () => {
  test('Google Chat that could not be read says so with a retry; WhatsApp stays usable', async () => {
    googleChat.getGoogleChatConfig.mockRejectedValueOnce(Object.assign(new Error('no'), { status: 403 }));
    googleChat.getGoogleChatSpaces.mockResolvedValue({ success: true, data: [] });
    await new CommunicationSettings(makeApp()).init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/unit-settings');
    expect(page().textContent).toContain('WhatsApp');
    expect(alertText()).toBeTruthy();
    expect(page().textContent).not.toContain('google_chat_not_configured');
    expect(await violations()).toEqual([]);

    googleChat.getGoogleChatConfig.mockResolvedValue({ success: true, data: { configured: false } });
    page().querySelector('#google-chat-retry').click();
    await flush();
    expect(page().textContent).toContain('google_chat_not_configured');
  });

  test('spaces that did not load are not "no spaces yet"', async () => {
    googleChat.getGoogleChatConfig.mockResolvedValue({ success: true, data: { configured: false } });
    googleChat.getGoogleChatSpaces.mockRejectedValue(new Error('offline'));
    await new CommunicationSettings(makeApp()).init();

    expect(alertText()).toBe('google_chat_spaces_unavailable');
    expect(page().textContent).not.toContain('google_chat_spaces_empty');
  });

  test('a key that is not JSON is said next to the field, and nothing is sent', async () => {
    googleChat.getGoogleChatConfig.mockResolvedValue({ success: true, data: { configured: false } });
    googleChat.getGoogleChatSpaces.mockResolvedValue({ success: true, data: [] });
    await new CommunicationSettings(makeApp()).init();

    const textarea = page().querySelector('#google-chat-credentials');
    textarea.value = 'not json';
    page().querySelector('#google-chat-credentials-form button[type="submit"]').click();
    await flush();

    expect(document.getElementById('google-chat-credentials-error').textContent).toBe('google_chat_credentials_invalid_json');
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(googleChat.saveGoogleChatCredentials).not.toHaveBeenCalled();
  });

  test('a key saved while offline is said to be queued, not saved', async () => {
    googleChat.getGoogleChatConfig.mockResolvedValue({ success: true, data: { configured: false } });
    googleChat.getGoogleChatSpaces.mockResolvedValue({ success: true, data: [] });
    googleChat.saveGoogleChatCredentials.mockResolvedValue({ queued: true });
    const app = makeApp();
    await new CommunicationSettings(app).init();

    page().querySelector('#google-chat-credentials').value = '{"type":"service_account"}';
    page().querySelector('#google-chat-credentials-form button[type="submit"]').click();
    await flush();

    expect(googleChat.saveGoogleChatCredentials).toHaveBeenCalledWith({ type: 'service_account' });
    expect(app.showMessage).toHaveBeenCalledWith('offline.savedLocally', 'info');
    expect(app.showMessage).not.toHaveBeenCalledWith('google_chat_credentials_saved', 'success');
  });
});
