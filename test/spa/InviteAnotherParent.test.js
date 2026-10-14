/**
 * @jest-environment jsdom
 *
 * Linking youth to parents: an administrator invites another parent for a
 * child by email, beside the parents the child already has.
 */
import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key, app: { lang: 'fr' } }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/ajax-functions.js', () => ({
  getParticipantsWithUsers: jest.fn(),
  getParentUsers: jest.fn(),
  removeParticipantFromOrganization: jest.fn(),
  associateUser: jest.fn(),
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  eraseParticipant: jest.fn(),
  unlinkParticipantUser: jest.fn(),
}));
const mockPermissions = new Set();
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewUsers: () => true,
  hasPermission: (key) => mockPermissions.has(key),
}));
jest.mock('../../spa/api/api-walk-in.js', () => ({ inviteAnotherParent: jest.fn() }));

const { getParticipantsWithUsers, getParentUsers } = require('../../spa/ajax-functions.js');
const { inviteAnotherParent } = require('../../spa/api/api-walk-in.js');
const { ManageUsersParticipants } = require('../../spa/modules/participants/ManageUsersParticipants.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE_NAME = '<img src=x onerror=alert(1)>';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let app;

async function renderPage() {
  document.body.innerHTML = '<main id="app"></main>';
  await new ManageUsersParticipants(app).init();
  return document.getElementById('app');
}

function openDialog(root) {
  root.querySelector('.invite-another-parent').click();
  return document.querySelector('.modal-dialog');
}

async function submit(email) {
  const input = document.getElementById('invite-another-parent-email');
  input.value = email;
  document.getElementById('invite-another-parent-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions.clear();
  mockPermissions.add('participants.edit');
  mockPermissions.add('users.invite');
  app = { lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } };
  getParticipantsWithUsers.mockResolvedValue({
    success: true,
    data: [{ id: 7, first_name: HOSTILE_NAME, last_name: 'Roy', associated_users: 'Julie Roy' }],
  });
  getParentUsers.mockResolvedValue({ success: true, data: [] });
});

afterEach(() => {
  document.querySelectorAll('.modal-overlay').forEach((overlay) => overlay.remove());
});

test('each child offers to invite another parent, to those who may link and invite', async () => {
  const root = await renderPage();
  expect(root.querySelector('.invite-another-parent').textContent.trim()).toBe('invite_another_parent');

  mockPermissions.delete('users.invite');
  const withoutInvite = await renderPage();
  expect(withoutInvite.querySelector('.invite-another-parent')).toBeNull();
});

test('the dialog names the child as text, with a labelled address field, and moves focus into it', async () => {
  const root = await renderPage();
  const dialog = openDialog(root);

  expect(dialog.querySelector('img')).toBeNull();
  expect(dialog.textContent).toContain('invite_another_parent_title');
  expect(document.querySelector('label[for="invite-another-parent-email"]').textContent).toBe('email');
  expect(dialog.contains(document.activeElement)).toBe(true);
  const results = await axe.run(document.querySelector('.modal-overlay'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});

test('sending invites the address in the chosen language and says so', async () => {
  inviteAnotherParent.mockResolvedValue({ data: { parent: 'invited', email_sent: true } });
  const root = await renderPage();
  openDialog(root);

  await submit('  papa@example.org ');

  expect(inviteAnotherParent).toHaveBeenCalledWith(7, { parent_email: 'papa@example.org', language: 'fr' });
  expect(app.showMessage).toHaveBeenCalledWith('invite_another_parent_sent', 'success');
  expect(document.querySelector('.modal-overlay')).toBeNull();
});

test('a member already in the unit is reported as linked', async () => {
  inviteAnotherParent.mockResolvedValue({ data: { parent: 'linked_existing_account', email_sent: null } });
  const root = await renderPage();
  openDialog(root);

  await submit('julie@example.org');

  expect(app.showMessage).toHaveBeenCalledWith('invite_another_parent_linked', 'success');
});

test('an email that could not be sent is not reported as sent', async () => {
  inviteAnotherParent.mockResolvedValue({ data: { parent: 'invited', email_sent: false } });
  const root = await renderPage();
  openDialog(root);

  await submit('papa@example.org');

  expect(app.showMessage).toHaveBeenCalledWith('invite_another_parent_not_sent', 'error');
});

test('a missing address is explained next to the field, and nothing is sent', async () => {
  const root = await renderPage();
  openDialog(root);

  await submit('');

  const error = document.getElementById('invite-another-parent-error');
  expect(error.hidden).toBe(false);
  expect(error.getAttribute('role')).toBe('alert');
  expect(error.textContent).toBe('invite_another_parent_email_required');
  expect(document.getElementById('invite-another-parent-email').getAttribute('aria-describedby'))
    .toContain('invite-another-parent-error');
  expect(inviteAnotherParent).not.toHaveBeenCalled();
});

test('a refused or removed address keeps the dialog open and says why', async () => {
  inviteAnotherParent.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 409, code: 'manually_deactivated' }));
  const root = await renderPage();
  openDialog(root);

  await submit('removed@example.org');

  expect(document.getElementById('invite-another-parent-error').textContent).toBe('invite_another_parent_deactivated');
  expect(document.querySelector('.modal-overlay')).not.toBeNull();
});

test('Escape closes the dialog and returns focus to the button that opened it', async () => {
  const root = await renderPage();
  const opener = root.querySelector('.invite-another-parent');
  opener.focus();
  opener.click();

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush();

  expect(document.querySelector('.modal-overlay')).toBeNull();
  expect(document.activeElement).toBe(opener);
});
