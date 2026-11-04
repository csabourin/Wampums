/**
 * @jest-environment jsdom
 */

/**
 * Deleting an activity, and choosing whether its cancellation is announced.
 *
 * The dialog names the activity, opens on Cancel (the safe answer), and offers
 * an email to families and leaders that is off until the person ticks it.
 * Cancel, Escape and the close button delete nothing. The dialog has no
 * WCAG A/AA violation.
 *
 * @module test/spa/ActivityDeleteDialog
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  app: {},
  translate: (key) => key,
}));

const mockPermissions = new Set(['meetings.edit']);
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: (key) => mockPermissions.has(key),
}));

jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDate: (value) => `formatted ${value}`,
}));

const { confirmActivityDeletion, deletedMessageKey } = require('../../spa/modules/activities/ActivityDeleteDialog.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

const CANOE_TRIP = { id: 7, name: 'Sortie canot' };

const dialog = () => document.getElementById('activity-delete-dialog');
const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = '<main id="app"><button type="button" id="opener">delete</button></main>';
  document.getElementById('opener').focus();
});

describe('confirming an activity\'s deletion', () => {
  test('it names the activity and opens on Cancel, with the email not chosen', () => {
    confirmActivityDeletion(CANOE_TRIP);

    expect(dialog().textContent).toContain('Sortie canot');
    expect(dialog().textContent).toContain('confirm_delete_activity');
    expect(document.activeElement.id).toBe('activity-delete-cancel');
    expect(document.getElementById('activity-delete-notify').checked).toBe(false);
  });

  test('deleting without ticking the box sends no email', async () => {
    const answer = confirmActivityDeletion(CANOE_TRIP);
    document.getElementById('activity-delete-confirm').click();

    await expect(answer).resolves.toEqual({ notify: false, restoreMeeting: true });
    expect(dialog()).toBeNull();
  });

  test('ticking the box announces the cancellation', async () => {
    const answer = confirmActivityDeletion(CANOE_TRIP);
    document.getElementById('activity-delete-notify').click();
    document.getElementById('activity-delete-confirm').click();

    await expect(answer).resolves.toEqual({ notify: true, restoreMeeting: true });
  });

  test('Cancel deletes nothing, even with the box ticked', async () => {
    const answer = confirmActivityDeletion(CANOE_TRIP);
    document.getElementById('activity-delete-notify').click();
    document.getElementById('activity-delete-cancel').click();

    await expect(answer).resolves.toBeNull();
  });

  test('Escape deletes nothing and returns focus to the delete button', async () => {
    const answer = confirmActivityDeletion(CANOE_TRIP);
    press('Escape');

    await expect(answer).resolves.toBeNull();
    expect(document.activeElement.id).toBe('opener');
  });

  test('Tab stays inside the dialog', () => {
    confirmActivityDeletion(CANOE_TRIP);
    document.getElementById('activity-delete-confirm').focus();
    press('Tab');

    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  test('an activity name is shown as text, never as markup', () => {
    confirmActivityDeletion({ id: 8, name: '<img src=x onerror=alert(1)>Canot' });

    expect(dialog().querySelector('img')).toBeNull();
    expect(dialog().textContent).toContain('<img src=x onerror=alert(1)>Canot');
  });

  test('the dialog has no WCAG A/AA violation', async () => {
    confirmActivityDeletion(CANOE_TRIP);
    const results = await axe.run(document.body, AXE_OPTIONS);

    expect(results.violations).toEqual([]);
  });
});

describe('cancelling an outing that replaced a meeting', () => {
  const MUSEUM = { id: 9, name: 'Sortie au musée', replaces_meeting_id: 41, replaces_meeting_date: '2026-11-17' };
  const actionButton = (label) => Array.from(document.querySelectorAll('.dialog__actions button'))
    .find((button) => button.textContent.trim() === label);
  /** Confirm the deletion, then wait for the question about the meeting. */
  async function deleteAndReachQuestion() {
    const answer = confirmActivityDeletion(MUSEUM, 'fr');
    document.getElementById('activity-delete-confirm').click();
    await Promise.resolve();
    await Promise.resolve();
    // Wrapped: awaiting the helper must not wait for the answer itself.
    return { answer };
  }

  test('after confirming, the app asks whether the meeting of that date comes back', async () => {
    const { answer } = await deleteAndReachQuestion();

    expect(document.body.textContent).toContain('activity_delete_restore_meeting_message');
    expect(actionButton('activity_delete_restore_meeting_yes')).toBeTruthy();
    actionButton('activity_delete_restore_meeting_yes').click();
    await expect(answer).resolves.toEqual({ notify: false, restoreMeeting: true });
  });

  test('declining keeps the meeting cancelled and still deletes the outing', async () => {
    const { answer } = await deleteAndReachQuestion();
    actionButton('activity_delete_restore_meeting_no').click();

    await expect(answer).resolves.toEqual({ notify: false, restoreMeeting: false });
  });

  test('cancelling the deletion asks nothing about the meeting', async () => {
    const answer = confirmActivityDeletion(MUSEUM, 'fr');
    document.getElementById('activity-delete-cancel').click();

    await expect(answer).resolves.toBeNull();
    expect(document.body.textContent).not.toContain('activity_delete_restore_meeting_message');
  });

  test('the question has no WCAG A/AA violation', async () => {
    const { answer } = await deleteAndReachQuestion();
    const results = await axe.run(document.body, AXE_OPTIONS);

    expect(results.violations).toEqual([]);
    actionButton('activity_delete_restore_meeting_yes').click();
    await answer;
  });

  test('someone who may not cancel meetings is not asked: the meeting comes back', async () => {
    mockPermissions.delete('meetings.edit');
    try {
      const answer = confirmActivityDeletion(MUSEUM, 'fr');
      document.getElementById('activity-delete-confirm').click();

      await expect(answer).resolves.toEqual({ notify: false, restoreMeeting: true });
      expect(document.body.textContent).not.toContain('activity_delete_restore_meeting_message');
    } finally {
      mockPermissions.add('meetings.edit');
    }
  });

  test('the message after deletion says what became of the meeting', () => {
    expect(deletedMessageKey(null)).toBe('activity_deleted_success');
    expect(deletedMessageKey({ id: 41, restored: true })).toBe('activity_deleted_meeting_restored');
    expect(deletedMessageKey({ id: 41, restored: false })).toBe('activity_deleted_meeting_cancelled');
  });
});
