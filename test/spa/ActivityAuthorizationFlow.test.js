/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/config.js', () => ({ CONFIG: { AUTHORIZATION_FLOW: { PREVIEW_DELAY_MS: 1 } }, getStorageKey: (key) => key }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugError: jest.fn(), debugLog: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/api/api-activities.js', () => ({ createActivity: jest.fn(), updateActivity: jest.fn(), getActivity: jest.fn() }));
jest.mock('../../spa/api/api-activity-authorizations.js', () => ({ previewActivityAuthorizations: jest.fn(), sendActivityAuthorizations: jest.fn(), getActivityAuthorizations: jest.fn() }));
jest.mock('../../spa/ajax-functions.js', () => ({ fetchParticipants: jest.fn().mockResolvedValue([]), getCurrentOrganizationId: () => 3 }));
jest.mock('../../spa/api/api-endpoints.js', () => ({ getGroups: jest.fn().mockResolvedValue({ data: [] }) }));
jest.mock('../../spa/api/api-ai.js', () => ({ aiGenerateText: jest.fn() }));
jest.mock('../../spa/indexedDB.js', () => ({ clearActivityRelatedCaches: jest.fn(), clearActivityPermissionSlipCaches: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasOrganizationScope: jest.fn(() => true), hasPermission: jest.fn(() => true), canFollowPermissionSlips: jest.fn(() => true) }));

import { createActivity, updateActivity } from '../../spa/api/api-activities.js';
import { previewActivityAuthorizations, sendActivityAuthorizations, getActivityAuthorizations } from '../../spa/api/api-activity-authorizations.js';
import { hasOrganizationScope, hasPermission, canFollowPermissionSlips } from '../../spa/utils/PermissionUtils.js';
import { openActivityFormModal } from '../../spa/modules/activities/ActivityFormModal.js';
import { ActivityAuthorizationPanel } from '../../spa/modules/activities/ActivityAuthorizationPanel.js';

const RESULT = { state: 'sent', participants: 2, requests: 2, to_create: 0, addresses: 3, sent: 3, failed: 0, unknown: 0, unsent: 0, missing: [], problems: [], signed: 0, declined: 0, pending: 2 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let handle;
let app;
function open(options = {}) {
  handle = openActivityFormModal(app, { defaultAuthorization: true, ...options });
  const root = document.getElementById('activity-modal');
  for (const [id, value] of Object.entries({
    'activity-name': 'Lantern evening', 'activity-start-date': '2026-11-20', 'activity-end-date': '2026-11-20',
    'activity-start-time': '18:30', 'activity-end-time': '20:30', 'meeting-location-going': 'Fictional hall',
    'activity-authorization-text': 'I agree to the outing.',
  })) {root.querySelector(`#${id}`).value = value;}
  return root;
}
async function submit(root, intent) {
  const event = new Event('submit', { cancelable: true });
  Object.defineProperty(event, 'submitter', { value: root.querySelector(`[value="${intent}"]`) });
  root.querySelector('form').dispatchEvent(event);
  await flush(); await flush();
}
beforeEach(() => {
  jest.clearAllMocks();
  app = { lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } };
  hasOrganizationScope.mockReturnValue(true);
  hasPermission.mockReturnValue(true);
  canFollowPermissionSlips.mockReturnValue(true);
  previewActivityAuthorizations.mockResolvedValue({ participants: 2, addresses: 3, missing: [] });
  createActivity.mockResolvedValue({ id: 44 });
  updateActivity.mockResolvedValue({ id: 44 });
  sendActivityAuthorizations.mockResolvedValue(RESULT);
  getActivityAuthorizations.mockResolvedValue(RESULT);
});
afterEach(() => {handle?.close(true); document.body.textContent = '';});

test('one form saves the activity and sends requests for the same invitation', async () => {
  const root = open();
  expect(root.querySelector('#activity-authorization-required').checked).toBe(true);
  expect(root.querySelector('#meeting-location-going').closest('[hidden]')).toBeNull();
  expect(root.querySelector('#activity-transport-fields').hidden).toBe(true);
  expect(root.querySelector('#groupSelect')).toBeNull();
  await submit(root, 'send');
  expect(createActivity).toHaveBeenCalledWith(expect.objectContaining({
    authorization_required: true, invites_everyone: true, transport_required: false,
    authorization_text: 'I agree to the outing.', creation_key: expect.any(String), meeting_time_going: '18:30', departure_time_going: '18:30',
  }));
  expect(sendActivityAuthorizations).toHaveBeenCalledWith(44, '');
  expect(app.router.navigate).toHaveBeenCalledWith('/permission-slips/44');
});

test('save without sending retains the permission text but creates no requests or email', async () => {
  await submit(open(), 'save');
  expect(createActivity).toHaveBeenCalledTimes(1);
  expect(sendActivityAuthorizations).not.toHaveBeenCalled();
  expect(app.showMessage).toHaveBeenCalledWith(expect.stringContaining('authorization_saved_not_sent'), 'success');
});

test('a double submit while the save is pending creates one activity', async () => {
  let resolveSave;
  createActivity.mockImplementationOnce(() => new Promise((resolve) => {resolveSave = resolve;}));
  const root = open();
  await submit(root, 'send');
  await submit(root, 'send');
  expect(createActivity).toHaveBeenCalledTimes(1);
  resolveSave({ id: 44 }); await flush(); await flush();
  expect(sendActivityAuthorizations).toHaveBeenCalledTimes(1);
});

test('a failed send preserves the text and a retry updates the saved activity instead of creating another', async () => {
  const root = open();
  sendActivityAuthorizations.mockRejectedValueOnce(new TypeError('lost response'));
  await submit(root, 'send');
  expect(root.querySelector('#activity-authorization-text').value).toBe('I agree to the outing.');
  expect(root.querySelector('#activity-save-result').contains(document.activeElement)).toBe(true);
  expect(root.querySelector('#activity-save-result a').getAttribute('href')).toBe('/permission-slips/44');
  await submit(root, 'send');
  expect(createActivity).toHaveBeenCalledTimes(1);
  expect(updateActivity).toHaveBeenCalledWith(44, expect.any(Object));
});

test('an uncertain creation response reuses the same creation key', async () => {
  createActivity.mockRejectedValueOnce(new TypeError('response lost'));
  const root = open();
  await submit(root, 'save');
  await submit(root, 'save');
  expect(createActivity.mock.calls[0][0].creation_key).toBe(createActivity.mock.calls[1][0].creation_key);
});

test('partial sending leaves a persistent focused result with the form intact', async () => {
  sendActivityAuthorizations.mockResolvedValueOnce({ ...RESULT, state: 'incomplete', sent: 2, failed: 1 });
  const root = open();
  await submit(root, 'send');
  expect(root.querySelector('#activity-save-result').textContent).toContain('authorization_state_incomplete');
  expect(root.querySelector('#activity-save-result')).toBe(document.activeElement);
  expect(root.querySelector('#activity-name').value).toBe('Lantern evening');
  expect(app.router.navigate).not.toHaveBeenCalled();
});

test('the preview displays the email and consent text without saving or sending', () => {
  const root = open();
  root.querySelector('#activity-authorization-preview').click();
  const preview = document.getElementById('activity-authorization-preview-modal');
  expect(preview.textContent).toContain('Lantern evening');
  expect(preview.textContent).toContain('I agree to the outing.');
  expect(createActivity).not.toHaveBeenCalled();
  expect(sendActivityAuthorizations).not.toHaveBeenCalled();
  preview.querySelector('[data-modal-close]').click();
});

test('editors without mailing rights are offered saving only', () => {
  hasPermission.mockImplementation((key) => key !== 'communications.send');
  const root = open();
  expect(root.querySelector('[data-activity-send]').hidden).toBe(true);
});

test('the activity and permission form has no WCAG A or AA violations', async () => {
  const root = open();
  expect((await axe.run(root, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
});

test('the activity panel restores the saved result on load and retry sends only through the server workflow', async () => {
  document.body.innerHTML = '<main><section id="panel"></section></main>';
  const root = document.getElementById('panel');
  getActivityAuthorizations.mockResolvedValueOnce({ ...RESULT, state: 'incomplete', sent: 2, failed: 1 });
  const panel = new ActivityAuthorizationPanel(app, root, { id: 44 });
  await panel.load();
  expect(root.textContent).toContain('authorization_state_incomplete');
  await panel.send();
  expect(sendActivityAuthorizations).toHaveBeenCalledWith(44, undefined);
  expect(root.textContent).toContain('authorization_state_sent');
  panel.destroy();
});

test('a late result never overwrites the next screen', async () => {
  document.body.innerHTML = '<main><section id="panel"></section></main>';
  const root = document.getElementById('panel');
  let finish;
  getActivityAuthorizations.mockImplementationOnce(() => new Promise((resolve) => {finish = resolve;}));
  const panel = new ActivityAuthorizationPanel(app, root, { id: 44 });
  const loading = panel.load();
  panel.destroy();
  root.textContent = 'Next screen';
  finish(RESULT); await loading;
  expect(root.textContent).toBe('Next screen');
});


test('finishing the consent text does not disable the send button during its click', async () => {
  const root = open();
  await flush(); await flush();
  const send = root.querySelector('[data-activity-send]');
  expect(send.disabled).toBe(false);
  root.querySelector('#activity-authorization-text').dispatchEvent(new Event('change', { bubbles: true }));
  expect(send.disabled).toBe(false);
  await submit(root, 'send');
  expect(sendActivityAuthorizations).toHaveBeenCalledTimes(1);
});


test('leaders without the full roster dashboard keep a successful sending result inside the activity form', async () => {
  canFollowPermissionSlips.mockReturnValue(false);
  const root = open();
  await submit(root, 'send');
  expect(root.querySelector('#activity-save-result').textContent).toContain('authorization_state_sent');
  expect(root.querySelector('#activity-save-result a')).toBeNull();
  expect(app.router.navigate).not.toHaveBeenCalled();
});

test('a restricted editor reopens the durable result inside the activity form', async () => {
  canFollowPermissionSlips.mockReturnValue(false);
  const root = open({ activity: { id: 44, authorization_required: true, name: 'Lantern evening' } });
  await flush(); await flush();
  expect(getActivityAuthorizations).toHaveBeenCalledWith(44);
  expect(root.querySelector('#activity-save-result').textContent).toContain('authorization_state_sent');
  expect(root.querySelector('#activity-save-result a')).toBeNull();
});


test('the implicit submit action saves without sending', () => {
  const root = open();
  expect(root.querySelector('button[type="submit"]').value).toBe('save');
});


test('creating an activity can save and open its packing editor without sending authorizations', async () => {
  const root = open();
  expect(root.querySelector('[value="packing"]')).not.toBeNull();
  await submit(root, 'packing');
  expect(createActivity).toHaveBeenCalledTimes(1);
  expect(sendActivityAuthorizations).not.toHaveBeenCalled();
  expect(app.router.navigate).toHaveBeenCalledWith('/personal-equipment/activity-44/manage');
});

test('the packing action is hidden without its management permission or organization scope', () => {
  hasPermission.mockImplementation((key) => key !== 'personal_equipment.manage');
  expect(open().querySelector('[value="packing"]')).toBeNull();
  handle.close(true);
  hasPermission.mockReturnValue(true); hasOrganizationScope.mockReturnValue(false);
  expect(open().querySelector('[value="packing"]')).toBeNull();
});
