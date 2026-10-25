/**
 * @jest-environment jsdom
 */

/**
 * "Who has the equipment" — the screen a leader uses at the end of a camp to
 * note who takes tents and tarps home, and later to check them back in.
 *
 * Held here: the camp's reserved equipment is listed without typing; a person
 * and a count per item is all a loan takes; nothing more than storage holds is
 * sent; a queued handout is not reported as recorded; returns are counts; the
 * screen is accessible and shows names as text.
 *
 * @module test/spa/EquipmentLoans
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
  CONFIG: {
    API_BASE_URL: 'https://unit.example.org',
    SUPPORTED_LANGS: ['en', 'fr'],
    EQUIPMENT_LOANS: { DEFAULT_LOAN_DAYS: 7, MAX_NOTE_LENGTH: 500 },
  },
}));

jest.mock('../../spa/utils/DOMUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/DOMUtils.js');
  return { ...actual, loadStylesheet: jest.fn(() => Promise.resolve()) };
});

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasAllPermissions: jest.fn(() => true),
  hasPermission: jest.fn(() => true),
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirm: jest.fn(() => Promise.resolve(true)),
  confirmDestructive: jest.fn(() => Promise.resolve(true)),
  hasActiveDialog: jest.fn(() => false),
}));

jest.mock('../../spa/api/api-equipment-loans.js', () => ({
  getEquipmentLoans: jest.fn(),
  getEquipmentHandout: jest.fn(),
  createEquipmentLoans: jest.fn(),
  updateEquipmentLoan: jest.fn(),
  deleteEquipmentLoan: jest.fn(),
}));

import axe from 'axe-core';
import * as api from '../../spa/api/api-equipment-loans.js';
import { hasAllPermissions, hasPermission } from '../../spa/utils/PermissionUtils.js';
import { confirmDestructive } from '../../spa/utils/DialogUtils.js';
import { closeAllModals } from '../../spa/utils/ModalUtils.js';
import { EquipmentLoans } from '../../spa/modules/resources/EquipmentLoans.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const HOSTILE = '<img src=x onerror=alert(1)>';
const LEADER_ID = '550e8400-e29b-41d4-a716-446655440000';

/** @returns {Promise<void>} Let pending promises settle */
async function flush() {
  for (let round = 0; round < 4; round += 1) {
    // eslint-disable-next-line no-await-in-loop -- each round lets the next promise in the chain settle
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const CAMP = { id: 5, name: 'Camp des Érables', start_date: '2026-10-17', end_date: '2026-10-19', has_reservations: true };

function handout(overrides = {}) {
  return {
    data: {
      activities: [CAMP],
      activity: CAMP,
      items: [
        { equipment_id: 3, name: 'Tente 4 places', quantity_total: 6, reserved_quantity: 5, out_quantity: 1, lent_for_activity: 0 },
        { equipment_id: 4, name: 'Bâche', quantity_total: 4, reserved_quantity: 2, out_quantity: 0, lent_for_activity: 0 },
      ],
      holders: {
        participants: [
          { id: 11, first_name: 'Ada', last_name: 'Lovelace' },
          { id: 12, first_name: HOSTILE, last_name: 'Tremblay' },
        ],
        adults: [{ id: LEADER_ID, full_name: 'Léa Tremblay' }],
      },
      reasons: ['drying', 'cleaning', 'repair', 'storage', 'other'],
      ...overrides,
    },
  };
}

const OPEN_LOANS = [
  {
    id: 21, equipment_id: 3, equipment_name: 'Tente 4 places', holder_type: 'participant', holder_participant_id: 11,
    holder_name: 'Ada Lovelace', quantity: 2, returned_quantity: 0, outstanding_quantity: 2, reason: 'drying',
    due_date: '2026-10-20', returned_at: null, overdue: true, activity_name: 'Camp des Érables',
  },
  {
    id: 22, equipment_id: 4, equipment_name: 'Bâche', holder_type: 'participant', holder_participant_id: 11,
    holder_name: 'Ada Lovelace', quantity: 1, returned_quantity: 0, outstanding_quantity: 1, reason: 'drying',
    due_date: '2026-11-01', returned_at: null, overdue: false,
  },
  {
    id: 23, equipment_id: 4, equipment_name: HOSTILE, holder_type: null, holder_name: null,
    quantity: 1, returned_quantity: 0, outstanding_quantity: 1, reason: 'repair', due_date: null, returned_at: null, overdue: false,
  },
];

let app;

async function openScreen() {
  const screen = new EquipmentLoans(app);
  await screen.init();
  await flush();
  return screen;
}

function addPerson(equipmentId) {
  document.querySelector(`[data-add-holder="${equipmentId}"]`).click();
}

function choose(select, value) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function submitHandout() {
  document.getElementById('equipment-loans-handout-form')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, '', '/equipment-loans');
  jest.clearAllMocks();
  hasAllPermissions.mockReturnValue(true);
  hasPermission.mockReturnValue(true);
  app = { lang: 'fr', showMessage: jest.fn() };
  api.getEquipmentLoans.mockResolvedValue({ data: { loans: OPEN_LOANS } });
  api.getEquipmentHandout.mockResolvedValue(handout());
  api.createEquipmentLoans.mockResolvedValue({ success: true, data: { loans: [] } });
  api.updateEquipmentLoan.mockResolvedValue({ success: true });
  api.deleteEquipmentLoan.mockResolvedValue({ success: true });
});

afterEach(() => {
  closeAllModals();
});

test('after a camp, the handout opens on the camp just over with its reserved equipment listed', async () => {
  api.getEquipmentHandout
    .mockResolvedValueOnce(handout({ activity: null, items: [] }))
    .mockResolvedValueOnce(handout());
  await openScreen();

  expect(api.getEquipmentHandout).toHaveBeenLastCalledWith(5, {});
  expect(document.getElementById('equipment-loans-activity').value).toBe('5');
  const legends = [...document.querySelectorAll('.equipment-loans__item legend')].map((legend) => legend.textContent);
  expect(legends).toEqual(['Tente 4 places', 'Bâche']);
  expect(document.getElementById('equipment-loans-remaining-3').textContent).toContain('equipment_loans_stays_in_storage');
});

test('a youth and a leader each take equipment home in a few taps', async () => {
  await openScreen();

  addPerson(3);
  choose(document.getElementById('equipment-loans-holder-3-0'), 'p:11');
  document.querySelector('[data-step="1"][data-equipment="3"][data-index="0"]').click();
  addPerson(4);
  // The person chosen last is offered first for the next item.
  expect(document.getElementById('equipment-loans-holder-4-0').value).toBe('p:11');
  choose(document.getElementById('equipment-loans-holder-4-0'), `u:${LEADER_ID}`);
  submitHandout();
  await flush();

  expect(api.createEquipmentLoans).toHaveBeenCalledWith({
    activity_id: 5,
    reason: 'drying',
    due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    notes: null,
    loans: [
      { equipment_id: 3, quantity: 2, participant_id: 11 },
      { equipment_id: 4, quantity: 1, user_id: LEADER_ID },
    ],
  });
  expect(app.showMessage).toHaveBeenCalledWith('equipment_loans_saved', 'success');
  expect(api.getEquipmentLoans).toHaveBeenLastCalledWith({ status: 'open' }, { forceRefresh: true });
});

test('a line without a person is pointed out next to its field and nothing is sent', async () => {
  await openScreen();
  addPerson(3);
  submitHandout();
  await flush();

  const select = document.getElementById('equipment-loans-holder-3-0');
  expect(api.createEquipmentLoans).not.toHaveBeenCalled();
  expect(select.getAttribute('aria-invalid')).toBe('true');
  const error = document.getElementById(select.getAttribute('aria-describedby'));
  expect(error.textContent).toBe('equipment_loans_person_required');
  expect(document.activeElement).toBe(select);

  choose(select, 'p:11');
  expect(error.textContent).toBe('');
});

test('more than storage holds is refused before sending', async () => {
  await openScreen();
  addPerson(3);
  choose(document.getElementById('equipment-loans-holder-3-0'), 'p:11');
  const quantity = document.getElementById('equipment-loans-quantity-3-0');
  quantity.value = '6';
  quantity.dispatchEvent(new Event('input', { bubbles: true }));

  expect(document.getElementById('equipment-loans-remaining-3').textContent).toContain('equipment_loans_too_many');
  expect(quantity.getAttribute('aria-invalid')).toBe('true');
  submitHandout();
  await flush();
  expect(api.createEquipmentLoans).not.toHaveBeenCalled();
});

test('submitting with no one chosen says what to do instead of sending an empty handout', async () => {
  await openScreen();
  submitHandout();
  await flush();

  expect(api.createEquipmentLoans).not.toHaveBeenCalled();
  expect(document.getElementById('equipment-loans-form-error').textContent).toBe('equipment_loans_nothing_to_record');
});

test('offline, the handout is said to be waiting, not recorded', async () => {
  api.createEquipmentLoans.mockResolvedValue({ queued: true, mutationId: 'm-1' });
  await openScreen();
  addPerson(4);
  choose(document.getElementById('equipment-loans-holder-4-0'), 'p:11');
  submitHandout();
  await flush();

  expect(app.showMessage).toHaveBeenCalledWith('equipment_loans_queued', 'info');
  expect(app.showMessage).not.toHaveBeenCalledWith('equipment_loans_saved', 'success');
  expect(document.querySelectorAll('.equipment-loans__row')).toHaveLength(0);
});

test('a refused handout is explained in the form', async () => {
  const refusal = new Error('Conflict');
  refusal.status = 409;
  refusal.data = { message: 'equipment_loan_exceeds_stock' };
  api.createEquipmentLoans.mockRejectedValue(refusal);
  await openScreen();
  addPerson(4);
  choose(document.getElementById('equipment-loans-holder-4-0'), 'p:11');
  submitHandout();
  await flush();

  expect(document.getElementById('equipment-loans-form-error').textContent).not.toBe('');
  expect(app.showMessage).not.toHaveBeenCalledWith('equipment_loans_saved', 'success');
});

test('loans still out are grouped by person, overdue said in words, and a former member keeps the loan', async () => {
  await openScreen();

  const groups = [...document.querySelectorAll('.equipment-loans__group h3')].map((heading) => heading.textContent);
  expect(groups).toEqual(['Ada Lovelace', 'equipment_loans_former_member']);
  const overdue = document.querySelector('.equipment-loans__loan.is-overdue');
  expect(overdue.textContent).toContain('equipment_loans_overdue');
});

test('names and items coming from people show as text', async () => {
  await openScreen();

  expect(document.querySelector('#app img')).toBeNull();
  expect(document.getElementById('app').textContent).toContain(HOSTILE);
  addPerson(3);
  expect(document.querySelector('#app img')).toBeNull();
  const youthOption = [...document.querySelectorAll('option')].find((option) => option.value === 'p:12');
  expect(youthOption.textContent).toContain(HOSTILE);
});

test('one tap records a full return, and "All returned" returns everything a person has', async () => {
  await openScreen();
  document.querySelector('[data-return="21"]').click();
  await flush();
  expect(api.updateEquipmentLoan).toHaveBeenCalledWith(21, { returned_quantity: 2 });
  expect(app.showMessage).toHaveBeenCalledWith('equipment_loans_returned', 'success');

  api.updateEquipmentLoan.mockClear();
  document.querySelector('[data-return-all]').click();
  await flush();
  expect(api.updateEquipmentLoan.mock.calls).toEqual([
    [21, { returned_quantity: 2 }],
    [22, { returned_quantity: 1 }],
  ]);
});

test('a partial return is entered in an accessible dialog and sent as the new total', async () => {
  await openScreen();
  const opener = document.querySelector('[data-partial="21"]');
  opener.focus();
  opener.click();
  await flush();

  const overlay = document.querySelector('#equipment-loans-partial-modal');
  expect(overlay).not.toBeNull();
  expect(document.activeElement.id).toBe('equipment-loans-partial-count');
  const results = await axe.run(overlay, AXE_OPTIONS);
  expect(results.violations).toEqual([]);

  const count = document.getElementById('equipment-loans-partial-count');
  count.value = '5';
  document.getElementById('equipment-loans-partial-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await flush();
  expect(api.updateEquipmentLoan).not.toHaveBeenCalled();
  expect(count.getAttribute('aria-invalid')).toBe('true');

  count.value = '1';
  document.getElementById('equipment-loans-partial-note').value = 'Une sardine manque';
  document.getElementById('equipment-loans-partial-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await flush();
  expect(api.updateEquipmentLoan).toHaveBeenCalledWith(21, { returned_quantity: 1, return_note: 'Une sardine manque' });
});

test('Escape closes the partial return without changing anything and focus goes back', async () => {
  await openScreen();
  const opener = document.querySelector('[data-partial="21"]');
  opener.focus();
  opener.click();
  await flush();

  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush();
  expect(document.querySelector('#equipment-loans-partial-modal')).toBeNull();
  expect(api.updateEquipmentLoan).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(opener);
});

test('deleting a loan asks first, and declining changes nothing', async () => {
  confirmDestructive.mockResolvedValueOnce(false);
  await openScreen();
  document.querySelector('[data-delete="22"]').click();
  await flush();
  expect(api.deleteEquipmentLoan).not.toHaveBeenCalled();

  document.querySelector('[data-delete="22"]').click();
  await flush();
  expect(api.deleteEquipmentLoan).toHaveBeenCalledWith(22);
});

test('a handout under way survives recording a return below it', async () => {
  await openScreen();
  addPerson(3);
  choose(document.getElementById('equipment-loans-holder-3-0'), 'p:11');
  document.querySelector('[data-step="1"][data-equipment="3"][data-index="0"]').click();

  document.querySelector('[data-return="22"]').click();
  await flush();

  expect(api.getEquipmentLoans).toHaveBeenLastCalledWith({ status: 'open' }, { forceRefresh: true });
  expect(document.getElementById('equipment-loans-holder-3-0').value).toBe('p:11');
  expect(document.getElementById('equipment-loans-quantity-3-0').value).toBe('2');
});

test('a reload keeps "No activity" when the leader chose it', async () => {
  await openScreen();
  choose(document.getElementById('equipment-loans-activity'), '');
  await flush();
  expect(api.getEquipmentHandout).toHaveBeenLastCalledWith(null, {});

  document.querySelector('[data-return="22"]').click();
  await flush();
  expect(api.getEquipmentHandout).toHaveBeenLastCalledWith(null, { forceRefresh: true });
  expect(document.getElementById('equipment-loans-activity').value).toBe('');
});

test('someone who may lend but not see the roster checks loans back in without the handout', async () => {
  hasAllPermissions.mockReturnValue(false);
  await openScreen();

  expect(api.getEquipmentHandout).not.toHaveBeenCalled();
  expect(document.getElementById('equipment-loans-handout-form')).toBeNull();
  document.querySelector('[data-return="22"]').click();
  await flush();
  expect(api.updateEquipmentLoan).toHaveBeenCalledWith(22, { returned_quantity: 1 });
});

test('someone who may only look sees the loans without the handout or the buttons', async () => {
  hasAllPermissions.mockReturnValue(false);
  hasPermission.mockReturnValue(false);
  await openScreen();

  expect(api.getEquipmentHandout).not.toHaveBeenCalled();
  expect(document.getElementById('equipment-loans-handout-form')).toBeNull();
  expect(document.querySelector('[data-return]')).toBeNull();
  expect(document.getElementById('app').textContent).toContain('Ada Lovelace');
});

test('a failed load is an error with a retry, never an empty list', async () => {
  api.getEquipmentLoans.mockRejectedValueOnce(new Error('offline'));
  await openScreen();

  expect(document.querySelector('[role="alert"]').textContent).toBe('error_loading_data');
  expect(document.querySelector('.back-link, a[href]')).not.toBeNull();
  document.getElementById('equipment-loans-retry').click();
  await flush();
  expect(document.getElementById('app').textContent).toContain('Ada Lovelace');
});

test('with nothing out, the list says what would fill it', async () => {
  api.getEquipmentLoans.mockResolvedValue({ data: { loans: [] } });
  await openScreen();
  expect(document.getElementById('app').textContent).toContain('equipment_loans_none_out');
});

test('a response arriving after leaving the screen does not draw over the next one', async () => {
  let resolveLoans;
  api.getEquipmentLoans.mockReturnValueOnce(new Promise((resolve) => { resolveLoans = resolve; }));
  const screen = new EquipmentLoans(app);
  const pending = screen.init();
  screen.destroy();
  document.getElementById('app').textContent = 'next screen';
  resolveLoans({ data: { loans: OPEN_LOANS } });
  await pending;
  await flush();
  expect(document.getElementById('app').textContent).toBe('next screen');
});

test('the screen, with a handout under way, has no WCAG A/AA violation', async () => {
  await openScreen();
  addPerson(3);
  const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});
