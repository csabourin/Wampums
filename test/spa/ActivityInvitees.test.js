/**
 * @jest-environment jsdom
 */

/**
 * "Who is invited?" in the activity form.
 *
 * An activity invites the whole unit or only some participants (a fall camp
 * for those aged 10 and over who have never been). Filters narrow the list
 * shown without changing who is checked; the payload carries the checked
 * children, hidden ones included. The fieldset is operable by keyboard alone,
 * announces the invited count, and has no WCAG A/AA violation.
 *
 * @module test/spa/ActivityInvitees
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

jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getApiUrl: (endpoint) => endpoint }));

const PARTICIPANTS = [
  { id: 1, first_name: 'Alice', last_name: 'Aînée', date_naissance: '2015-03-01', group_id: 10, group_name: 'Rouge' },
  { id: 2, first_name: 'Bruno', last_name: 'Benjamin', date_naissance: '2017-06-15', group_id: 10, group_name: 'Rouge' },
  // Turns 10 the day after the camp starts: still 9 on the first day
  { id: 3, first_name: 'Chloé', last_name: 'Charnière', date_naissance: '2016-10-25', group_id: 20, group_name: 'Bleu' },
  { id: 4, first_name: 'David', last_name: 'Doyen', date_naissance: '2014-01-10', group_id: 20, group_name: 'Bleu' },
];
const GROUPS = [{ id: 10, name: 'Rouge' }, { id: 20, name: 'Bleu' }];

jest.mock('../../spa/ajax-functions.js', () => ({
  fetchParticipants: jest.fn(),
  getCurrentOrganizationId: jest.fn(() => 3),
}));

jest.mock('../../spa/api/api-endpoints.js', () => ({
  getGroups: jest.fn(),
}));

jest.mock('../../spa/api/api-activities.js', () => ({
  createActivity: jest.fn(),
  updateActivity: jest.fn(),
  getActivity: jest.fn(),
}));

jest.mock('../../spa/indexedDB.js', () => ({ clearActivityRelatedCaches: jest.fn() }));
jest.mock('../../spa/modules/AI.js', () => ({ aiGenerateText: jest.fn() }));

const { fetchParticipants } = require('../../spa/ajax-functions.js');
const { getGroups } = require('../../spa/api/api-endpoints.js');
const { createActivity, updateActivity, getActivity } = require('../../spa/api/api-activities.js');
const { ageOn } = require('../../spa/modules/activities/ActivityInviteesPicker.js');
const { openActivityFormModal } = require('../../spa/modules/activities/ActivityFormModal.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
};

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function fillRequired(overlay) {
  const set = (selector, value) => { overlay.querySelector(selector).value = value; };
  set('#activity-name', 'Camp d\'automne');
  set('#activity-start-date', '2026-10-24');
  set('#activity-start-time', '18:00');
  set('#activity-end-date', '2026-10-26');
  set('#activity-end-time', '12:00');
  set('#meeting-location-going', 'Local');
  set('#meeting-time-going', '17:30');
  set('#departure-time-going', '17:45');
}

/** Choose "Only some participants" the way a keyboard user does: Space on the radio. */
async function chooseSome(overlay) {
  const some = overlay.querySelector('#activity-invites-some');
  some.focus();
  some.click();
  await flush();
  return some;
}

const visibleNames = (overlay) => Array.from(overlay.querySelectorAll('.activity-invitees__item'))
  .filter((item) => !item.hidden)
  .map((item) => item.querySelector('label span').textContent.trim().split(' ')[0]);

describe('activity invitations', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.textContent = '';
    app = { showMessage: jest.fn() };
    fetchParticipants.mockResolvedValue(PARTICIPANTS);
    getGroups.mockResolvedValue({ data: GROUPS });
    createActivity.mockResolvedValue({ id: 99 });
    updateActivity.mockResolvedValue({ id: 5 });
  });

  test('age is counted on the activity\'s first day', () => {
    expect(ageOn('2016-10-25', '2026-10-24')).toBe(9);
    expect(ageOn('2016-10-24', '2026-10-24')).toBe(10);
    expect(ageOn('2016-10-24T04:00:00.000Z', '2026-10-24')).toBe(10);
    expect(ageOn(null, '2026-10-24')).toBeNull();
  });

  test('a new activity invites the whole unit by default and does not load the roster', async () => {
    const { close } = openActivityFormModal(app);
    const overlay = document.getElementById('activity-modal');
    expect(overlay.querySelector('#activity-invites-everyone').checked).toBe(true);
    expect(overlay.querySelector('#activity-invitees-picker').hidden).toBe(true);
    expect(fetchParticipants).not.toHaveBeenCalled();

    fillRequired(overlay);
    overlay.querySelector('#activity-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(createActivity).toHaveBeenCalledWith(expect.objectContaining({ invites_everyone: true }));
    expect(createActivity.mock.calls[0][0]).not.toHaveProperty('invited_participant_ids');
    close();
  });

  test('filters narrow who is shown; "invite those shown" checks only them', async () => {
    const { close } = openActivityFormModal(app);
    const overlay = document.getElementById('activity-modal');
    fillRequired(overlay);
    const some = await chooseSome(overlay);

    expect(some.getAttribute('aria-controls')).toBe('activity-invitees-picker');
    expect(overlay.querySelector('#activity-invitees-picker').hidden).toBe(false);
    expect(visibleNames(overlay)).toEqual(['Alice', 'Bruno', 'Chloé', 'David']);

    const minAge = overlay.querySelector('#activity-invitees-min-age');
    minAge.value = '10';
    minAge.dispatchEvent(new Event('input', { bubbles: true }));
    expect(visibleNames(overlay)).toEqual(['Alice', 'David']);

    overlay.querySelector('[data-invitees-action="check"]').click();
    const count = overlay.querySelector('#activity-invitees-count');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(count.textContent).toBe('activity_invitees_selected_count');

    // David already went: uncheck him
    overlay.querySelector('#activity-invitee-4').click();

    // Clearing the filter shows everyone again; checks are unchanged
    minAge.value = '';
    minAge.dispatchEvent(new Event('input', { bubbles: true }));
    const checked = Array.from(overlay.querySelectorAll('input[name="invited_participant_ids"]:checked'))
      .map((box) => Number(box.value));
    expect(checked).toEqual([1]);

    // A filter hides rows without uninviting them
    const group = overlay.querySelector('#activity-invitees-group');
    group.value = '20';
    group.dispatchEvent(new Event('change', { bubbles: true }));
    expect(visibleNames(overlay)).toEqual(['Chloé', 'David']);

    overlay.querySelector('#activity-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(createActivity).toHaveBeenCalledWith(expect.objectContaining({
      invites_everyone: false,
      invited_participant_ids: [1],
    }));
    close();
  });

  test('saving with nobody invited is refused with a message', async () => {
    const { close } = openActivityFormModal(app);
    const overlay = document.getElementById('activity-modal');
    fillRequired(overlay);
    await chooseSome(overlay);

    overlay.querySelector('#activity-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(createActivity).not.toHaveBeenCalled();
    expect(app.showMessage).toHaveBeenCalledWith('activity_invitees_none_selected', 'error');
    close();
  });

  test('editing an activity for some participants loads and keeps who is invited', async () => {
    getActivity.mockResolvedValue({ id: 5, invites_everyone: false, invited_participant_ids: [2, 3] });
    const activity = {
      id: 5, name: 'Camp', invites_everyone: false,
      activity_start_date: '2026-10-24', activity_start_time: '18:00:00',
      activity_end_date: '2026-10-26', activity_end_time: '12:00:00',
      meeting_location_going: 'Local', meeting_time_going: '17:30:00', departure_time_going: '17:45:00',
    };
    const { close } = openActivityFormModal(app, { activity });
    const overlay = document.getElementById('activity-modal');
    await flush();
    await flush();

    expect(getActivity).toHaveBeenCalledWith(5);
    expect(overlay.querySelector('#activity-invites-some').checked).toBe(true);
    const checked = Array.from(overlay.querySelectorAll('input[name="invited_participant_ids"]:checked'))
      .map((box) => Number(box.value));
    expect(checked).toEqual([2, 3]);

    overlay.querySelector('#activity-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(updateActivity).toHaveBeenCalledWith(5, expect.objectContaining({
      invites_everyone: false,
      invited_participant_ids: [2, 3],
    }));
    close();
  });

  test('a child invited earlier but off this year\'s roster stays invited', async () => {
    // Child 9 left the unit after being invited: the roster has no row for them
    getActivity.mockResolvedValue({ id: 5, invites_everyone: false, invited_participant_ids: [2, 9] });
    const activity = {
      id: 5, name: 'Camp', invites_everyone: false,
      activity_start_date: '2026-10-24', activity_start_time: '18:00:00',
      activity_end_date: '2026-10-26', activity_end_time: '12:00:00',
      meeting_location_going: 'Local', meeting_time_going: '17:30:00', departure_time_going: '17:45:00',
    };
    const { close } = openActivityFormModal(app, { activity });
    const overlay = document.getElementById('activity-modal');
    await flush();
    await flush();
    expect(overlay.querySelector('#activity-invitee-9')).toBeNull();

    overlay.querySelector('#activity-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(updateActivity).toHaveBeenCalledWith(5, expect.objectContaining({
      invites_everyone: false,
      invited_participant_ids: [2, 9],
    }));
    close();
  });

  test('without access to groups the list still loads, minus the group filter', async () => {
    getGroups.mockRejectedValueOnce(new Error('403'));
    const { close } = openActivityFormModal(app);
    const overlay = document.getElementById('activity-modal');
    fillRequired(overlay);
    await chooseSome(overlay);
    await flush();

    expect(overlay.querySelectorAll('.activity-invitees__item')).toHaveLength(PARTICIPANTS.length);
    expect(overlay.querySelectorAll('#activity-invitees-group option')).toHaveLength(1);
    overlay.querySelector('#activity-invitee-1').click();
    overlay.querySelector('#activity-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(createActivity).toHaveBeenCalledWith(expect.objectContaining({ invited_participant_ids: [1] }));
    close();
  });

  test('a roster that fails to load offers a retry and blocks saving the list', async () => {
    fetchParticipants.mockRejectedValueOnce(new Error('offline'));
    const { close } = openActivityFormModal(app);
    const overlay = document.getElementById('activity-modal');
    fillRequired(overlay);
    await chooseSome(overlay);

    expect(overlay.querySelector('#activity-invitees-status').getAttribute('role')).toBe('status');
    overlay.querySelector('#activity-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(createActivity).not.toHaveBeenCalled();
    expect(app.showMessage).toHaveBeenCalledWith('activity_invitees_not_loaded', 'error');

    const retry = overlay.querySelector('[data-invitees-retry]');
    expect(retry.tagName).toBe('BUTTON');
    retry.click();
    await flush();
    expect(overlay.querySelectorAll('.activity-invitees__item')).toHaveLength(PARTICIPANTS.length);
    close();
  });

  test('every control is a labelled native control reachable by Tab', async () => {
    const { close } = openActivityFormModal(app);
    const overlay = document.getElementById('activity-modal');
    await chooseSome(overlay);

    const fieldset = overlay.querySelector('.activity-invitees');
    expect(fieldset.tagName).toBe('FIELDSET');
    expect(fieldset.querySelector('legend').textContent).toBe('activity_invitees_legend');

    const controls = fieldset.querySelectorAll('input, select, button');
    controls.forEach((control) => {
      expect(control.getAttribute('tabindex')).not.toBe('-1');
      expect(control.disabled).toBe(false);
      if (control.tagName !== 'BUTTON') {
        expect(overlay.querySelector(`label[for="${control.id}"]`)).not.toBeNull();
      }
    });
    // Each child's checkbox is named by the child
    expect(overlay.querySelector('label[for="activity-invitee-1"]').textContent).toContain('Alice');
    close();
  });

  test('has no WCAG A/AA violations with the list open', async () => {
    const { close } = openActivityFormModal(app);
    const overlay = document.getElementById('activity-modal');
    fillRequired(overlay);
    await chooseSome(overlay);

    const results = await axe.run(overlay.querySelector('.activity-invitees'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
    close();
  });
});
