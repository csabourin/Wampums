/**
 * @jest-environment jsdom
 */

/**
 * "Welcome a new child" -- the screen a leader uses at the edge of a meeting.
 *
 * Held here: four fields are checked before anything is sent; what the server
 * did with the parent's address is said plainly; a hand-removed parent is only
 * reinstated with a written reason and only by someone allowed to; and the
 * waiting list lets a leader resend or correct an address.
 *
 * @module test/spa/WalkInChildren
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
  CONFIG: { API_BASE_URL: 'https://unit.example.org', SUPPORTED_LANGS: ['en', 'fr'] },
}));

jest.mock('../../spa/utils/DOMUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/DOMUtils.js');
  return { ...actual, loadStylesheet: jest.fn(() => Promise.resolve()) };
});

jest.mock('../../spa/api/api-walk-in.js', () => ({
  getWalkInChildren: jest.fn(),
  addWalkInChild: jest.fn(),
  inviteParentForChild: jest.fn(),
  resendWalkInInvitation: jest.fn(),
}));

import * as api from '../../spa/api/api-walk-in.js';
import { WalkInChildren } from '../../spa/modules/walk-in/WalkInChildren.js';

/** @returns {Promise<void>} Let pending promises settle */
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
  const error = new Error(code);
  error.status = status;
  error.code = code;
  error.data = data;
  return error;
}

const WAITING = [
  {
    id: 7, first_name: 'Noah', last_name: 'Walker', date_naissance: '2016-04-04',
    invitation: { id: 'inv-7', email: 'maman@example.org', state: 'pending', sent_at: '2026-09-25T19:00:00Z' },
  },
  { id: 8, first_name: 'Zoé', last_name: 'Seule', date_naissance: '2017-01-01', invitation: null },
];

/**
 * Fill and submit the quick-add form.
 *
 * @param {Object} [values] - Field values
 * @returns {Promise<void>}
 */
async function addChild(values = {}) {
  const set = (id, value) => { document.getElementById(id).value = value; };
  set('walk-in-first-name', values.first ?? 'Emma');
  set('walk-in-last-name', values.last ?? 'Walker');
  set('walk-in-birth-date', values.born ?? '2018-06-06');
  set('walk-in-parent-email', values.email ?? 'maman@example.org');
  document.getElementById('walk-in-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await flush();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  api.getWalkInChildren.mockResolvedValue({ data: WAITING });
});

test('lists the children waiting for a parent, with where each invitation stands', async () => {
  await new WalkInChildren({ lang: 'fr' }).init();

  const text = document.getElementById('app').textContent;
  expect(text).toContain('Noah Walker');
  expect(text).toContain('maman@example.org');
  expect(text).toContain('walk_in_no_invitation');
  // Resend only where there is an invitation to resend.
  expect(document.querySelectorAll('[data-resend]')).toHaveLength(1);
  expect(document.querySelector('[data-invite="8"]').textContent.trim()).toBe('walk_in_invite_parent');
  expect(document.querySelector('[data-invite="7"]').textContent.trim()).toBe('walk_in_change_email');
});

test('checks the child and the address before sending anything', async () => {
  await new WalkInChildren({}).init();

  await addChild({ born: '' });
  expect(document.getElementById('walk-in-error').textContent).toBe('onboarding_error_dob_required');

  await addChild({ email: '' });
  expect(document.getElementById('walk-in-error').textContent).toBe('walk_in_error_email_required');

  expect(api.addWalkInChild).not.toHaveBeenCalled();
});

test('adds the child with the page language, and names them in the confirmation', async () => {
  api.addWalkInChild.mockResolvedValue({ data: { participant_id: 9, parent: 'invited', email_sent: true } });
  await new WalkInChildren({ lang: 'en' }).init();

  await addChild();

  expect(api.addWalkInChild).toHaveBeenCalledWith({
    first_name: 'Emma',
    last_name: 'Walker',
    date_naissance: '2018-06-06',
    parent_email: 'maman@example.org',
    language: 'en',
  });
  expect(document.getElementById('walk-in-status').textContent).toBe('walk_in_added_invited');
});

test.each([
  ['added_to_invitation', null, 'walk_in_added_to_invitation'],
  ['linked_existing_account', null, 'walk_in_added_linked'],
  ['invited', false, 'walk_in_added_not_sent'],
])('says what happened to the parent side (%s)', async (parent, emailSent, message) => {
  api.addWalkInChild.mockResolvedValue({ data: { participant_id: 9, parent, email_sent: emailSent } });
  await new WalkInChildren({}).init();

  await addChild();

  expect(document.getElementById('walk-in-status').textContent).toBe(message);
});

test('a child already in the unit is refused and named', async () => {
  api.addWalkInChild.mockRejectedValue(apiError(409, 'duplicate_child', {
    existing: { id: 7, first_name: 'Noah', last_name: 'Walker' },
  }));
  await new WalkInChildren({}).init();

  await addChild({ first: 'Noah', born: '2016-04-04' });

  expect(document.getElementById('walk-in-error').textContent).toBe('walk_in_error_duplicate');
});

test('a leader meeting a hand-removed parent is told to ask an administrator', async () => {
  api.addWalkInChild.mockRejectedValue(apiError(409, 'manually_deactivated', {
    deactivated_at: '2026-03-01T12:00:00Z', deactivated_reason: 'removed_by_admin', can_override: false,
  }));
  await new WalkInChildren({}).init();

  await addChild();

  expect(document.getElementById('walk-in-error').textContent).toBe('walk_in_error_removed_member');
  expect(document.getElementById('walk-in-override').hidden).toBe(true);
});

test('an administrator may reinstate, but only with a written reason', async () => {
  api.addWalkInChild
    .mockRejectedValueOnce(apiError(409, 'manually_deactivated', {
      deactivated_at: '2026-03-01T12:00:00Z', deactivated_reason: 'removed_by_admin', can_override: true,
    }))
    .mockResolvedValueOnce({ data: { participant_id: 9, parent: 'invited', email_sent: true } });
  await new WalkInChildren({ lang: 'fr' }).init();

  await addChild();
  expect(document.getElementById('walk-in-override').textContent).toContain('removed_by_admin');

  await addChild();
  expect(document.getElementById('walk-in-error').textContent).toBe('parent_invitations_reason_required');
  expect(api.addWalkInChild).toHaveBeenCalledTimes(1);

  document.getElementById('walk-in-reason').value = 'Returning family';
  await addChild();
  expect(api.addWalkInChild).toHaveBeenLastCalledWith(expect.objectContaining({
    confirm_reactivation: true,
    reactivation_reason: 'Returning family',
  }));
});

test('invites a parent for a child on the list', async () => {
  api.inviteParentForChild.mockResolvedValue({ data: { parent: 'invited', email_sent: true } });
  await new WalkInChildren({ lang: 'fr' }).init();

  document.querySelector('[data-invite="8"]').click();
  const form = document.querySelector('[data-invite-form="8"]');
  expect(form.hidden).toBe(false);
  form.querySelector('[name="parent_email"]').value = 'papa@example.org';
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await flush();

  expect(api.inviteParentForChild).toHaveBeenCalledWith(8, { parent_email: 'papa@example.org', language: 'fr' });
  expect(document.getElementById('walk-in-status').textContent).toBe('walk_in_invited');
});

test('resends an invitation from the list', async () => {
  api.resendWalkInInvitation.mockResolvedValue({ data: { email_sent: true } });
  await new WalkInChildren({}).init();

  document.querySelector('[data-resend="inv-7"]').click();
  await flush();

  expect(api.resendWalkInInvitation).toHaveBeenCalledWith('inv-7');
  expect(document.getElementById('walk-in-status').textContent).toBe('parent_invitations_resent');
});

test('names are escaped, not rendered', async () => {
  api.getWalkInChildren.mockResolvedValue({
    data: [{ ...WAITING[1], first_name: '<img src=x onerror=alert(1)>' }],
  });

  await new WalkInChildren({}).init();

  expect(document.querySelector('img')).toBeNull();
});

test('a refusal does not leave the previous child\'s confirmation showing', async () => {
  api.addWalkInChild
    .mockResolvedValueOnce({ data: { participant_id: 9, parent: 'invited', email_sent: true } })
    .mockRejectedValueOnce(apiError(409, 'duplicate_child', { existing: { id: 9, first_name: 'Emma', last_name: 'Walker' } }));
  await new WalkInChildren({}).init();

  await addChild();
  expect(document.getElementById('walk-in-status').hidden).toBe(false);

  await addChild();
  expect(document.getElementById('walk-in-status').hidden).toBe(true);
  expect(document.getElementById('walk-in-error').textContent).toBe('walk_in_error_duplicate');
});
