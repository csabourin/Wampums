/**
 * @jest-environment jsdom
 */

/**
 * Correcting a medication plan (#1379), as a parent does it on their child's page: an "Edit"
 * button per plan, the form filled with that plan, a "before → after" check of what changes what
 * is given, a save on the same plan naming the version it started from, nothing typed lost on a
 * failure, and a plan changed by someone else meanwhile shown rather than overwritten. The team
 * sees who changed a plan and when, a dose left at a time the plan no longer has, and an
 * authorization a correction set aside. Every person here is invented.
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { DEFAULT_LANG: 'fr', CACHE_DURATION: {} },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDate: (value) => String(value ?? ''),
  formatClockTime: (value) => String(value ?? ''),
  getTodayISO: () => '2026-11-15',
  parseDate: (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`) : null),
}));
jest.mock('../../spa/indexedDB.js', () => ({
  getCachedData: jest.fn(),
  getCachedDataIgnoreExpiration: jest.fn(),
  setCachedData: jest.fn(),
  deleteCachedData: jest.fn(),
  clearMedicationCaches: jest.fn(),
}));
const mockFamily = { value: true };
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canManageMedication: jest.fn(() => false),
  canViewMedication: jest.fn(() => true),
  holdsFamilyRole: () => mockFamily.value,
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ confirm: jest.fn() }));
jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({ buildApiCacheKey: jest.fn((key) => key) }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: { campMode: false, isOffline: false, isDatePrepared: () => false },
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getActivities: jest.fn(),
  getParticipants: jest.fn(),
  getMedicationRequirements: jest.fn(),
  getParticipantMedications: jest.fn(),
  getMedicationDistributions: jest.fn(),
  saveMedicationRequirement: jest.fn(),
  recordMedicationDistribution: jest.fn(),
  markMedicationDistributionAsGiven: jest.fn(),
  getFicheMedications: jest.fn(),
  getFicheMedicationDeclarations: jest.fn(),
  getMedicationReceptions: jest.fn(),
  getFirstAidSupplies: jest.fn(),
  getMedicationAuthorizations: jest.fn(),
  saveTreatmentAuthorization: jest.fn(),
  saveAdministrationAuthorization: jest.fn(),
  getGuardiansForParticipant: jest.fn(),
  getLeaders: jest.fn(),
}));

import * as api from '../../spa/api/api-endpoints.js';
import { confirm } from '../../spa/utils/DialogUtils.js';
import { canManageMedication } from '../../spa/utils/PermissionUtils.js';
import { MedicationManagement } from '../../spa/modules/medication/MedicationManagement.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const CHILD = { id: 5, first_name: 'Rosalind', last_name: 'Tremblay' };
const PLAN = Object.freeze({
  id: 11, participant_id: 5, medication_name: 'Ventolin', dosage_instructions: 'Avec de l’eau',
  frequency_preset_type: 'time_of_day', frequency_times: ['08:00'], frequency_text: 'matin',
  route: 'Inhalée', default_dose_amount: '2.00', default_dose_unit: 'bouffées',
  general_notes: 'Dans son sac', start_date: '2026-11-01', end_date: null,
  updated_at: '2026-11-07T15:00:00.000Z', revisions: [],
});

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const page = () => document.getElementById('app');
const makeApp = () => ({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } });
const form = () => document.getElementById('medicationRequirementForm');
const editButton = () => page().querySelector('[data-edit-requirement="11"]');

function load(plan = PLAN, distributions = []) {
  api.getParticipants.mockResolvedValue({ success: true, data: [CHILD] });
  api.getMedicationRequirements.mockResolvedValue({ success: true, data: { requirements: [plan] } });
  api.getParticipantMedications.mockResolvedValue({ success: true, data: { participant_medications: [
    { id: 1, medication_requirement_id: plan.id, participant_id: 5 },
  ] } });
  api.getMedicationDistributions.mockResolvedValue({ success: true, data: { distributions } });
  api.getFicheMedications.mockResolvedValue({ success: true, data: { medications: [] } });
  api.getFicheMedicationDeclarations.mockResolvedValue({ success: true, data: { declarations: [] } });
  api.getMedicationReceptions.mockResolvedValue({ success: true, data: { receptions: [] } });
}

async function openChildPage(app = makeApp()) {
  const screen = new MedicationManagement(app, { view: 'planning', participantId: 5, returnUrl: '/parent-dashboard' });
  await screen.init();
  return screen;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  document.head.innerHTML = '';
  jest.clearAllMocks();
  mockFamily.value = true;
  canManageMedication.mockReturnValue(false);
});

describe('a parent correcting their child\'s plan', () => {
  test('each plan offers "Edit", named after the medication and the child', async () => {
    load();
    const screen = await openChildPage();

    expect(editButton().tagName).toBe('BUTTON');
    expect(editButton().getAttribute('aria-label')).toBe('medication_edit_plan_for');
    expect(editButton().textContent.trim()).toBe('medication_edit_plan');
    screen.destroy();
  });

  test('"Edit" fills the form with the plan, titles it after the plan and moves the focus there', async () => {
    load();
    const screen = await openChildPage();

    editButton().click();

    expect(form().elements.medication_name.value).toBe('Ventolin');
    expect(form().elements.default_dose_amount.value).toBe('2');
    expect(form().elements.default_dose_unit.value).toBe('bouffées');
    expect(form().elements.general_notes.value).toBe('Dans son sac');
    expect(form().elements.start_date.value).toBe('2026-11-01');
    expect(form().querySelector('input[name="frequency_times"]').value).toBe('08:00');
    expect(document.activeElement.id).toBe('medicationRequirementFormTitle');
    expect(form().querySelector('button[type="submit"]').textContent.trim()).toBe('medication_save_changes');
    expect((await axe.run(page(), AXE_OPTIONS)).violations).toEqual([]);
    screen.destroy();
  });

  test('cancelling sends nothing and returns the focus to that plan\'s "Edit" button', async () => {
    load();
    const screen = await openChildPage();
    editButton().click();
    form().elements.default_dose_amount.value = '9';

    document.getElementById('medicationRequirementCancelEdit').click();

    expect(api.saveMedicationRequirement).not.toHaveBeenCalled();
    expect(document.getElementById('medicationRequirementCancelEdit')).toBeNull();
    expect(document.activeElement).toBe(editButton());
    screen.destroy();
  });

  test('a dose change is shown before → after, then saved on the same plan with the version it started from', async () => {
    load();
    confirm.mockResolvedValue(true);
    api.saveMedicationRequirement.mockResolvedValue({ success: true, data: { requirement: { id: 11 }, revision: { requires_new_signature: false } } });
    const app = makeApp();
    const screen = await openChildPage(app);
    editButton().click();
    form().elements.default_dose_amount.value = '4';

    form().querySelector('button[type="submit"]').click();
    await flush(); await flush();

    expect(confirm.mock.calls[0][0].message).toContain('medication_plan_change_line');
    expect(api.saveMedicationRequirement).toHaveBeenCalledWith(expect.objectContaining({
      id: 11, expected_updated_at: '2026-11-07T15:00:00.000Z', default_dose_amount: 4, participant_ids: [5],
    }));
    expect(app.showMessage).toHaveBeenCalledWith('medication_plan_corrected', 'success');
    screen.destroy();
  });

  test('a note alone is saved without asking to confirm', async () => {
    load();
    api.saveMedicationRequirement.mockResolvedValue({ success: true, data: { requirement: { id: 11 }, revision: {} } });
    const screen = await openChildPage();
    editButton().click();
    form().elements.general_notes.value = 'Dans la pochette avant';

    form().querySelector('button[type="submit"]').click();
    await flush(); await flush();

    expect(confirm).not.toHaveBeenCalled();
    expect(api.saveMedicationRequirement).toHaveBeenCalledTimes(1);
    screen.destroy();
  });

  test('declining the check sends nothing and keeps the form as typed', async () => {
    load();
    confirm.mockResolvedValue(false);
    const screen = await openChildPage();
    editButton().click();
    form().elements.default_dose_amount.value = '4';

    form().querySelector('button[type="submit"]').click();
    await flush();

    expect(api.saveMedicationRequirement).not.toHaveBeenCalled();
    expect(form().elements.default_dose_amount.value).toBe('4');
    screen.destroy();
  });

  test('a correction that fails keeps what was typed and says why', async () => {
    load();
    confirm.mockResolvedValue(true);
    api.saveMedicationRequirement.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    const app = makeApp();
    const screen = await openChildPage(app);
    editButton().click();
    form().elements.default_dose_amount.value = '4';

    form().querySelector('button[type="submit"]').click();
    await flush(); await flush();

    expect(form().elements.default_dose_amount.value).toBe('4');
    expect(form().querySelector('button[type="submit"]').disabled).toBe(false);
    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    screen.destroy();
  });

  test('a plan someone else changed meanwhile is reloaded and the person told, not overwritten', async () => {
    load();
    confirm.mockResolvedValue(true);
    api.saveMedicationRequirement.mockRejectedValue(Object.assign(
      new Error('API request failed: medication_requirement_changed'), { status: 409 },
    ));
    const app = makeApp();
    const screen = await openChildPage(app);
    editButton().click();
    form().elements.default_dose_amount.value = '4';
    load({ ...PLAN, default_dose_amount: '3.00', updated_at: '2026-11-07T16:00:00.000Z' });

    form().querySelector('button[type="submit"]').click();
    await flush(); await flush(); await flush();

    expect(app.showMessage).toHaveBeenCalledWith('medication_requirement_changed', 'error');
    expect(document.getElementById('medicationRequirementCancelEdit')).toBeNull();
    expect(api.getMedicationRequirements).toHaveBeenLastCalledWith(expect.objectContaining({ forceRefresh: true }), expect.anything());
    screen.destroy();
  });

  test('another adult\'s correction that sets the signature aside says it must be signed again', async () => {
    load();
    confirm.mockResolvedValue(true);
    api.saveMedicationRequirement.mockResolvedValue({ success: true, data: { requirement: { id: 11 }, revision: { requires_new_signature: true } } });
    const app = makeApp();
    const screen = await openChildPage(app);
    editButton().click();
    form().elements.default_dose_amount.value = '4';

    form().querySelector('button[type="submit"]').click();
    await flush(); await flush();

    expect(app.showMessage).toHaveBeenCalledWith('medication_plan_corrected_signature_needed', 'info');
    screen.destroy();
  });
});

describe('what everyone sees of a corrected plan', () => {
  test('the plan says when it was modified and lists who changed what, names as text', async () => {
    load({ ...PLAN, revisions: [{
      changed_by_name: HOSTILE, changed_at: '2026-11-07T15:00:00.000Z', requires_new_signature: true,
      changes: { default_dose_amount: { from: 1, to: 2 }, general_notes: { from: null, to: HOSTILE } },
    }] });
    const screen = await openChildPage();

    const history = page().querySelector('.medication-plan-history');
    expect(history.tagName).toBe('DETAILS');
    expect(history.textContent).toContain(HOSTILE);
    expect(history.textContent).toContain('medication_plan_history_signature');
    expect(page().querySelector('.medication-plan-modified').textContent).toBe('medication_plan_modified_on');
    expect(page().querySelector('img')).toBeNull();
    expect((await axe.run(page(), AXE_OPTIONS)).violations).toEqual([]);
    screen.destroy();
  });

  test('the team, holding no family role, is not offered to edit a plan', async () => {
    mockFamily.value = false;
    canManageMedication.mockReturnValue(true);
    load();
    const screen = await openChildPage();

    expect(editButton()).toBeNull();
    screen.destroy();
  });

  test('a dose still scheduled at a time the corrected plan no longer has is pointed out to the team', async () => {
    mockFamily.value = false;
    canManageMedication.mockReturnValue(true);
    const at = (hour) => new Date(2026, 10, 16, hour, 0).toISOString();
    load(PLAN, [
      { id: 1, medication_requirement_id: 11, participant_id: 5, scheduled_for: at(8), status: 'scheduled' },
      { id: 2, medication_requirement_id: 11, participant_id: 5, scheduled_for: at(12), status: 'scheduled' },
    ]);
    const screen = new MedicationManagement(makeApp(), { view: 'dispensing' });
    await screen.init();

    const rows = [...document.querySelectorAll('#medication-upcoming-table-body tr')];
    expect(rows.map((row) => Boolean(row.querySelector('.medication-off-plan')))).toEqual([false, true]);
    expect(rows[1].querySelector('.medication-off-plan').textContent).toBe('medication_dose_off_plan');
    screen.destroy();
  });

  test('an authorization set aside by another adult\'s correction asks to be signed again, as an alert', async () => {
    load();
    api.getFirstAidSupplies.mockResolvedValue({ success: true, data: [] });
    api.getGuardiansForParticipant.mockResolvedValue({ success: true, data: [] });
    api.getLeaders.mockResolvedValue({ success: true, data: [] });
    api.getMedicationAuthorizations.mockResolvedValue({ success: true, data: {
      treatment: null,
      administration: { id: 3, status: 'plan_changed', date_signature: '2026-11-01', requirements: [] },
    } });
    const screen = new MedicationManagement(makeApp(), { view: 'authorizations', participantId: 5 });
    await screen.init();
    await flush();

    const notice = page().querySelector('#admin-auth-card .status-message.warning');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toBe('medication_auth_plan_changed');
    expect(page().querySelector('#admin-auth-card').textContent).not.toContain('signed_on');
    screen.destroy();
  });
});
