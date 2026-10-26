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

const { confirmActivityDeletion } = require('../../spa/modules/activities/ActivityDeleteDialog.js');

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

    await expect(answer).resolves.toEqual({ notify: false });
    expect(dialog()).toBeNull();
  });

  test('ticking the box announces the cancellation', async () => {
    const answer = confirmActivityDeletion(CANOE_TRIP);
    document.getElementById('activity-delete-notify').click();
    document.getElementById('activity-delete-confirm').click();

    await expect(answer).resolves.toEqual({ notify: true });
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
