/**
 * @jest-environment jsdom
 */

/**
 * Administrator screens for family access: inviting parents, and deciding
 * whether two records are one child.
 *
 * The flow that most needs holding is reinstatement. When an invited address
 * belongs to someone an administrator removed by hand, the server refuses with
 * the date and reason of that removal, and the screen must show them and
 * require a reason before sending again -- never retry silently, never let an
 * empty reason through.
 *
 * @module test/spa/FamilyAccessAdmin
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  getApiUrl: (endpoint) => `https://unit.example.org${endpoint}`,
  CONFIG: { API_BASE_URL: 'https://unit.example.org' },
}));

const mockPermissions = new Set(['users.invite']);
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: (key) => mockPermissions.has(key),
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirm: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../spa/utils/DOMUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/DOMUtils.js');
  return { ...actual, loadStylesheet: jest.fn(() => Promise.resolve()) };
});

jest.mock('../../spa/api/api-parent-invitations.js', () => ({
  getParentInvitations: jest.fn(),
  createParentInvitation: jest.fn(),
  resendParentInvitation: jest.fn(),
  revokeParentInvitation: jest.fn(),
  getParticipantDuplicates: jest.fn(),
  resolveParticipantDuplicate: jest.fn(),
}));

import * as api from '../../spa/api/api-parent-invitations.js';
import { confirm } from '../../spa/utils/DialogUtils.js';
import { ParentInvitations } from '../../spa/modules/parent-invitations/ParentInvitations.js';
import { ParticipantDuplicates } from '../../spa/modules/participant-duplicates/ParticipantDuplicates.js';

/**
 * Let pending promises settle.
 *
 * @returns {Promise<void>}
 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * An error shaped the way the API client throws one.
 *
 * @param {number} status - HTTP status
 * @param {string} code - Machine-readable reason
 * @param {Object} [data] - Details
 * @returns {Error} The error
 */
function apiError(status, code, data = null) {
  const error = new Error(`API request failed: ${code}`);
  error.status = status;
  error.code = code;
  error.data = data;
  return error;
}

/**
 * Open the invitation form and type an address.
 *
 * @param {string} email - Address
 * @returns {void}
 */
function openFormWith(email) {
  document.getElementById('invite-parent-btn').click();
  document.getElementById('invite-email').value = email;
}

/** @returns {Promise<void>} Click send and let it settle */
async function send() {
  document.getElementById('parent-invitation-submit').click();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  mockPermissions.clear();
  mockPermissions.add('users.invite');
  api.getParentInvitations.mockResolvedValue({ data: [] });
});

describe('inviting parents', () => {
  test('lists invitations with their state, escaping what people typed', async () => {
    api.getParentInvitations.mockResolvedValue({
      data: [
        { id: 'a', email: 'x@example.org', first_name: '<img src=x onerror=alert(1)>', state: 'pending', sent_at: null },
        { id: 'b', email: 'y@example.org', state: 'accepted', accepted_at: '2026-09-20T12:00:00Z' },
      ],
    });

    await new ParentInvitations({ lang: 'fr' }).init();

    expect(document.querySelector('img')).toBeNull();
    expect(document.getElementById('app').textContent).toContain('parent_invitations_not_sent');
    // Only an open invitation offers resend and withdraw.
    expect(document.querySelectorAll('[data-action="resend"]')).toHaveLength(1);
  });

  test('without users.invite there is no way to invite', async () => {
    mockPermissions.clear();
    api.getParentInvitations.mockResolvedValue({ data: [{ id: 'a', email: 'x@example.org', state: 'pending' }] });

    await new ParentInvitations({}).init();

    expect(document.getElementById('invite-parent-btn')).toBeNull();
    expect(document.querySelector('[data-action]')).toBeNull();
  });

  test('sends the address, the admin\'s language, and only the fields filled in', async () => {
    api.createParentInvitation.mockResolvedValue({ data: { email_sent: true } });
    await new ParentInvitations({ lang: 'en' }).init();

    openFormWith('parent@example.org');
    document.getElementById('invite-first_name').value = '  Ada ';
    await send();

    expect(api.createParentInvitation).toHaveBeenCalledWith({
      email: 'parent@example.org',
      language: 'en',
      first_name: 'Ada',
    });
    expect(document.getElementById('parent-invitations-status').textContent).toBe('parent_invitations_sent');
  });

  test('an invitation whose email failed is reported as not sent', async () => {
    api.createParentInvitation.mockResolvedValue({ data: { email_sent: false } });
    await new ParentInvitations({}).init();

    openFormWith('parent@example.org');
    await send();

    const status = document.getElementById('parent-invitations-status');
    expect(status.textContent).toBe('parent_invitations_created_not_sent');
    expect(status.className).toContain('warning');
  });

  test('a hand-removed member stops the invitation and shows when and why', async () => {
    api.createParentInvitation.mockRejectedValueOnce(apiError(409, 'manually_deactivated', {
      deactivated_at: '2026-03-01T12:00:00Z',
      deactivated_reason: 'removed_by_admin',
    }));
    await new ParentInvitations({ lang: 'en' }).init();

    openFormWith('removed@example.org');
    await send();

    const panel = document.getElementById('parent-invitation-override');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('removed_by_admin');
    expect(panel.textContent).toContain('2026');
    expect(document.getElementById('parent-invitation-reason')).not.toBeNull();
    // Nothing retried on its own.
    expect(api.createParentInvitation).toHaveBeenCalledTimes(1);
  });

  test('reinstating requires a reason, and sends it with the confirmation', async () => {
    api.createParentInvitation
      .mockRejectedValueOnce(apiError(409, 'manually_deactivated', { deactivated_at: null, deactivated_reason: null }))
      .mockResolvedValueOnce({ data: { email_sent: true } });
    await new ParentInvitations({ lang: 'en' }).init();

    openFormWith('removed@example.org');
    await send();

    await send();
    expect(api.createParentInvitation).toHaveBeenCalledTimes(1);
    expect(document.getElementById('parent-invitation-error').textContent).toBe('parent_invitations_reason_required');

    document.getElementById('parent-invitation-reason').value = 'Dispute resolved with the family';
    await send();

    expect(api.createParentInvitation).toHaveBeenLastCalledWith(expect.objectContaining({
      email: 'removed@example.org',
      confirm_reactivation: true,
      reactivation_reason: 'Dispute resolved with the family',
    }));
  });

  test.each([
    ['already_member', 'parent_invitations_already_member'],
    ['already_invited', 'parent_invitations_already_invited'],
  ])('a %s refusal is explained in the form', async (code, message) => {
    api.createParentInvitation.mockRejectedValue(apiError(409, code));
    await new ParentInvitations({}).init();

    openFormWith('someone@example.org');
    await send();

    expect(document.getElementById('parent-invitation-error').textContent).toBe(message);
  });

  test('withdrawing asks first, then withdraws', async () => {
    api.getParentInvitations.mockResolvedValue({ data: [{ id: 'inv-1', email: 'x@example.org', state: 'pending' }] });
    api.revokeParentInvitation.mockResolvedValue({ data: {} });
    await new ParentInvitations({}).init();

    document.querySelector('[data-action="revoke"]').click();
    await flush();

    expect(confirm).toHaveBeenCalled();
    expect(api.revokeParentInvitation).toHaveBeenCalledWith('inv-1');
  });

  test('declining the confirmation withdraws nothing', async () => {
    confirm.mockResolvedValueOnce(false);
    api.getParentInvitations.mockResolvedValue({ data: [{ id: 'inv-1', email: 'x@example.org', state: 'pending' }] });
    await new ParentInvitations({}).init();

    document.querySelector('[data-action="revoke"]').click();
    await flush();

    expect(api.revokeParentInvitation).not.toHaveBeenCalled();
  });

  test('a failed load offers to try again', async () => {
    api.getParentInvitations.mockRejectedValueOnce(new Error('offline'));
    await new ParentInvitations({}).init();

    expect(document.querySelector('[role="alert"]').textContent).toBe('error_loading_data');
    expect(document.getElementById('parent-invitations-retry')).not.toBeNull();
  });
});

describe('checking duplicate youth', () => {
  const candidate = {
    id: 7,
    status: 'pending',
    participants: [
      { id: 1, first_name: 'Léa', last_name: 'Tremblay', date_naissance: '2016-05-01', in_this_unit: true, units: ['6A'], accounts: ['Alice'] },
      { id: 2, first_name: 'Léa', last_name: 'Tremblay', date_naissance: '2016-05-01', in_this_unit: false, units: ['6B'], accounts: [] },
    ],
  };

  test('shows both records side by side, and marks the one held elsewhere', async () => {
    api.getParticipantDuplicates.mockResolvedValue({ data: [candidate] });

    await new ParticipantDuplicates({ lang: 'fr' }).init();

    expect(document.querySelectorAll('.duplicate-side')).toHaveLength(2);
    expect(document.getElementById('app').textContent).toContain('participant_duplicates_other_unit');
    expect(document.getElementById('app').textContent).toContain('6B');
  });

  test('records the decision with the note', async () => {
    api.getParticipantDuplicates.mockResolvedValue({ data: [candidate] });
    api.resolveParticipantDuplicate.mockResolvedValue({ data: {} });
    await new ParticipantDuplicates({}).init();

    document.getElementById('duplicate-note-7').value = 'Cousins';
    document.querySelector('[data-decision="different"]').click();
    await flush();

    expect(api.resolveParticipantDuplicate).toHaveBeenCalledWith(7, 'different', 'Cousins');
    expect(document.getElementById('participant-duplicates-status').textContent)
      .toBe('participant_duplicates_recorded_different');
  });

  test('says plainly that "same child" does not merge anything', async () => {
    api.getParticipantDuplicates.mockResolvedValue({ data: [candidate] });
    api.resolveParticipantDuplicate.mockResolvedValue({ data: {} });
    await new ParticipantDuplicates({}).init();

    document.querySelector('[data-decision="same_person"]').click();
    await flush();

    expect(document.getElementById('participant-duplicates-status').textContent)
      .toBe('participant_duplicates_recorded_same');
  });
});
