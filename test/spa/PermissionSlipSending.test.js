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
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true), canFollowPermissionSlips: jest.fn(() => true) }));
jest.mock('../../spa/utils/PerformanceUtils.js', () => ({ withButtonLoading: (_button, fn) => fn() }));
jest.mock('../../spa/modules/modals/QuickCreateActivityModal.js', () => ({ QuickCreateActivityModal: jest.fn() }));
jest.mock('../../spa/api/api-activity-authorizations.js', () => ({ getActivityAuthorizations: jest.fn(() => Promise.resolve({ state: 'not_created', participants: 2, requests: 0, to_create: 2, addresses: 3, sent: 0, failed: 0, unknown: 0, unsent: 3, missing: [], problems: [], signed: 0, declined: 0, pending: 0 })), sendActivityAuthorizations: jest.fn() }));
jest.mock('../../spa/modules/activities/ActivityFormModal.js', () => ({ openActivityFormModal: jest.fn() }));

const endpoints = require('../../spa/api/api-endpoints.js');
const { getActivity } = require('../../spa/api/api-activities.js');
const { fetchParticipants } = require('../../spa/ajax-functions.js');
const { confirm } = require('../../spa/utils/DialogUtils.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
const { PermissionSlipDashboard } = require('../../spa/modules/permission-slips/PermissionSlipDashboard.js');

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
  endpoints.savePermissionSlip.mockImplementation(({ participant_ids: ids }) => Promise.resolve({
    data: { permission_slips: ids.map((id) => ({ id: 100 + id, participant_id: id, email_sent: false })), answered_participant_ids: [] },
  }));
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

test.each([
  ['no activities', []],
  ['only past activities', [{
    id: 24, name: 'Sortie fictive passée',
    activity_start_date: '2000-01-01', activity_end_date: '2000-01-01',
  }]],
])('the dashboard with %s offers one creation action that opens the activity form', (_label, activities) => {
  document.body.innerHTML = '<main id="app"></main>';
  const { QuickCreateActivityModal } = require('../../spa/modules/modals/QuickCreateActivityModal.js');
  const ActualModal = jest.requireActual('../../spa/modules/modals/QuickCreateActivityModal.js').QuickCreateActivityModal;
  const { openActivityFormModal } = require('../../spa/modules/activities/ActivityFormModal.js');
  QuickCreateActivityModal.mockImplementationOnce((...args) => new ActualModal(...args));

  const dashboard = new PermissionSlipDashboard(app);
  dashboard.activities = activities;
  dashboard.render();
  dashboard.attachEventHandlers();

  const createButtons = Array.from(document.querySelectorAll('#app button'))
    .filter((button) => button.textContent.includes('quick_create_activity'));
  expect(createButtons).toHaveLength(1);
  expect(document.getElementById('app').textContent).toContain('no_upcoming_activities');
  createButtons[0].click();
  expect(openActivityFormModal).toHaveBeenCalledTimes(1);
  expect(openActivityFormModal).toHaveBeenCalledWith(app, expect.objectContaining({ defaultAuthorization: true }));

  if (activities.length > 0) {
    const pastActivities = document.querySelector('#app details');
    expect(pastActivities.querySelector('summary').textContent).toContain('past_activities');
    pastActivities.querySelector('summary').click();
    expect(pastActivities.open).toBe(true);
    expect(pastActivities.querySelector('a').getAttribute('href')).toBe('/permission-slips/24');
    expect(pastActivities.textContent).toContain(activities[0].name);
  }
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
  expect(endpoints.sendPermissionSlipEmails).toHaveBeenCalledWith({ activity_id: 12, slip_ids: [101, 102] });
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
  endpoints.savePermissionSlip.mockResolvedValueOnce({
    data: { permission_slips: [{ id: 101, participant_id: 1, email_sent: false }], answered_participant_ids: [2] },
  });
  await submitWith('send');

  expect(endpoints.sendPermissionSlipEmails).toHaveBeenCalledWith({ activity_id: 12, slip_ids: [101] });
});

test('a pending slip already emailed is not resent, and the leader is told to remind', async () => {
  await openCreateForm();
  endpoints.savePermissionSlip.mockResolvedValueOnce({ data: {
    permission_slips: [{ id: 101, participant_id: 1, email_sent: false }, { id: 102, participant_id: 2, email_sent: true }],
    answered_participant_ids: [],
  } });
  endpoints.sendPermissionSlipEmails.mockResolvedValueOnce({ data: { sent: 1, total: 1, failed: [] } });
  await submitWith('send');

  expect(endpoints.sendPermissionSlipEmails).toHaveBeenCalledWith({ activity_id: 12, slip_ids: [101] });
  expect(app.showMessage).toHaveBeenCalledWith(
    'permission_slip_created_and_sent permission_slip_already_sent_kept', 'warning',
  );
});

test('when every chosen slip was already emailed, nothing is sent and the leader is told', async () => {
  await openCreateForm();
  endpoints.savePermissionSlip.mockResolvedValueOnce({ data: {
    permission_slips: [{ id: 101, participant_id: 1, email_sent: true }, { id: 102, participant_id: 2, email_sent: true }],
    answered_participant_ids: [],
  } });
  await submitWith('send');

  expect(endpoints.sendPermissionSlipEmails).not.toHaveBeenCalled();
  expect(app.showMessage).toHaveBeenCalledWith('permission_slip_already_sent_kept', 'warning');
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

test('emails the email service refused are reported, as an error when none went out', async () => {
  await openCreateForm();
  endpoints.sendPermissionSlipEmails.mockResolvedValueOnce({
    data: { sent: 0, total: 2, failed: [
      { participant_id: 1, email: 'a@home.test', reason: 'Email send failed' },
      { participant_id: 2, email: 'b@home.test', reason: 'Email send failed' },
    ] },
  });
  await submitWith('send');

  expect(app.showMessage).toHaveBeenCalledWith(
    'permission_slip_created_and_sent permission_slip_send_undelivered', 'error',
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

test('the deadline is labelled once, and an unsent slip\'s delete button is a danger button', async () => {
  await openCreateForm();
  expect(document.querySelector('#permissionSlipForm input[name="deadline_date"]').closest('label').textContent.trim())
    .toBe('deadline_date_label');

  endpoints.getPermissionSlips.mockResolvedValue({ data: { permission_slips: [{
    id: 5, participant_id: 1, first_name: 'Alice', last_name: 'A', activity_title: 'Sortie canot',
    meeting_date: '2026-11-07', deadline_date: '2026-11-01', status: 'pending', email_sent: false,
  }] } });
  const dashboard = new PermissionSlipDashboard(app, { activityId: 12 });
  await dashboard.init();
  const remove = document.querySelector('.delete-slip');
  expect(remove.classList.contains('button--danger')).toBe(true);
  expect(remove.getAttribute('style')).toBeNull();
  expect(document.querySelector('.activity-group').textContent).toContain('permission_slip_deadline');

  document.querySelector('.activity-group .btn-send-test[data-reminder="true"]').click();
  await flush();
  expect(endpoints.sendPermissionSlipTestEmail).toHaveBeenLastCalledWith({ activity_id: 12, reminder: true, slip_id: 5 });
  const results = await axe.run(document.querySelector('.activity-group'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});

test('slips with different deadlines are listed, and tested, as separate groups', async () => {
  await openCreateForm();
  endpoints.getPermissionSlips.mockResolvedValue({ data: { permission_slips: [
    { id: 5, participant_id: 1, first_name: 'Alice', last_name: 'A', activity_title: 'Sortie canot',
      meeting_date: '2026-11-07', deadline_date: '2026-11-01', status: 'pending', email_sent: true },
    { id: 6, participant_id: 2, first_name: 'Bob', last_name: 'B', activity_title: 'Sortie canot',
      meeting_date: '2026-11-07', deadline_date: '2026-11-04', status: 'pending', email_sent: true },
  ] } });
  const dashboard = new PermissionSlipDashboard(app, { activityId: 12 });
  await dashboard.init();

  const groups = document.querySelectorAll('.activity-group');
  expect(groups).toHaveLength(2);
  const ids = [...groups].map((group) => group.querySelector('.btn-send-test[data-reminder="true"]').dataset.slipId);
  expect(ids.sort()).toEqual(['5', '6']);

  endpoints.sendPermissionSlipReminders.mockResolvedValue({ data: { sent: 1, total: 1 } });
  groups[1].querySelector('.btn-send-reminders').click();
  await flush();
  await flush();
  const reminded = endpoints.sendPermissionSlipReminders.mock.calls[0][0];
  expect(reminded.activity_id).toBe(12);
  expect(reminded.slip_ids).toHaveLength(1);
  expect([5, 6]).toContain(reminded.slip_ids[0]);

  endpoints.sendPermissionSlipEmails.mockClear();
  groups[0].querySelector('.btn-send-emails').click();
  await flush();
  await flush();
  expect(endpoints.sendPermissionSlipEmails.mock.calls[0][0].slip_ids).toHaveLength(1);
  expect(endpoints.sendPermissionSlipEmails.mock.calls[0][0].slip_ids[0])
    .not.toBe(reminded.slip_ids[0]);
});

test('a group of slips not saved yet offers no send or reminder, and never sends activity-wide', async () => {
  await openCreateForm();
  let finishSave;
  endpoints.savePermissionSlip.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
  const form = document.getElementById('permissionSlipForm');
  const event = new Event('submit', { cancelable: true });
  Object.defineProperty(event, 'submitter', { value: form.querySelector('button[value="create"]') });
  form.dispatchEvent(event);
  await flush();

  const group = document.querySelector('.activity-group');
  expect(group).not.toBeNull();
  expect(group.querySelector('.btn-send-emails')).toBeNull();
  expect(group.querySelector('.btn-send-reminders')).toBeNull();

  const dashboard = new PermissionSlipDashboard(app, { activityId: 12 });
  const result = await dashboard.sendToGroup(endpoints.sendPermissionSlipEmails, '2026-11-07', 'Sortie canot', []);
  expect(result.data).toEqual({ sent: 0, total: 0 });
  expect(endpoints.sendPermissionSlipEmails).not.toHaveBeenCalled();
  finishSave({ data: { permission_slips: [], answered_participant_ids: [] } });
  await flush();
});

test('the create form has no WCAG A/AA violations', async () => {
  await openCreateForm();
  const results = await axe.run(document.getElementById('permissionSlipForm'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});

describe('leaders and signing', () => {
  const slip = (id, firstName, isOwnChild) => ({
    id, participant_id: id, first_name: firstName, last_name: 'T', status: 'pending', email_sent: true,
    activity_id: 12, activity_title: 'Sortie canot', meeting_date: '2026-11-07', is_own_child: isOwnChild,
  });

  async function openSlipList(slips) {
    document.body.innerHTML = '<main id="app"></main>';
    getActivity.mockResolvedValue(ACTIVITY);
    endpoints.getPermissionSlips.mockResolvedValue({ data: { permission_slips: slips } });
    endpoints.getResourceDashboard.mockResolvedValue({ data: { permission_summary: [] } });
    endpoints.getGroups.mockResolvedValue({ data: [] });
    fetchParticipants.mockResolvedValue(PARTICIPANTS);
    const dashboard = new PermissionSlipDashboard(app, { activityId: 12 });
    await dashboard.init();
    return document.getElementById('app');
  }

  test('a leader is offered to sign only the slips of their own children', async () => {
    const root = await openSlipList([slip(1, 'Alice', false), slip(2, 'Bob', true)]);

    const signButtons = [...root.querySelectorAll('.sign-slip')];
    expect(signButtons).toHaveLength(1);
    expect(signButtons[0].closest('tr').textContent).toContain('Bob');
    expect(signButtons[0].getAttribute('type')).toBe('button');
    expect(root.querySelector('tr[data-slip-id="1"] .sign-slip')).toBeNull();
  });

  test('a slip with no answer about the viewer\'s own children offers no signature', async () => {
    const root = await openSlipList([{ ...slip(1, 'Alice', undefined) }]);
    expect(root.querySelector('.sign-slip')).toBeNull();
  });

  test('the slip list with a sign button has no accessibility violations', async () => {
    const root = await openSlipList([slip(1, 'Alice', false), slip(2, 'Bob', true)]);
    const results = await axe.run(root, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  test('after sending, the leader is told the other leaders received a copy', async () => {
    await openCreateForm();
    endpoints.sendPermissionSlipEmails.mockResolvedValueOnce({ data: { sent: 2, total: 2, failed: [], leader_copies_sent: 4 } });
    await submitWith('send');

    const [message, type] = app.showMessage.mock.calls.at(-1);
    expect(message).toContain('permission_slip_leader_copies_sent');
    expect(type).toBe('success');
  });
});

describe('a load that fails', () => {
  /**
   * Open the activity's slip page while the groups request is refused.
   * @param {Object} error - What the API layer throws
   * @returns {Promise<PermissionSlipDashboard>}
   */
  async function openRefused(error) {
    document.body.innerHTML = '<main id="app"></main>';
    getActivity.mockResolvedValue(ACTIVITY);
    endpoints.getPermissionSlips.mockResolvedValue({ data: { permission_slips: [] } });
    endpoints.getResourceDashboard.mockResolvedValue({ data: { permission_summary: [] } });
    endpoints.getGroups.mockRejectedValue(error);
    fetchParticipants.mockResolvedValue(PARTICIPANTS);
    const dashboard = new PermissionSlipDashboard(app, { activityId: 12 });
    await dashboard.init();
    return dashboard;
  }

  test('says so in the page, as a refusal, with a way back and a retry, instead of a blank screen', async () => {
    await openRefused(Object.assign(new Error('Insufficient permissions'), { status: 403 }));

    expect(document.querySelector('#app h1').textContent).toBe('permission_slip_dashboard_title');
    expect(document.querySelector('[role="alert"]').textContent).toBe('api_error_forbidden');
    expect(document.querySelector('#app a').getAttribute('href')).toBe('/permission-slips');
    expect(document.body.textContent).not.toContain('Insufficient permissions');
  });

  test('retry loads the page again', async () => {
    await openRefused(Object.assign(new Error('offline'), { status: 503 }));
    endpoints.getGroups.mockResolvedValue({ data: [] });

    document.getElementById('permission-slips-retry').click();
    await flush();
    await flush();

    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.getElementById('toggleCreateFormBtn')).not.toBeNull();
  });

  test('a failure arriving after the person left draws nothing over the next screen', async () => {
    document.body.innerHTML = '<main id="app"></main>';
    let refuse;
    getActivity.mockResolvedValue(ACTIVITY);
    endpoints.getPermissionSlips.mockResolvedValue({ data: { permission_slips: [] } });
    endpoints.getResourceDashboard.mockResolvedValue({ data: { permission_summary: [] } });
    endpoints.getGroups.mockReturnValue(new Promise((_resolve, reject) => { refuse = reject; }));
    fetchParticipants.mockResolvedValue(PARTICIPANTS);
    const dashboard = new PermissionSlipDashboard(app, { activityId: 12 });
    const loading = dashboard.init();

    dashboard.destroy();
    document.getElementById('app').innerHTML = '<h1>Next screen</h1>';
    refuse(Object.assign(new Error('late'), { status: 500 }));
    await loading;

    expect(document.querySelector('#app h1').textContent).toBe('Next screen');
  });

  test('the error state has no WCAG A/AA violations', async () => {
    await openRefused(Object.assign(new Error('Insufficient permissions'), { status: 403 }));
    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
