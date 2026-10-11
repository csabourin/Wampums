/**
 * @jest-environment jsdom
 */

/**
 * Permission slips say what they send, and when.
 *
 * "Create and send" emails the new slips' parents at once, after a
 * confirmation naming how many; "Create without sending" contacts no one.
 * A leader can email themselves a test of the parents' email first.
 *
 * @module test/spa/PermissionSlipSending
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { DEFAULT_LANG: 'fr', TIME_FORMAT: { DEFAULT: '24h' }, STORAGE_KEYS: {} },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getPermissionSlips: jest.fn(),
  savePermissionSlip: jest.fn(),
  signPermissionSlip: jest.fn(),
  sendPermissionSlipEmails: jest.fn(),
  sendPermissionSlipReminders: jest.fn(),
  sendPermissionSlipTestEmail: jest.fn(),
  getResourceDashboard: jest.fn(),
  archivePermissionSlip: jest.fn(),
  getGroups: jest.fn(),
  getParticipants: jest.fn(),
}));
jest.mock('../../spa/api/api-activities.js', () => ({
  getActivity: jest.fn(),
  deleteActivity: jest.fn(),
  getActivitiesWithPermissionSlips: jest.fn(),
}));
jest.mock('../../spa/ajax-functions.js', () => ({
  fetchParticipants: jest.fn(),
  getCurrentOrganizationId: () => 3,
}));
jest.mock('../../spa/indexedDB.js', () => ({
  clearActivityPermissionSlipCaches: jest.fn(() => Promise.resolve()),
  deleteCachedData: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirm: jest.fn(() => Promise.resolve(true)),
  confirmDestructive: jest.fn(() => Promise.resolve(true)),
  prompt: jest.fn(),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true) }));
jest.mock('../../spa/utils/PerformanceUtils.js', () => ({ withButtonLoading: (_button, fn) => fn() }));
jest.mock('../../spa/modules/modals/QuickCreateActivityModal.js', () => ({ QuickCreateActivityModal: jest.fn() }));
jest.mock('../../spa/modules/activities/ActivityFormModal.js', () => ({ openActivityFormModal: jest.fn() }));

const endpoints = require('../../spa/api/api-endpoints.js');
const { getActivity } = require('../../spa/api/api-activities.js');
const { fetchParticipants } = require('../../spa/ajax-functions.js');
const { confirm } = require('../../spa/utils/DialogUtils.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
const { PermissionSlipDashboard } = require('../../spa/permission_slip_dashboard.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const ACTIVITY = {
  id: 12, name: 'Sortie canot', invites_everyone: true,
  activity_start_date: '2026-11-07', activity_end_date: '2026-11-07',
};
const PARTICIPANTS = [
  { id: 1, first_name: 'Alice', last_name: 'A', date_naissance: '2015-01-01' },
  { id: 2, first_name: 'Bob', last_name: 'B', date_naissance: '2015-01-01' },
];

let app;

/**
 * Open the activity's slip page with the create form shown, everyone chosen.
 * @returns {Promise<PermissionSlipDashboard>}
 */
async function openCreateForm() {
  document.body.innerHTML = '<main id="app"></main>';
  getActivity.mockResolvedValue(ACTIVITY);
  endpoints.getPermissionSlips.mockResolvedValue({ data: { permission_slips: [] } });
  endpoints.getResourceDashboard.mockResolvedValue({ data: { permission_summary: [] } });
  endpoints.getGroups.mockResolvedValue({ data: [] });
  fetchParticipants.mockResolvedValue(PARTICIPANTS);
  endpoints.savePermissionSlip.mockResolvedValue({ data: { permission_slips: [], answered_participant_ids: [] } });
  endpoints.sendPermissionSlipEmails.mockResolvedValue({ data: { sent: 3, total: 2, failed: [] } });
  endpoints.sendPermissionSlipTestEmail.mockResolvedValue({ data: { email: 'akela@unit.test' } });

  const dashboard = new PermissionSlipDashboard(app, { activityId: 12 });
  await dashboard.init();
  document.getElementById('toggleCreateFormBtn').click();
  const select = document.getElementById('groupSelect');
  select.value = 'all';
  select.dispatchEvent(new Event('change'));
  return dashboard;
}

/**
 * Submit the create form with one of its buttons.
 * @param {string} intent - 'send' or 'create'
 */
async function submitWith(intent) {
  const form = document.getElementById('permissionSlipForm');
  const button = form.querySelector(`button[value="${intent}"]`);
  const event = new Event('submit', { cancelable: true });
  Object.defineProperty(event, 'submitter', { value: button });
  form.dispatchEvent(event);
  await flush();
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  hasPermission.mockReturnValue(true);
  confirm.mockResolvedValue(true);
  app = { lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } };
});

test('the toggle opens a form whose buttons say whether they send', async () => {
  await openCreateForm();

  expect(document.getElementById('toggleCreateFormBtn').getAttribute('aria-expanded')).toBe('true');
  const send = document.querySelector('#permissionSlipForm button[value="send"]');
  const create = document.querySelector('#permissionSlipForm button[value="create"]');
  expect(send.textContent.trim()).toBe('permission_slip_create_and_send');
  expect(create.textContent.trim()).toBe('permission_slip_create_only');
  expect(send.getAttribute('aria-describedby')).toBe('permission-slip-send-explainer');
  expect(document.getElementById('permission-slip-send-explainer').textContent).toBe('permission_slip_send_explainer');
});

test('"create and send" confirms, saves, then emails only the new slips', async () => {
  await openCreateForm();
  await submitWith('send');

  expect(confirm).toHaveBeenCalledWith('permission_slip_create_send_confirm');
  expect(endpoints.savePermissionSlip).toHaveBeenCalledWith(expect.objectContaining({ activity_id: 12, participant_ids: [1, 2] }));
  expect(endpoints.sendPermissionSlipEmails).toHaveBeenCalledWith({ activity_id: 12, participant_ids: [1, 2] });
  expect(app.showMessage).toHaveBeenCalledWith('permission_slip_created_and_sent', 'success');
});

test('declining the confirmation creates and sends nothing', async () => {
  await openCreateForm();
  confirm.mockResolvedValueOnce(false);
  await submitWith('send');

  expect(endpoints.savePermissionSlip).not.toHaveBeenCalled();
  expect(endpoints.sendPermissionSlipEmails).not.toHaveBeenCalled();
});

test('a slip already answered is kept and not sent again', async () => {
  await openCreateForm();
  endpoints.savePermissionSlip.mockResolvedValueOnce({ data: { permission_slips: [], answered_participant_ids: [2] } });
  await submitWith('send');

  expect(endpoints.sendPermissionSlipEmails).toHaveBeenCalledWith({ activity_id: 12, participant_ids: [1] });
});

test('children without a parent email are reported', async () => {
  await openCreateForm();
  endpoints.sendPermissionSlipEmails.mockResolvedValueOnce({
    data: { sent: 1, total: 2, failed: [{ participant_id: 2, reason: 'No guardian or parent email addresses found' }] },
  });
  await submitWith('send');

  expect(app.showMessage).toHaveBeenCalledWith(
    'permission_slip_created_and_sent permission_slip_sent_missing_emails', 'warning',
  );
});

test('"create without sending" saves and contacts no one', async () => {
  await openCreateForm();
  await submitWith('create');

  expect(confirm).not.toHaveBeenCalled();
  expect(endpoints.savePermissionSlip).toHaveBeenCalled();
  expect(endpoints.sendPermissionSlipEmails).not.toHaveBeenCalled();
  expect(app.showMessage).toHaveBeenCalledWith('permission_slip_created_not_sent', 'success');
});

test('without the right to write to families, only "create without sending" is offered', async () => {
  hasPermission.mockImplementation((key) => key !== 'communications.send');
  await openCreateForm();

  expect(document.querySelector('#permissionSlipForm button[value="send"]')).toBeNull();
  expect(document.querySelector('#permissionSlipForm .btn-send-test')).toBeNull();
  expect(document.getElementById('permission-slip-send-explainer').textContent)
    .toBe('permission_slip_send_explainer_create_only');
});

test('"send me a test" emails the leader the slip with the chosen deadline', async () => {
  await openCreateForm();
  document.querySelector('#permissionSlipForm input[name="deadline_date"]').value = '2026-11-01';
  document.querySelector('#permissionSlipForm .btn-send-test').click();
  await flush();

  expect(endpoints.sendPermissionSlipTestEmail).toHaveBeenCalledWith({
    activity_id: 12, reminder: false, deadline_date: '2026-11-01',
  });
  expect(endpoints.savePermissionSlip).not.toHaveBeenCalled();
  expect(app.showMessage).toHaveBeenCalledWith('test_email_sent', 'success');
});

test('the create form has no WCAG A/AA violations', async () => {
  await openCreateForm();
  const results = await axe.run(document.getElementById('permissionSlipForm'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});
