/**
 * @jest-environment jsdom
 *
 * Volunteer space: a member finds their camps, shifts and tasks in one place, and opens a camp to
 * read what they need there: their shifts, the schedule, what their shift type calls for, the site
 * and emergencies, and the team's instructions. A camp they take no part in reads as not theirs.
 */
import axe from 'axe-core';

const mockPermissions = new Set();
jest.mock('../../spa/config.js', () => ({ CONFIG: { CACHE_DURATION: {} }, getStorageKey: (key) => key }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn((key) => mockPermissions.has(key)) }));
jest.mock('../../spa/modules/certifications/CertificationsPanel.js', () => ({ CERTIFICATIONS_ANCHOR: 'certifications' }));
jest.mock('../../spa/modules/member-allergies/AllergyPanel.js', () => ({ ALLERGY_ANCHOR: 'my-allergies' }));
jest.mock('../../spa/api/api-volunteer-space.js', () => ({ getVolunteerSpace: jest.fn(), getVolunteerSpaceCamp: jest.fn() }));

import { getVolunteerSpace, getVolunteerSpaceCamp } from '../../spa/api/api-volunteer-space.js';
jest.mock('../../spa/api/api-member-profile.js', () => ({ getCampContacts: jest.fn() }));
import { getCampContacts } from '../../spa/api/api-member-profile.js';
import { VolunteerSpace } from '../../spa/modules/volunteer-space/VolunteerSpace.js';
import { getTodayISO } from '../../spa/utils/DateUtils.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const DAY_MS = 86400000;
const day = (offset) => new Date(new Date(`${getTodayISO()}T12:00:00`).getTime() + (offset * DAY_MS)).toISOString().slice(0, 10);

const OVERVIEW = {
  camps: [{ activity_id: 3, name: 'Camp d’hiver', start_date: day(0), end_date: day(2), team_role: null, shift_count: 2, pending_count: 1 }],
  shifts: [
    { id: 11, activity_id: 3, activity_name: 'Camp d’hiver', volunteer_type: 'cook', title: 'Souper', shift_date: day(1),
      start_time: '16:00', end_time: '19:00', status: 'confirmed', missing: [] },
    { id: 12, activity_id: 3, activity_name: 'Camp d’hiver', volunteer_type: 'camp_aide', title: '', shift_date: day(1),
      start_time: '09:00', end_time: '12:00', status: 'pending', missing: ['safety_training'] },
  ],
  tasks: [{ id: 5, title: 'Acheter le pain', status: 'todo', due_date: day(1), activity_name: 'Camp d’hiver' }],
  open_tasks: 7,
};
const camp = (fields = {}) => ({
  camp: {
    activity_id: 3, name: 'Camp d’hiver', start_date: day(-1), end_date: day(1),
    meeting_location_going: 'Local scout', meeting_time_going: '17:30', departure_time_going: '18:00',
    meeting_location_return: null, meeting_time_return: null, departure_time_return: null,
  },
  team_role: null,
  has_plan: true,
  panels: ['menus'],
  shifts: [OVERVIEW.shifts[0]],
  schedule: [
    { day_offset: 0, date: day(-1), title: 'Arrivée', items: [] },
    { day_offset: 1, date: day(0), title: null, items: [{ name: 'Grand jeu', start_time: '09:30', duration_minutes: 90 }] },
    { day_offset: 2, date: day(1), title: null, items: [] },
  ],
  tasks: [],
  sections: [
    { key: 'rules_of_life', body_html: '<p>On se respecte.</p>', body_text: 'On se respecte.' },
    { key: 'emergency_procedures', body_html: '<p>Trois coups de sifflet.</p>', body_text: 'Trois coups de sifflet.' },
  ],
  site: { name: 'Base de plein air fictive', address: '1 chemin du Lac', phone: '555-0100', hospital_name: 'Hôpital fictif',
    hospital_phone: '555-0199', hospital_travel_minutes: 20, contact_phone: null, on_site_lead_name: 'Ada Lovelace' },
  menus: [{ id: 11, title: 'Souper', shift_date: day(0), start_time: '16:00', end_time: '19:00', notes: 'Menu : spaghetti' }],
  ...fields,
});

let screen;
const app = { lang: 'fr', showMessage: jest.fn() };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sectionTitles = () => [...document.querySelectorAll('.volunteer-space__section > h2')].map((node) => node.textContent.trim());

async function open(activityId = null) {
  screen = new VolunteerSpace(app, { activityId });
  await screen.init();
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '<main id="app"></main>';
  mockPermissions.clear();
  ['volunteer_space.view', 'volunteers.view', 'tasks.view'].forEach((key) => mockPermissions.add(key));
  getCampContacts.mockResolvedValue({ data: [] });
  getVolunteerSpace.mockResolvedValue({ data: OVERVIEW });
  getVolunteerSpaceCamp.mockResolvedValue({ data: camp() });
});

afterEach(() => screen?.destroy());

describe('the space\'s first page', () => {
  test('a volunteer sees their camps, shifts, tasks and profile, the back link first', async () => {
    await open();
    const page = document.querySelector('.volunteer-space');
    expect(page.firstElementChild.tagName).toBe('A');
    expect(document.querySelector('h1').textContent).toBe('volunteer_space_title');
    expect(sectionTitles()).toEqual(['volunteer_space_camps_title', 'volunteer_space_shifts_title', 'volunteer_space_tasks_title', 'volunteer_space_profile_title']);
    expect(document.querySelector('a[href="/volunteer-space/3"]').textContent).toBe('Camp d’hiver');
    expect(document.body.textContent).toContain('volunteer_space_camp_now');
    const profile = document.getElementById('volunteer-space-profile');
    expect(profile.querySelectorAll('a')).toHaveLength(1);
    expect(profile.querySelector('a').getAttribute('href')).toBe('/account-info#my-profile');
    expect(profile.textContent).toContain('member_profile_open');
    expect(profile.textContent).toContain('member_profile_open_hint');
  });

  test('a place still to verify says so in words, beside a confirmed one', async () => {
    await open();
    const cards = [...document.querySelectorAll('#volunteer-space-shifts .volunteer-space__card')];
    expect(cards.map((card) => card.querySelector('.volunteer-space__state').textContent))
      .toEqual(['volunteers_your_place', 'volunteers_your_place_pending']);
  });

  test('more open tasks than shown lead to the tasks page', async () => {
    await open();
    const link = document.querySelector('#volunteer-space-tasks a[href="/tasks"]');
    expect(link.textContent).toBe('volunteer_space_tasks_more');
  });

  test('a member who takes part in nothing is told how to start', async () => {
    getVolunteerSpace.mockResolvedValue({ data: { camps: [], shifts: [], tasks: [], open_tasks: 0 } });
    await open();
    expect(document.body.textContent).toContain('volunteer_space_camps_empty');
    expect(document.querySelector('#volunteer-space-camps a[href="/volunteers"]').textContent).toBe('volunteer_space_take_shift');
    expect(document.body.textContent).toContain('volunteer_space_tasks_empty');
  });

  test('a failed load says so and offers to try again, never "nothing here"', async () => {
    getVolunteerSpace.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 500 }));
    await open();
    expect(document.querySelector('[role="alert"]').textContent).toBe('volunteer_space_load_failed');
    expect(document.querySelector('h1').textContent).toBe('volunteer_space_title');
    document.getElementById('volunteer-space-retry').click();
    await flush();
    expect(document.querySelector('#volunteer-space-camps')).not.toBeNull();
  });

  test('names coming from people show as text', async () => {
    getVolunteerSpace.mockResolvedValue({ data: { ...OVERVIEW,
      camps: [{ ...OVERVIEW.camps[0], name: HOSTILE }], tasks: [{ ...OVERVIEW.tasks[0], title: HOSTILE }] } });
    await open();
    expect(document.querySelector('#app img')).toBeNull();
    expect(document.querySelector('a[href="/volunteer-space/3"]').textContent).toBe(HOSTILE);
  });

  test('passes axe', async () => {
    await open();
    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

describe('one camp', () => {
  test('a cook reads their shifts, the schedule, the menus, the site and the team\'s instructions', async () => {
    await open('3');
    expect(getVolunteerSpaceCamp).toHaveBeenCalledWith(3);
    expect(document.querySelector('.volunteer-space > a').getAttribute('href')).toBe('/volunteer-space');
    expect(document.querySelector('h1').textContent).toBe('Camp d’hiver');
    expect(sectionTitles()).toEqual(['volunteer_space_my_shifts_title', 'volunteer_space_schedule_title', 'volunteer_space_menus_title',
      'volunteer_space_site_title', 'volunteer_space_instructions_title', 'member_profile_camp_contacts', 'volunteer_space_camp_tasks_title']);
    expect(document.querySelector('.volunteer-space__menu-text').textContent).toBe('Menu : spaghetti');
    expect(document.querySelector('#volunteer-space-instructions').textContent).toContain('On se respecte.');
    expect(document.querySelector('#volunteer-space-site').textContent).toContain('Trois coups de sifflet.');
    expect(document.querySelector('#volunteer-space-site a[href="tel:5550199"]').textContent).toBe('555-0199');
  });

  test('today\'s schedule is open, the other days are a tap away', async () => {
    await open('3');
    const days = [...document.querySelectorAll('.volunteer-space__day')];
    expect(days.map((node) => node.open)).toEqual([false, true, false]);
    expect(days[1].textContent).toContain('volunteer_space_today');
    expect(days[1].textContent).toContain('Grand jeu');
  });

  test('a night watch reads the site and emergencies right after their shifts', async () => {
    getVolunteerSpaceCamp.mockResolvedValue({ data: camp({ panels: ['emergency_first'], menus: [] }) });
    await open('3');
    expect(sectionTitles().slice(0, 2)).toEqual(['volunteer_space_my_shifts_title', 'volunteer_space_site_title']);
    expect(sectionTitles()).not.toContain('volunteer_space_menus_title');
  });

  test('a driver finds the departure and, with carpool access, the carpool', async () => {
    mockPermissions.add('carpools.view');
    getVolunteerSpaceCamp.mockResolvedValue({ data: camp({ panels: ['transport'], menus: [] }) });
    await open('3');
    const transport = document.getElementById('volunteer-space-transport');
    expect(transport.textContent).toContain('Local scout');
    expect(transport.querySelector('a[href="/carpool/3"]')).not.toBeNull();
  });

  test('the quick links move focus to their part of the camp', async () => {
    await open('3');
    document.querySelector('.volunteer-space__nav a[href="#volunteer-space-site"]').click();
    expect(document.activeElement.id).toBe('volunteer-space-site');
  });

  test('a camp without a written schedule or site says so', async () => {
    getVolunteerSpaceCamp.mockResolvedValue({ data: camp({ schedule: [], site: null, sections: [], has_plan: false }) });
    await open('3');
    expect(document.body.textContent).toContain('volunteer_space_schedule_empty');
    expect(document.body.textContent).toContain('volunteer_space_site_unplanned');
    expect(document.body.textContent).toContain('volunteer_space_instructions_empty');
  });

  test('a camp they take no part in reads as not theirs, with no retry', async () => {
    getVolunteerSpaceCamp.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    await open('9');
    expect(document.querySelector('[role="alert"]').textContent).toBe('volunteer_space_camp_not_found');
    expect(document.getElementById('volunteer-space-retry')).toBeNull();
  });

  test('a malformed camp address is not sent to the server', async () => {
    await open('abc');
    expect(getVolunteerSpaceCamp).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]').textContent).toBe('volunteer_space_camp_not_found');
  });

  test('text written by people shows as text', async () => {
    getVolunteerSpaceCamp.mockResolvedValue({ data: camp({
      camp: { ...camp().camp, name: HOSTILE, meeting_location_going: HOSTILE },
      panels: ['menus', 'transport'],
      menus: [{ ...camp().menus[0], notes: HOSTILE }],
      site: { ...camp().site, name: HOSTILE, on_site_lead_name: HOSTILE },
      schedule: [{ day_offset: 0, date: day(0), title: HOSTILE, items: [{ name: HOSTILE, start_time: '09:00', duration_minutes: null }] }],
    }) });
    await open('3');
    expect(document.querySelector('#app img')).toBeNull();
    expect(document.querySelector('h1').textContent).toBe(HOSTILE);
    expect(document.querySelector('.volunteer-space__menu-text').textContent).toBe(HOSTILE);
  });

  test('a late answer does not draw over the next screen', async () => {
    let resolve;
    getVolunteerSpaceCamp.mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = open('3');
    screen.destroy();
    document.getElementById('app').textContent = 'next screen';
    resolve({ data: camp() });
    await pending;
    expect(document.getElementById('app').textContent).toBe('next screen');
  });

  test('passes axe', async () => {
    getVolunteerSpaceCamp.mockResolvedValue({ data: camp({ panels: ['menus', 'transport'] }) });
    await open('3');
    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

test('camp contacts are fetched separately and hostile names remain text', async () => {
  getCampContacts.mockResolvedValue({ data: [{ user_id: 'peer', name: HOSTILE, phone: '555-0100' }] });
  await open(3);
  expect(getCampContacts).toHaveBeenCalledWith(3);
  expect(document.querySelector('#camp-peer-contacts img')).toBeNull();
  expect(document.querySelector('#camp-peer-contacts strong').textContent).toBe(HOSTILE);
  expect(document.querySelector('#camp-peer-contacts a').getAttribute('href')).toBe('tel:5550100');
});

test('unavailable contacts are explained without replacing the readable camp schedule, and can be retried', async () => {
  getCampContacts.mockRejectedValueOnce(new Error('offline'));
  await open(3);
  expect(document.querySelector('#volunteer-space-schedule')).not.toBeNull();
  expect(document.querySelector('#camp-peer-contacts').textContent).toContain('member_profile_contacts_unavailable');
  document.getElementById('camp-contacts-retry').click(); await flush();
  expect(document.querySelector('#camp-peer-contacts').textContent).toContain('member_profile_contacts_empty');
});
