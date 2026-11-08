/**
 * @jest-environment jsdom
 */

/**
 * Camp lists (#1319): the youth taking part, the camp's team and the
 * volunteers of its shifts. What cannot be vouched for
 * among it, is listed under "To check", never as compliant; a manager names the
 * team in a dialog; names are shown as text; the screen and its dialog meet
 * WCAG A/AA.
 *
 * @module test/spa/CampRoster
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true), isDemoUser: jest.fn(() => false), hasOrganizationScope: jest.fn(() => true) }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirmDestructive: jest.fn(), hasActiveDialog: jest.fn(() => false) }));
jest.mock('../../spa/api/api-camp-rosters.js', () => ({
  getCampRoster: jest.fn(), getCampTeamCandidates: jest.fn(), saveCampTeamMember: jest.fn(), removeCampTeamMember: jest.fn(),
  saveCampActivities: jest.fn(),
}));

const api = require('../../spa/api/api-camp-rosters.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
const { confirmDestructive } = require('../../spa/utils/DialogUtils.js');
const { CampRoster } = require('../../spa/modules/camp-plan/CampRoster.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const AIDE_ID = '00000000-0000-4000-8000-0000000000a1';
const LEAD_ID = '00000000-0000-4000-8000-0000000000b2';
const NEW_ID = '00000000-0000-4000-8000-0000000000c3';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);
let screen; let app;

function roster(overrides = {}) {
  return {
    camp: { id: 12, theme: 'Camp d’été', date_from: '2027-07-10', date_to: '2027-07-17', activity_id: 40, is_cancelled: false },
    scout_year: { id: 3, label: '2026-2027' },
    consent: { requested: true, signed: 2, pending: 1, withdrawn: 1 },
    youth: [
      { id: 1, first_name: 'Léa', last_name: 'Tremblay', nickname: null, age_at_camp: 10 },
      { id: 2, first_name: HOSTILE, last_name: 'Lovelace', nickname: 'Ada', age_at_camp: null },
    ],
    team: [
      { user_id: LEAD_ID, team_role: 'lead', name: 'Grace Hopper', nickname: 'Akela', age_status: 'adult', active_member: true },
      { user_id: AIDE_ID, team_role: 'camp_aide', name: 'Alan Turing', nickname: null, age_status: 'unknown', active_member: true, date_of_birth: null },
    ],
    volunteers: { count: 1, people: [{ user_id: NEW_ID, name: 'Mary Somerville', nickname: null, types: ['cook'], pending: true }] },
    gaps: ['aide_age_unknown'],
    ...overrides,
  };
}

async function open() {
  screen = new CampRoster(app, { meetingId: 12 });
  await screen.init();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  app = { lang: 'fr', showMessage: jest.fn() };
  hasPermission.mockImplementation(() => true);
  api.getCampRoster.mockReset().mockResolvedValue({ success: true, data: roster() });
  api.getCampTeamCandidates.mockReset().mockResolvedValue({ success: true, data: [
    { user_id: LEAD_ID, name: 'Grace Hopper', nickname: 'Akela' },
    { user_id: NEW_ID, name: 'Mary Somerville', nickname: null },
  ] });
  api.saveCampTeamMember.mockReset().mockResolvedValue({ success: true, data: { team: [] } });
  api.removeCampTeamMember.mockReset().mockResolvedValue({ success: true, data: { team: [] } });
  api.saveCampActivities.mockReset().mockResolvedValue({ success: true, data: { swimming_planned: true } });
  confirmDestructive.mockReset();
});

afterEach(() => {
  screen?.destroy();
  document.querySelectorAll('.modal-overlay').forEach((overlay) => overlay.remove());
});

test('the lists open with a back link, then what is still to check', async () => {
  await open();
  expect($('#app .page').firstElementChild.matches('.back-link, a, nav')).toBe(true);
  expect($('h1').textContent).toBe('camp_roster_title');
  const gaps = Array.from(document.querySelectorAll('.camp-roster__gaps li')).map((item) => item.textContent);
  expect(gaps).toEqual(['camp_roster_gap_aide_age_unknown']);
  expect(document.body.textContent).not.toMatch(/compliant|conforme/i);
});

test('with nothing left to check, the lists say so in words rather than showing an empty list', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({ gaps: [], blocking_gaps: [] }) });
  await open();
  expect(document.querySelector('.camp-roster__gaps')).toBeNull();
  expect(document.body.textContent).toContain('camp_roster_nothing_to_check');
  expect(document.body.textContent).not.toMatch(/sisc/i);
});

test('youth are listed with their age at camp, and the list says how it was drawn up', async () => {
  await open();
  const rows = Array.from(document.querySelectorAll('.camp-roster__table tbody tr'));
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('Léa Tremblay');
  expect(rows[0].querySelector('td[data-label="camp_roster_column_age"]').textContent).toBe('camp_roster_age_years');
  expect(rows[1].textContent).toContain('camp_roster_age_unknown');
  expect(document.querySelector('#camp-roster-youth').parentElement.textContent).toContain('camp_roster_youth_consent');
});

test('without permission requests, the list says every enrolled youth is listed', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({ consent: { requested: false, signed: 0, pending: 0, withdrawn: 0 } }) });
  await open();
  expect(document.querySelector('#camp-roster-youth').parentElement.textContent).toContain('camp_roster_youth_whole_unit');
});

test('an empty camp says what would fill it, and its emptiness is listed to check', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({ youth: [], team: [], volunteers: { count: 0, people: [] }, gaps: ['no_youth', 'no_lead'] }) });
  await open();
  expect(document.body.textContent).toContain('camp_roster_youth_empty');
  expect(document.body.textContent).toContain('camp_roster_team_empty');
  expect(document.body.textContent).toContain('camp_roster_volunteers_empty');
  const gaps = Array.from(document.querySelectorAll('.camp-roster__gaps li')).map((item) => item.textContent);
  expect(gaps).toEqual(['camp_roster_gap_no_youth', 'camp_roster_gap_no_lead']);
});

test('team members show their role and their age on the camp’s dates in words', async () => {
  await open();
  const members = Array.from(document.querySelectorAll('#camp-roster-team ~ .camp-roster__list .camp-roster__member'));
  expect(members[0].textContent).toContain('camp_roster_name_with_nickname');
  expect(members[0].textContent).toContain('camp_roster_role_lead');
  expect(members[1].textContent).toContain('camp_roster_role_camp_aide');
  expect(members[1].textContent).toContain('camp_roster_age_status_unknown');
});

test('a blocking gap comes first and says it is blocking in words, not by colour alone', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({
    gaps: ['aide_age_unknown', 'no_first_aider', 'swimming_supervision'], blocking_gaps: ['no_first_aider'],
  }) });
  await open();
  const gaps = Array.from(document.querySelectorAll('.camp-roster__gaps li')).map((item) => item.textContent);
  expect(gaps).toEqual([
    'camp_roster_blocking camp_roster_gap_no_first_aider',
    'camp_roster_gap_aide_age_unknown',
    'camp_roster_gap_swimming_supervision',
  ]);
});

test('team members show the certifications verified for the camp, and those still to verify', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({
    team: [
      { ...roster().team[0], certifications: { verified: ['wilderness_first_aid'], to_verify: ['winter_camping'] } },
      { ...roster().team[1], certifications: { verified: [], to_verify: [] } },
    ],
  }) });
  await open();
  const members = Array.from(document.querySelectorAll('.camp-roster__member[data-member]'));
  expect(members[0].textContent).toContain('camp_roster_certifications_verified');
  expect(members[0].textContent).toContain('camp_roster_certifications_to_verify');
  expect(members[1].textContent).toContain('camp_roster_certifications_none');
  expect(members[1].textContent).not.toContain('camp_roster_certifications_to_verify');
});

test('without the right to see them, no certification line is drawn', async () => {
  await open();
  expect(document.querySelector('.camp-roster__certifications')).toBeNull();
});

test('a manager says the camp plans swimming; the box is disabled while saving', async () => {
  await open();
  const box = $('#camp-roster-swimming');
  expect(box.checked).toBe(false);
  expect(box.getAttribute('aria-describedby')).toBe('camp-roster-swimming-help');
  box.checked = true;
  box.dispatchEvent(new Event('change'));
  expect(box.disabled).toBe(true);
  await flush();
  expect(api.saveCampActivities).toHaveBeenCalledWith(12, { swimming_planned: true });
  expect(app.showMessage).toHaveBeenCalledWith('camp_roster_activities_saved', 'success');
});

test('a refused swimming change goes back to what is recorded and explains itself', async () => {
  api.saveCampActivities.mockRejectedValue(Object.assign(new Error('refused'), { status: 409 }));
  await open();
  const box = $('#camp-roster-swimming');
  box.checked = true;
  box.dispatchEvent(new Event('change'));
  await flush();
  expect(box.checked).toBe(false);
  expect(box.disabled).toBe(false);
  expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
  expect(app.showMessage).not.toHaveBeenCalledWith(expect.anything(), 'success');
});

test('without meetings.manage, the camp’s swimming is read, not offered for change', async () => {
  hasPermission.mockImplementation((key) => key !== 'meetings.manage');
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({ camp: { ...roster().camp, swimming_planned: true } }) });
  await open();
  expect($('#camp-roster-swimming')).toBeNull();
  expect(document.querySelector('#camp-roster-activities').parentElement.textContent).toContain('camp_roster_swimming_yes');
});

function allergies(overrides = {}) {
  return {
    youth: [{ participant_id: 2, first_name: HOSTILE, last_name: 'Lovelace', nickname: null, allergies: 'Arachides', epipen: true,
      emergency_medication: 'EpiPen 0,3 mg', reaction: 'Urticaire', action: 'Auto-injecteur puis 911' }],
    youth_without_health_form: 1,
    adults: [{ user_id: LEAD_ID, name: 'Grace Hopper', nickname: null, allergies: HOSTILE, carries_epipen: false, person_to_notify: '$& Ada, 555-0100' }],
    adults_without_declaration: 1,
    ...overrides,
  };
}

test('without the right to read allergies, the server sends none and no allergy section is drawn', async () => {
  await open();
  expect($('#camp-roster-allergies')).toBeNull();
});

test('youth allergies come with the response and a link to the health form, which names the person to notify', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({ allergies: allergies() }) });
  await open();
  const row = document.querySelector('#camp-roster-allergies-youth + table tbody tr');
  expect(row.querySelector('td[data-label="camp_roster_column_allergies"]').textContent).toBe('Arachides');
  expect(row.querySelector('td[data-label="camp_roster_column_epipen"]').textContent).toBe('camp_roster_yes');
  expect(row.querySelector('td[data-label="camp_roster_column_response"]').textContent).toBe('Urticaire · Auto-injecteur puis 911 · EpiPen 0,3 mg');
  expect(row.querySelector('a').getAttribute('href')).toBe('/dynamic-form/fiche_sante/2');
  expect(document.querySelector('#camp-roster-allergies').parentElement.textContent).toContain('camp_roster_allergies_youth_no_form');
});

test('team allergies are each adult’s own declaration; those who declared nothing are counted, not read as “none”', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({ allergies: allergies() }) });
  await open();
  const section = document.querySelector('#camp-roster-allergies').parentElement;
  expect(section.textContent).toContain('camp_roster_allergies_adults_help');
  expect(section.textContent).toContain('camp_roster_allergies_adults_silent');
  expect(section.textContent).toContain('camp_roster_notify_line');
});

test('an allergy list with nothing declared says so, and still counts what is unknown', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({ allergies: allergies({ youth: [], adults: [], youth_without_health_form: 0 }) }) });
  await open();
  const section = document.querySelector('#camp-roster-allergies').parentElement;
  expect(section.textContent).toContain('camp_roster_allergies_youth_empty');
  expect(section.textContent).toContain('camp_roster_allergies_adults_empty');
  expect(section.textContent).toContain('camp_roster_allergies_adults_silent');
  expect(section.textContent).not.toContain('camp_roster_allergies_youth_no_form');
});

test('allergies and names typed by people are shown as text', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({ allergies: allergies() }) });
  await open();
  expect(document.querySelector('#app img')).toBeNull();
  const section = document.querySelector('#camp-roster-allergies').parentElement;
  expect(section.textContent).toContain(HOSTILE);
});

test('volunteers are named only when the server names them', async () => {
  await open();
  expect(document.querySelector('#camp-roster-volunteers').parentElement.textContent).toContain('Mary Somerville');
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({ volunteers: { count: 3, people: null } }) });
  await screen.init();
  await flush();
  const section = document.querySelector('#camp-roster-volunteers').parentElement;
  expect(section.textContent).toContain('camp_roster_volunteers_count');
  expect(section.textContent).not.toContain('Mary Somerville');
});

test('names coming from people are shown as text', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({
    camp: { ...roster().camp, theme: HOSTILE },
    team: [{ user_id: AIDE_ID, team_role: 'leader', name: HOSTILE, nickname: null, age_status: 'adult', active_member: true }],
  }) });
  await open();
  expect(document.querySelector('#app img')).toBeNull();
  expect(document.querySelector('.camp-plan__intro strong').textContent).toBe(HOSTILE);
  expect(document.querySelector('.camp-roster__member-name').textContent).toBe(HOSTILE);
});

test('without meetings.manage the team is read, never offered for change', async () => {
  hasPermission.mockImplementation((key) => key !== 'meetings.manage');
  await open();
  expect($('#camp-roster-add')).toBeNull();
  expect(document.querySelector('[data-edit-member], [data-remove-member]')).toBeNull();
});

test('a cancelled camp says so and offers no team change, which the server would refuse', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({ camp: { ...roster().camp, is_cancelled: true } }) });
  await open();
  expect(document.body.textContent).toContain('camp_roster_cancelled');
  expect($('#camp-roster-add')).toBeNull();
  expect(document.querySelector('[data-edit-member], [data-remove-member]')).toBeNull();
  expect(document.querySelectorAll('.camp-roster__member').length).toBeGreaterThan(0);
});

test('a manager adds a member from the unit’s team, choosing a role and a birth date', async () => {
  await open();
  $('#camp-roster-add').click();
  await flush();
  const dialog = document.querySelector('.modal-dialog[role="dialog"]');
  expect(dialog).not.toBeNull();
  const options = Array.from(dialog.querySelectorAll('#camp-roster-member option')).map((option) => option.value);
  expect(options).toEqual([NEW_ID]);
  expect(document.activeElement).toBe(dialog.querySelector('#camp-roster-member'));
  dialog.querySelector('#camp-roster-role').value = 'camp_aide';
  dialog.querySelector('#camp-roster-birth').value = '2009-05-01';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  await flush();
  expect(api.saveCampTeamMember).toHaveBeenCalledWith(12, NEW_ID, { team_role: 'camp_aide', date_of_birth: '2009-05-01' });
  expect(app.showMessage).toHaveBeenCalledWith('camp_roster_team_saved', 'success');
  expect(document.querySelector('.modal-overlay')).toBeNull();
});

test('adding a member without typing a birth date keeps the one already on their account', async () => {
  await open();
  $('#camp-roster-add').click();
  await flush();
  const dialog = document.querySelector('.modal-dialog');
  dialog.querySelector('#camp-roster-role').value = 'leader';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  await flush();
  expect(api.saveCampTeamMember).toHaveBeenCalledWith(12, NEW_ID, { team_role: 'leader' });
});

test('emptying a member’s recorded birth date clears it', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({
    team: [{ user_id: AIDE_ID, team_role: 'camp_aide', name: 'Alan Turing', nickname: null, age_status: 'minor', active_member: true, date_of_birth: '2012-04-01' }],
  }) });
  await open();
  document.querySelector(`[data-edit-member="${AIDE_ID}"]`).click();
  await flush();
  const dialog = document.querySelector('.modal-dialog');
  const birth = dialog.querySelector('#camp-roster-birth');
  expect(birth.value).toBe('2012-04-01');
  birth.value = '';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  await flush();
  expect(api.saveCampTeamMember).toHaveBeenCalledWith(12, AIDE_ID, { team_role: 'camp_aide', date_of_birth: null });
});

test('a birth date in the future is refused next to its field, before anything is sent', async () => {
  await open();
  document.querySelector(`[data-edit-member="${  AIDE_ID  }"]`).click();
  await flush();
  const dialog = document.querySelector('.modal-dialog');
  const birth = dialog.querySelector('#camp-roster-birth');
  birth.value = '2999-01-01';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  expect(api.saveCampTeamMember).not.toHaveBeenCalled();
  expect(birth.getAttribute('aria-invalid')).toBe('true');
  expect(birth.getAttribute('aria-describedby')).toContain('camp-roster-birth-error');
  expect(dialog.querySelector('#camp-roster-birth-error').textContent).toBe('camp_roster_birth_date_invalid');
  birth.value = '2009-05-01';
  birth.dispatchEvent(new Event('input'));
  expect(dialog.querySelector('#camp-roster-birth-error').textContent).toBe('');
});

test('a server refusal about a field stays in the dialog, next to that field', async () => {
  api.saveCampTeamMember.mockRejectedValue(Object.assign(new Error('refused'), {
    status: 400, errors: [{ path: 'date_of_birth', msg: 'camp_roster_birth_date_invalid' }],
  }));
  await open();
  document.querySelector(`[data-edit-member="${  AIDE_ID  }"]`).click();
  await flush();
  const dialog = document.querySelector('.modal-dialog');
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
  await flush();
  expect(document.querySelector('.modal-overlay')).not.toBeNull();
  expect(dialog.querySelector('#camp-roster-birth').getAttribute('aria-invalid')).toBe('true');
  expect(app.showMessage).not.toHaveBeenCalledWith(expect.anything(), 'success');
});

test('Escape closes the dialog and returns focus to its opener', async () => {
  await open();
  const opener = document.querySelector(`[data-edit-member="${  AIDE_ID  }"]`);
  opener.focus();
  opener.click();
  await flush();
  expect(document.querySelector('.modal-overlay')).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.querySelector('.modal-overlay')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test('removing a member asks first; declining changes nothing', async () => {
  confirmDestructive.mockResolvedValue(false);
  await open();
  document.querySelector(`[data-remove-member="${  AIDE_ID  }"]`).click();
  await flush();
  expect(confirmDestructive).toHaveBeenCalled();
  expect(api.removeCampTeamMember).not.toHaveBeenCalled();
  confirmDestructive.mockResolvedValue(true);
  document.querySelector(`[data-remove-member="${  AIDE_ID  }"]`).click();
  await flush();
  await flush();
  expect(api.removeCampTeamMember).toHaveBeenCalledWith(12, AIDE_ID);
  expect(app.showMessage).toHaveBeenCalledWith('camp_roster_team_removed', 'success');
});

test('a failed load explains itself and offers a retry, never an empty list', async () => {
  api.getCampRoster.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
  await open();
  expect($('[role="alert"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain('camp_roster_youth_empty');
  $('#camp-roster-retry').click();
  await flush();
  expect($('.camp-roster__table')).not.toBeNull();
});

test('a response arriving after leaving the screen draws nothing', async () => {
  let resolve;
  api.getCampRoster.mockReturnValue(new Promise((done) => { resolve = done; }));
  screen = new CampRoster(app, { meetingId: 12 });
  const loading = screen.init();
  screen.destroy();
  document.getElementById('app').textContent = 'next screen';
  resolve({ success: true, data: roster() });
  await loading;
  expect(document.getElementById('app').textContent).toBe('next screen');
});

test('the lists and the team dialog meet WCAG A/AA', async () => {
  api.getCampRoster.mockResolvedValue({ success: true, data: roster({
    gaps: ['no_first_aider'], blocking_gaps: ['no_first_aider'],
    team: [{ ...roster().team[0], certifications: { verified: ['first_aid_certificate'], to_verify: [] } }],
    allergies: allergies(),
  }) });
  await open();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
  $('#camp-roster-add').click();
  await flush();
  expect((await axe.run(document.querySelector('.modal-overlay'), AXE_OPTIONS)).violations).toEqual([]);
});
