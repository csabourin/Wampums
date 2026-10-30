/**
 * @jest-environment jsdom
 *
 * Volunteering: a volunteer sees what each activity or camp needs and takes or gives up a
 * place; a manager adds shifts and sees who signed up. The last place goes to one person:
 * the other is told why.
 */
import axe from 'axe-core';

const mockPermissions = new Set();
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn((key) => mockPermissions.has(key)) }));
jest.mock('../../spa/api/api-volunteers.js', () => ({
  getVolunteerShifts: jest.fn(), getVolunteerShiftActivities: jest.fn(), saveVolunteerShift: jest.fn(),
  deleteVolunteerShift: jest.fn(), signUpForShift: jest.fn(), withdrawFromShift: jest.fn(), removeVolunteer: jest.fn(),
  getVolunteerRequirements: jest.fn(), saveVolunteerRequirements: jest.fn(),
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirmDestructive: jest.fn(() => Promise.resolve(true)),
  hasActiveDialog: jest.fn(() => false),
}));

import {
  getVolunteerShifts, getVolunteerShiftActivities, saveVolunteerShift, signUpForShift, withdrawFromShift, removeVolunteer,
  getVolunteerRequirements, saveVolunteerRequirements,
} from '../../spa/api/api-volunteers.js';
import { Volunteers } from '../../spa/modules/volunteers/Volunteers.js';
import { closeAllModals } from '../../spa/utils/ModalUtils.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const shift = (fields) => ({
  activity_id: 3, activity_name: 'Camp de la Toussaint', is_camp: true,
  activity_start_date: '2026-11-06', activity_end_date: '2026-11-08',
  shift_date: '2026-11-07', start_time: '17:00', end_time: '19:00', notes: '', volunteers: null, mine: false,
  volunteer_type: 'other', requirements: [], pending: 0, my_status: fields.mine ? 'confirmed' : null, my_missing: [], ...fields,
});
const SHIFTS = [
  shift({ id: 1, title: 'Cuisine', slots: 2, taken: 1 }),
  shift({ id: 2, title: 'Veille de nuit', slots: 1, taken: 1 }),
  shift({ id: 3, title: 'Transport', slots: 2, taken: 1, mine: true }),
  shift({ id: 4, volunteer_type: 'camp_aide', title: '', slots: 2, taken: 0, requirements: ['background_check', 'safety_training'] }),
];

let screen;
const app = { lang: 'fr', showMessage: jest.fn() };
const byShift = (title) => [...document.querySelectorAll('.volunteers__shift')].find((item) => item.querySelector('h3').textContent === title);

async function open() {
  screen = new Volunteers(app);
  await screen.init();
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '<main id="app"></main>';
  mockPermissions.clear();
  mockPermissions.add('volunteers.view');
  getVolunteerShifts.mockResolvedValue({ data: SHIFTS });
  signUpForShift.mockResolvedValue({ success: true, data: { status: 'confirmed', missing: [] } });
  withdrawFromShift.mockResolvedValue({ success: true });
});

afterEach(() => {
  closeAllModals();
  screen?.destroy();
});

test('a volunteer sees each shift under its camp, with the places left written out', async () => {
  await open();
  expect(document.querySelector('h1').textContent).toBe('volunteers_title');
  expect(document.querySelector('.volunteers__activity h2').textContent).toBe('Camp de la Toussaint');
  expect(byShift('Cuisine').textContent).toContain('volunteers_places_free');
  expect(byShift('Veille de nuit').textContent).toContain('volunteers_full');
  expect(byShift('Veille de nuit').querySelector('[data-sign-up]')).toBeNull();
  expect(byShift('Transport').textContent).toContain('volunteers_your_place');
  expect(document.querySelector('[data-edit]')).toBeNull();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});

test('taking a place confirms it and shows the shifts as they now are', async () => {
  await open();
  byShift('Cuisine').querySelector('[data-sign-up]').click();
  await flush();
  expect(signUpForShift).toHaveBeenCalledWith('1');
  expect(app.showMessage).toHaveBeenCalledWith('volunteers_signed_up', 'success');
  expect(getVolunteerShifts).toHaveBeenCalledTimes(2);
});

test('when someone else took the last place first, the volunteer is told and the list is refreshed', async () => {
  signUpForShift.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409, message: 'volunteer_shift_full' }));
  await open();
  byShift('Cuisine').querySelector('[data-sign-up]').click();
  await flush();
  expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
  expect(app.showMessage).not.toHaveBeenCalledWith('volunteers_signed_up', 'success');
  expect(getVolunteerShifts).toHaveBeenCalledTimes(2);
});

test('giving up one\'s own place frees it', async () => {
  await open();
  byShift('Transport').querySelector('[data-withdraw]').click();
  await flush();
  expect(withdrawFromShift).toHaveBeenCalledWith('3');
  expect(app.showMessage).toHaveBeenCalledWith('volunteers_withdrawn', 'success');
});

test('"places left only" hides full shifts, and buttons still work after filtering', async () => {
  await open();
  const filter = document.getElementById('volunteers-vacant-only');
  filter.checked = true;
  filter.dispatchEvent(new Event('change'));
  expect(byShift('Veille de nuit')).toBeUndefined();
  byShift('Cuisine').querySelector('[data-sign-up]').click();
  await flush();
  expect(signUpForShift).toHaveBeenCalledWith('1');
});

test('with no shift at all, the screen says so rather than showing nothing', async () => {
  getVolunteerShifts.mockResolvedValue({ data: [] });
  await open();
  expect(document.querySelector('.volunteers__empty').textContent).toBe('volunteers_empty');
});

test('a failed load shows an error with a retry, never "no shift"', async () => {
  getVolunteerShifts.mockRejectedValueOnce(new Error('offline'));
  await open();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(document.querySelector('.volunteers__empty')).toBeNull();
  document.getElementById('volunteers-retry').click();
  await flush();
  expect(document.querySelector('.volunteers__shift')).not.toBeNull();
});

test('names typed by people are shown as text', async () => {
  mockPermissions.add('volunteers.manage');
  getVolunteerShifts.mockResolvedValue({ data: [shift({
    id: 1, title: '<img src=x onerror=alert(1)>', slots: 2, taken: 1, activity_name: '<b>Camp</b>',
    volunteers: [{ user_id: '00000000-0000-4000-8000-000000000002', name: '<img src=y onerror=alert(2)>' }],
  })] });
  await open();
  expect(document.querySelector('#app img')).toBeNull();
  expect(document.querySelector('#app b')).toBeNull();
  expect(document.querySelector('.volunteers__names').textContent).toContain('<img src=y');
});

test('a manager sees who signed up and can remove someone, after confirming', async () => {
  mockPermissions.add('volunteers.manage');
  getVolunteerShifts.mockResolvedValue({ data: [shift({
    id: 1, title: 'Cuisine', slots: 2, taken: 1,
    volunteers: [{ user_id: '00000000-0000-4000-8000-000000000002', name: 'Léa Tremblay' }],
  })] });
  removeVolunteer.mockResolvedValue({ success: true });
  await open();
  const remove = document.querySelector('[data-remove]');
  expect(remove.getAttribute('aria-label')).toBe('volunteers_remove_person');
  remove.click();
  await flush();
  expect(removeVolunteer).toHaveBeenCalledWith('1', '00000000-0000-4000-8000-000000000002');
});

describe('adding a shift', () => {
  beforeEach(() => {
    mockPermissions.add('volunteers.manage');
    getVolunteerShiftActivities.mockResolvedValue({ data: [
      { id: 3, name: 'Camp de la Toussaint', activity_start_date: '2026-11-06', activity_end_date: '2026-11-08' },
    ] });
    // Each test fills the form from the start, type first.
    saveVolunteerShift.mockResolvedValue({ data: { id: 9 } });
  });

  async function openForm() {
    await open();
    document.getElementById('volunteers-add').click();
    await flush();
    return document.getElementById('volunteers-form');
  }

  test('the form opens as a labelled dialog, with focus inside it, and Escape closes it', async () => {
    await openForm();
    const dialog = document.querySelector('#volunteers-editor [role="dialog"]');
    expect(dialog.getAttribute('aria-labelledby')).toBe('volunteers-editor-title');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect((await axe.run(document.getElementById('volunteers-editor'), AXE_OPTIONS)).violations).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(document.getElementById('volunteers-editor')).toBeNull();
  });

  test('a day outside the camp is refused before sending, its field marked', async () => {
    const form = await openForm();
    form.elements.volunteer_activity.value = '3';
    form.elements.volunteer_activity.dispatchEvent(new Event('change'));
    form.elements.volunteer_kind.value = 'cook';
    form.elements.volunteer_title.value = 'Cuisine';
    form.elements.volunteer_date.value = '2026-12-01';
    form.elements.volunteer_start.value = '17:00';
    form.elements.volunteer_end.value = '19:00';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(saveVolunteerShift).not.toHaveBeenCalled();
    expect(form.elements.volunteer_date.getAttribute('aria-invalid')).toBe('true');
    expect(form.elements.volunteer_date.getAttribute('aria-describedby')).toContain('volunteers-form-error');
    expect(document.getElementById('volunteers-form-error').hidden).toBe(false);
  });

  test('a complete shift is sent as typed, then the list reloads', async () => {
    const form = await openForm();
    form.elements.volunteer_activity.value = '3';
    form.elements.volunteer_activity.dispatchEvent(new Event('change'));
    form.elements.volunteer_kind.value = 'cook';
    form.elements.volunteer_title.value = ' Déjeuners ';
    form.elements.volunteer_date.value = '2026-11-07';
    form.elements.volunteer_start.value = '17:00';
    form.elements.volunteer_end.value = '19:00';
    form.elements.volunteer_slots.value = '3';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await flush();
    expect(saveVolunteerShift).toHaveBeenCalledWith({
      activity_id: 3, volunteer_type: 'cook', title: 'Déjeuners', shift_date: '2026-11-07', start_time: '17:00', end_time: '19:00', slots: 3, notes: '',
    }, null);
    expect(document.getElementById('volunteers-editor')).toBeNull();
    expect(app.showMessage).toHaveBeenCalledWith('volunteers_saved', 'success');
  });

  test('a field the server refuses is marked, and the dialog stays open', async () => {
    saveVolunteerShift.mockRejectedValue(Object.assign(new Error('Bad'), {
      status: 400, errors: [{ path: 'slots', msg: 'volunteer_invalid_slots' }],
    }));
    const form = await openForm();
    form.elements.volunteer_activity.value = '3';
    form.elements.volunteer_activity.dispatchEvent(new Event('change'));
    form.elements.volunteer_kind.value = 'cook';
    form.elements.volunteer_title.value = 'Cuisine';
    form.elements.volunteer_date.value = '2026-11-07';
    form.elements.volunteer_start.value = '17:00';
    form.elements.volunteer_end.value = '19:00';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await flush();
    expect(form.elements.volunteer_slots.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('volunteers-editor')).not.toBeNull();
    expect(document.activeElement.id).toBe('volunteers-form-error');
  });
});

describe('types and what they require', () => {
  test('a camp aide shift is named by its type and says what it requires', async () => {
    await open();
    const aide = byShift('volunteer_type_camp_aide');
    expect(aide.textContent).toContain('volunteers_requires');
    expect(aide.dataset.type).toBe('camp_aide');
  });

  test('the type filter shows only that kind of shift', async () => {
    await open();
    const filter = document.getElementById('volunteers-type-filter');
    expect(document.querySelector('label[for="volunteers-type-filter"]')).not.toBeNull();
    filter.value = 'camp_aide';
    filter.dispatchEvent(new Event('change'));
    expect([...document.querySelectorAll('.volunteers__shift')].map((item) => item.dataset.type)).toEqual(['camp_aide']);
  });

  test('a place still to verify is announced as held, never as confirmed', async () => {
    signUpForShift.mockResolvedValue({ data: { status: 'pending', missing: ['background_check'] } });
    await open();
    byShift('volunteer_type_camp_aide').querySelector('[data-sign-up]').click();
    await flush();
    expect(app.showMessage).toHaveBeenCalledWith('volunteers_pending', 'info');
    expect(app.showMessage).not.toHaveBeenCalledWith('volunteers_signed_up', 'success');
  });

  test('one\'s own held place says what is still to verify', async () => {
    getVolunteerShifts.mockResolvedValue({ data: [shift({
      id: 4, volunteer_type: 'camp_aide', title: '', slots: 2, taken: 1, pending: 1, mine: true, my_status: 'pending',
      requirements: ['background_check', 'safety_training'], my_missing: ['safety_training'],
    })] });
    await open();
    expect(document.querySelector('.volunteers__mine--pending').textContent).toBe('volunteers_your_place_pending');
    expect(document.querySelector('.volunteers__places').textContent).toContain('volunteers_pending_count');
  });

  test('without a type, or "other" without a description, the form is not sent', async () => {
    mockPermissions.add('volunteers.manage');
    getVolunteerShiftActivities.mockResolvedValue({ data: [
      { id: 3, name: 'Camp', activity_start_date: '2026-11-06', activity_end_date: '2026-11-08' },
    ] });
    await open();
    document.getElementById('volunteers-add').click();
    await flush();
    const form = document.getElementById('volunteers-form');
    form.elements.volunteer_activity.value = '3';
    form.elements.volunteer_activity.dispatchEvent(new Event('change'));
    form.elements.volunteer_date.value = '2026-11-07';
    form.elements.volunteer_start.value = '17:00';
    form.elements.volunteer_end.value = '19:00';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(form.elements.volunteer_kind.getAttribute('aria-invalid')).toBe('true');
    form.elements.volunteer_kind.value = 'other';
    form.elements.volunteer_kind.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(form.elements.volunteer_title.getAttribute('aria-invalid')).toBe('true');
    expect(saveVolunteerShift).not.toHaveBeenCalled();
  });

  test('choosing camp aide in the form says what it will require', async () => {
    mockPermissions.add('volunteers.manage');
    getVolunteerShiftActivities.mockResolvedValue({ data: [
      { id: 3, name: 'Camp', activity_start_date: '2026-11-06', activity_end_date: '2026-11-08' },
    ] });
    await open();
    document.getElementById('volunteers-add').click();
    await flush();
    const kind = document.getElementById('volunteers-kind');
    kind.value = 'camp_aide';
    kind.dispatchEvent(new Event('change'));
    expect(document.getElementById('volunteers-kind-help').textContent).toBe('volunteers_requires');
    expect(kind.getAttribute('aria-describedby')).toBe('volunteers-kind-help');
  });

  test('a manager records what was verified; places then confirmed are announced', async () => {
    mockPermissions.add('volunteers.manage');
    getVolunteerShifts.mockResolvedValue({ data: [shift({
      id: 4, volunteer_type: 'camp_aide', title: '', slots: 2, taken: 1, pending: 1,
      requirements: ['background_check', 'safety_training'],
      volunteers: [{ user_id: '00000000-0000-4000-8000-000000000003', name: 'Mary Jackson', status: 'pending', missing: ['safety_training'] }],
    })] });
    getVolunteerRequirements.mockResolvedValue({ data: [{ requirement_key: 'background_check', valid_until: '2027-09-01' }] });
    saveVolunteerRequirements.mockResolvedValue({ data: { confirmed: 1 } });
    await open();
    expect(document.querySelector('.volunteers__status').textContent).toBe('volunteers_status_pending');
    const verify = document.querySelector('[data-verify]');
    expect(verify.getAttribute('aria-label')).toBe('volunteers_verify_person');
    verify.click();
    await flush();
    const form = document.getElementById('volunteers-verify-form');
    expect(form.elements.req_background_check.checked).toBe(true);
    expect(form.elements.until_background_check.value).toBe('2027-09-01');
    expect(form.querySelector('legend').textContent).toContain('volunteers_needed_here');
    expect((await axe.run(document.getElementById('volunteers-verify'), AXE_OPTIONS)).violations).toEqual([]);
    form.elements.req_safety_training.checked = true;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await flush();
    expect(saveVolunteerRequirements).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000003', {
      background_check: { valid_until: '2027-09-01' }, safety_training: { valid_until: null },
    });
    expect(app.showMessage).toHaveBeenCalledWith('volunteers_verified_confirmed', 'success');
  });
});
