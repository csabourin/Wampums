/**
 * @jest-environment jsdom
 */

/**
 * Medication planning, dispensing and reception, held to CLAUDE.md §7.
 *
 * Here "nothing" is dangerous: a reception list that did not load must not
 * read as no medication handed in, declarations that did not load must not
 * read as none declared, and a dose the server recorded must never be shown
 * as not given. Each screen also shows the way back, a loading state, and an
 * error with a retry, and saves a change once, not once per redraw.
 *
 * @module test/spa/MedicationScreens
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
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
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canManageMedication: jest.fn(() => true),
  canViewMedication: () => true,
}));
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
  saveMedicationReception: jest.fn(),
  updateMedicationReception: jest.fn(),
  saveMedicationRequirementReception: jest.fn(),
}));

import * as api from '../../spa/api/api-endpoints.js';
import { canManageMedication } from '../../spa/utils/PermissionUtils.js';
import { MedicationManagement } from '../../spa/modules/medication/MedicationManagement.js';
import { MedicationReception } from '../../spa/modules/medication/MedicationReception.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE = '<img src=x onerror=alert(1)>';
const PARTICIPANT = { id: 5, first_name: HOSTILE, last_name: 'Roy' };
const REQUIREMENT = { id: 11, medication_name: HOSTILE, dosage_instructions: '1 co', frequency_text: 'matin' };
const ASSIGNMENT = { id: 1, medication_requirement_id: 11, participant_id: 5 };
const ACTIVITY = { id: 3, name: HOSTILE, activity_start_date: '2026-11-15', activity_end_date: '2026-11-16' };

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const page = () => document.getElementById('app');
const makeApp = () => ({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } });

/** @returns {Promise<Array>} axe violations inside #app */
async function violations() {
  return (await axe.run(page(), AXE_OPTIONS)).violations;
}

function loadAll() {
  api.getActivities.mockResolvedValue({ success: true, data: [ACTIVITY] });
  api.getParticipants.mockResolvedValue({ success: true, data: [PARTICIPANT] });
  api.getMedicationRequirements.mockResolvedValue({ success: true, data: { requirements: [REQUIREMENT] } });
  api.getParticipantMedications.mockResolvedValue({ success: true, data: { participant_medications: [ASSIGNMENT] } });
  api.getMedicationDistributions.mockResolvedValue({ success: true, data: { distributions: [] } });
  api.getFicheMedications.mockResolvedValue({ success: true, data: { medications: [] } });
  api.getFicheMedicationDeclarations.mockResolvedValue({ success: true, data: { declarations: [] } });
  api.getMedicationReceptions.mockResolvedValue({ success: true, data: { receptions: [] } });
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  document.head.innerHTML = '';
  jest.clearAllMocks();
});

describe('medication planning and dispensing', () => {
  test.each([null, 'not_received'])('medication not received (%s) is never reported as already given', async (status) => {
    loadAll();
    api.getMedicationReceptions.mockResolvedValue({ success: true, data: { receptions: status ? [{
      participant_id: 5, medication_requirement_id: 11, status,
    }] : [] } });
    const screen = new MedicationManagement(makeApp(), { view: 'dispensing' });
    await screen.init();

    expect(page().querySelector('#participant-medication-cards-pending').textContent).toContain('medication_awaiting_reception');
    expect(page().textContent).not.toContain('medication_all_distributed_today');
    screen.destroy();
  });

  test('received medication with an outstanding dose remains available to dispense', async () => {
    loadAll();
    api.getMedicationReceptions.mockResolvedValue({ success: true, data: { receptions: [{
      participant_id: 5, medication_requirement_id: 11, status: 'received',
    }] } });
    const screen = new MedicationManagement(makeApp(), { view: 'dispensing' });
    await screen.init();

    expect(page().querySelector('#participant-medication-cards-pending .participant-med-card')).not.toBeNull();
    expect(page().textContent).not.toContain('medication_all_distributed_today');
    screen.destroy();
  });

  test.each(['planning', 'dispensing'])('the %s view says it is loading, with the way back', async (view) => {
    loadAll();
    let resolve;
    api.getParticipants.mockReturnValue(new Promise((done) => { resolve = done; }));
    const screen = new MedicationManagement(makeApp(), { view });
    const done = screen.init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('h1').textContent).toBe(`medication_${view}_title`);
    expect(page().querySelector('[aria-busy="true"] [role="status"]')).not.toBeNull();
    resolve({ success: true, data: [PARTICIPANT] });
    await done;
    screen.destroy();
  });

  test('passes axe once loaded and shows names as text', async () => {
    loadAll();
    const screen = new MedicationManagement(makeApp(), { view: 'planning' });
    await screen.init();

    expect(page().querySelector('img[src="x"]')).toBeNull();
    expect(await violations()).toEqual([]);
    screen.destroy();
  });

  test('a failed load is an error with a retry, never an empty plan', async () => {
    loadAll();
    api.getMedicationRequirements.mockRejectedValueOnce(new Error('offline'));
    const screen = new MedicationManagement(makeApp(), { view: 'planning' });
    await screen.init();

    expect(page().querySelector('h1').textContent).toBe('medication_planning_title');
    expect(page().querySelector('[role="alert"]').textContent).toBe('error_loading_data');
    expect(page().querySelector('#page-retry')).not.toBeNull();
    screen.destroy();
  });

  test('health-form declarations that did not load are said to be missing, not shown as none', async () => {
    loadAll();
    api.getFicheMedicationDeclarations.mockRejectedValue(new Error('offline'));
    const screen = new MedicationManagement(makeApp(), { view: 'planning' });
    await screen.init();

    expect(page().querySelector('[role="alert"]').textContent).toBe('med_reception_declarations_unavailable');
    screen.destroy();
  });

  test('on the dispensing view, receptions that did not load are said to be unknown', async () => {
    loadAll();
    api.getMedicationReceptions.mockRejectedValue(new Error('offline'));
    const screen = new MedicationManagement(makeApp(), { view: 'dispensing' });
    await screen.init();

    expect([...page().querySelectorAll('[role="alert"]')].map((alert) => alert.textContent))
      .toContain('medication_receptions_unavailable');
    screen.destroy();
  });

  test('a requirement the server saved is not rolled back when the reload after it fails', async () => {
    loadAll();
    const app = makeApp();
    const screen = new MedicationManagement(app, { view: 'planning' });
    await screen.init();
    api.saveMedicationRequirement.mockResolvedValue({ success: true, data: { id: 12 } });
    api.getMedicationRequirements.mockRejectedValueOnce(new Error('offline'));
    const form = document.createElement('form');
    form.innerHTML = '<input name="medication_name" value="Advil"><input name="participant_id" value="5">'
      + '<input name="frequency_preset_type" value="prn">';

    await screen.handleRequirementSubmit({ preventDefault: () => {}, target: form });

    const messages = app.showMessage.mock.calls.map(([message]) => message);
    expect(messages).toContain('medication_requirement_saved');
    expect(messages).not.toContain('error_saving');
    expect(screen.requirements.some((requirement) => requirement.medication_name === 'Advil')).toBe(true);
    screen.destroy();
  });
});

describe('planning a medication as a parent who does not touch the times', () => {
  /** @returns {Promise<{screen: MedicationManagement, form: HTMLFormElement}>} Loaded planning form */
  async function openPlanning() {
    loadAll();
    const screen = new MedicationManagement(makeApp(), { view: 'planning', participantId: 5 });
    await screen.init();
    const form = document.getElementById('medicationRequirementForm');
    form.elements.medication_name.value = 'Ritalin';
    return { screen, form };
  }
  const submit = (form) => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  const timeFields = () => [...document.querySelectorAll('#frequencyPresetFields input[type="time"]')];

  test('a parent is told what the page is for in their own terms, a leader in the team\'s', async () => {
    canManageMedication.mockReturnValue(false);
    let { screen } = await openPlanning();
    expect(page().querySelector('.subtitle').textContent).toBe('medication_planning_description_family');
    screen.destroy();

    canManageMedication.mockReturnValue(true);
    ({ screen } = await openPlanning());
    expect(page().querySelector('.subtitle').textContent).toBe('medication_planning_description');
    screen.destroy();
  });

  test('no time of day is chosen for the parent', async () => {
    const { screen } = await openPlanning();

    expect(timeFields().length).toBeGreaterThan(0);
    expect(timeFields().map((field) => field.value)).toEqual(timeFields().map(() => ''));
    screen.destroy();
  });

  test('no meal is ticked for the parent either', async () => {
    const { screen } = await openPlanning();
    const preset = document.getElementById('frequencyPreset');
    preset.value = 'meal';
    preset.dispatchEvent(new Event('change', { bubbles: true }));

    const meals = [...document.querySelectorAll('#frequencyPresetFields input[type="checkbox"]')];
    expect(meals.length).toBeGreaterThan(0);
    expect(meals.some((meal) => meal.checked)).toBe(false);
    screen.destroy();
  });

  test('saving times of day without any time sends nothing and says why, next to the times', async () => {
    const { screen, form } = await openPlanning();

    submit(form);
    await flush();

    expect(api.saveMedicationRequirement).not.toHaveBeenCalled();
    const message = document.getElementById('medicationFrequencyError');
    expect(message.hidden).toBe(false);
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toBe('medication_frequency_times_required');
    timeFields().forEach((field) => {
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.getAttribute('aria-describedby')).toBe('medicationFrequencyError');
    });
    expect(document.activeElement).toBe(timeFields()[0]);
    expect(await violations()).toEqual([]);
    screen.destroy();
  });

  test('the message goes away once a time is chosen, and the schedule sent is that one time', async () => {
    const { screen, form } = await openPlanning();
    api.saveMedicationRequirement.mockResolvedValue({ success: true, data: { id: 12 } });
    submit(form);
    await flush();

    timeFields()[0].value = '08:00';
    timeFields()[0].dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('medicationFrequencyError').hidden).toBe(true);
    expect(timeFields()[0].hasAttribute('aria-invalid')).toBe(false);

    submit(form);
    await flush();
    expect(api.saveMedicationRequirement).toHaveBeenCalledWith(expect.objectContaining({
      frequency_preset_type: 'time_of_day',
      frequency_times: ['08:00'],
    }));
    screen.destroy();
  });

  test('a dose quantity without its unit is not sent', async () => {
    const { screen, form } = await openPlanning();
    const preset = document.getElementById('frequencyPreset');
    preset.value = 'prn';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    form.elements.default_dose_amount.value = '200';

    submit(form);
    await flush();

    expect(api.saveMedicationRequirement).not.toHaveBeenCalled();
    const unit = form.elements.default_dose_unit;
    expect(unit.getAttribute('aria-invalid')).toBe('true');
    expect(unit.getAttribute('aria-describedby')).toBe('medicationDoseUnitError');
    expect(document.getElementById('medicationDoseUnitError').textContent).toBe('medication_dose_unit_required');
    expect(document.activeElement).toBe(unit);

    unit.value = 'mg';
    unit.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('medicationDoseUnitError').hidden).toBe(true);
    screen.destroy();
  });

  test('the first and last day of the treatment are sent with the plan', async () => {
    const { screen, form } = await openPlanning();
    api.saveMedicationRequirement.mockResolvedValue({ success: true, data: { id: 12 } });
    const preset = document.getElementById('frequencyPreset');
    preset.value = 'prn';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    form.elements.start_date.value = '2026-12-01';
    form.elements.end_date.value = '2026-12-03';

    submit(form);
    await flush();

    expect(api.saveMedicationRequirement).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-12-01',
      end_date: '2026-12-03',
    }));
    screen.destroy();
  });

  test('a plan without dates is sent without dates', async () => {
    const { screen, form } = await openPlanning();
    api.saveMedicationRequirement.mockResolvedValue({ success: true, data: { id: 12 } });
    const preset = document.getElementById('frequencyPreset');
    preset.value = 'prn';
    preset.dispatchEvent(new Event('change', { bubbles: true }));

    submit(form);
    await flush();

    expect(api.saveMedicationRequirement).toHaveBeenCalledWith(expect.objectContaining({
      start_date: null,
      end_date: null,
    }));
    screen.destroy();
  });

  test('a treatment that ends before it starts is not sent, and the end date says why', async () => {
    const { screen, form } = await openPlanning();
    const preset = document.getElementById('frequencyPreset');
    preset.value = 'prn';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    form.elements.start_date.value = '2026-12-03';
    form.elements.end_date.value = '2026-12-01';

    submit(form);
    await flush();

    expect(api.saveMedicationRequirement).not.toHaveBeenCalled();
    const end = form.elements.end_date;
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect(end.getAttribute('aria-describedby')).toBe('medicationEndDateError');
    expect(document.getElementById('medicationEndDateError').textContent).toBe('medication_end_before_start');
    expect(document.activeElement).toBe(end);
    expect(await violations()).toEqual([]);

    end.value = '2026-12-04';
    end.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('medicationEndDateError').hidden).toBe(true);
    expect(end.hasAttribute('aria-invalid')).toBe(false);
    screen.destroy();
  });

  /** Fill a complete "only when needed" plan, ready to send. */
  function fillPlan(form) {
    const preset = document.getElementById('frequencyPreset');
    preset.value = 'prn';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    form.elements.general_notes.value = 'Avant le souper';
    form.elements.start_date.value = '2026-12-01';
  }
  const currentForm = () => document.getElementById('medicationRequirementForm');

  test('while the plan is being saved, what was typed stays and the form says it is saving', async () => {
    const { screen, form } = await openPlanning();
    let finish;
    api.saveMedicationRequirement.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    fillPlan(form);

    submit(form);
    await flush();
    submit(currentForm());
    await flush();

    expect(api.saveMedicationRequirement).toHaveBeenCalledTimes(1);
    expect(currentForm().getAttribute('aria-busy')).toBe('true');
    expect(currentForm().querySelector('button[type="submit"]').disabled).toBe(true);
    expect(currentForm().querySelector('button[type="submit"]').textContent).toBe('saving');
    expect(currentForm().elements.medication_name.value).toBe('Ritalin');
    expect(currentForm().elements.frequency_preset_type.value).toBe('prn');
    expect(currentForm().elements.general_notes.value).toBe('Avant le souper');

    finish({ success: true, data: { id: 12 } });
    await flush();
    screen.destroy();
  });

  test('a plan queued offline leaves a blank form, so Save cannot queue it twice', async () => {
    const { screen, form } = await openPlanning();
    api.saveMedicationRequirement.mockResolvedValue({ queued: true });
    fillPlan(form);

    submit(form);
    await flush();

    expect(screen.app.showMessage).toHaveBeenCalledWith('medication_offline_dose_queued', 'info');
    expect(currentForm().elements.medication_name.value).toBe('');
    expect(currentForm().elements.general_notes.value).toBe('');
    expect(currentForm().hasAttribute('aria-busy')).toBe(false);

    submit(currentForm());
    await flush();
    expect(api.saveMedicationRequirement).toHaveBeenCalledTimes(1);
    screen.destroy();
  });

  test('a refused save keeps every field, and sending again sends the same plan once', async () => {
    const { screen, form } = await openPlanning();
    const app = screen.app;
    api.saveMedicationRequirement.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 503 }));
    fillPlan(form);

    submit(form);
    await flush();

    const restored = currentForm();
    expect(restored.elements.medication_name.value).toBe('Ritalin');
    expect(restored.elements.frequency_preset_type.value).toBe('prn');
    expect(restored.elements.general_notes.value).toBe('Avant le souper');
    expect(restored.elements.start_date.value).toBe('2026-12-01');
    expect(restored.hasAttribute('aria-busy')).toBe(false);
    expect(restored.querySelector('button[type="submit"]').disabled).toBe(false);
    expect(document.activeElement).toBe(restored.querySelector('button[type="submit"]'));
    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(screen.requirements.some((requirement) => requirement.isOptimistic)).toBe(false);
    expect(await violations()).toEqual([]);

    api.saveMedicationRequirement.mockResolvedValueOnce({ success: true, data: { id: 12 } });
    submit(restored);
    await flush();

    expect(api.saveMedicationRequirement).toHaveBeenCalledTimes(2);
    expect(api.saveMedicationRequirement.mock.calls[1][0]).toEqual(api.saveMedicationRequirement.mock.calls[0][0]);
    expect(app.showMessage).toHaveBeenCalledWith('medication_requirement_saved', 'success');
    screen.destroy();
  });

  test('the planned medications show the treatment dates, formatted for the page', async () => {
    loadAll();
    api.getMedicationRequirements.mockResolvedValue({ success: true, data: { requirements: [{
      ...REQUIREMENT, start_date: '2026-12-01T05:00:00.000Z', end_date: '2026-12-03',
    }] } });
    const screen = new MedicationManagement(makeApp(), { view: 'planning', participantId: 5 });
    await screen.init();

    expect(page().textContent).toContain('2026-12-01 → 2026-12-03');
    screen.destroy();
  });

  test('the planned medications show the dose with its unit and the times it is given', async () => {
    loadAll();
    api.getMedicationRequirements.mockResolvedValue({ success: true, data: { requirements: [{
      ...REQUIREMENT, default_dose_amount: '10.00', default_dose_unit: 'mg',
      dosage_instructions: 'avec le déjeuner', frequency_text: 'Moments', frequency_times: ['08:00'],
    }] } });
    const screen = new MedicationManagement(makeApp(), { view: 'planning', participantId: 5 });
    await screen.init();

    const text = page().textContent;
    expect(text).toContain('10 mg · avec le déjeuner');
    expect(text).toContain('medication_frequency_with_times');
    expect(await violations()).toEqual([]);
    screen.destroy();
  });
});

describe('giving several doses at once', () => {
  const dose = (id) => ({
    id, organization_id: 1, medication_requirement_id: 11, participant_id: 5, participant_medication_id: 1,
    scheduled_for: '2026-11-15T13:00:00Z', status: 'scheduled', administered_at: null, witness_name: null,
  });

  afterEach(() => {
    api.markMedicationDistributionAsGiven.mockReset();
    api.getMedicationDistributions.mockReset();
  });

  async function openDispensing(app) {
    loadAll();
    api.getMedicationDistributions.mockResolvedValue({ success: true, data: { distributions: [dose(21), dose(22)] } });
    const screen = new MedicationManagement(app, { view: 'dispensing' });
    await screen.init();
    return screen;
  }

  test('a dose the server recorded stays given when another of the same batch fails', async () => {
    const app = makeApp();
    const screen = await openDispensing(app);
    api.markMedicationDistributionAsGiven
      .mockResolvedValueOnce({ success: true, data: { id: 21, status: 'given' } })
      .mockRejectedValueOnce(Object.assign(new Error('Server error'), { status: 500 }));
    // The reload after the batch cannot reach the server: what is shown must still be right.
    api.getMedicationDistributions.mockRejectedValue(new Error('offline'));

    await screen.handleMarkGiven([21, 22], 'slot');
    await flush();

    const status = (id) => screen.distributions.find((dist) => dist.id === id).status;
    expect(status(21)).toBe('given');
    expect(status(22)).toBe('scheduled');
    const messages = app.showMessage.mock.calls.map(([message]) => message);
    expect(messages).toContain('medication_mark_given_partial');
    expect(messages).not.toContain('medication_mark_given_success');
    screen.destroy();
  });

  test('offline, the copy kept on the device shows a refused dose still to give', async () => {
    const app = makeApp();
    const screen = await openDispensing(app);
    const { setCachedData } = require('../../spa/indexedDB.js');
    setCachedData.mockClear();
    api.markMedicationDistributionAsGiven
      .mockResolvedValueOnce({ success: true, queued: true })
      .mockRejectedValueOnce(Object.assign(new Error('Refused'), { status: 403 }));

    await screen.handleMarkGiven([21, 22], 'slot');
    await flush();

    const saved = setCachedData.mock.calls.filter(([key]) => key === 'medication_distributions').pop();
    const statuses = Object.fromEntries(saved[1].data.distributions.map((dist) => [dist.id, dist.status]));
    expect(statuses).toEqual({ 21: 'given', 22: 'scheduled' });
    screen.destroy();
  });

  test('a dose already given from another device counts as given, not as a failure', async () => {
    const app = makeApp();
    const screen = await openDispensing(app);
    api.markMedicationDistributionAsGiven
      .mockResolvedValueOnce({ success: true, data: { id: 21, status: 'given' } })
      .mockRejectedValueOnce(Object.assign(new Error('This dose has already been given and cannot be given again'), { status: 409 }));

    await screen.handleMarkGiven([21, 22], 'slot');
    await flush();

    const messages = app.showMessage.mock.calls.map(([message]) => message);
    expect(messages).toContain('medication_mark_given_success');
    expect(messages).not.toContain('medication_mark_given_partial');
    expect(messages).not.toContain('error_saving');
    screen.destroy();
  });

  test('when no dose of the batch could be recorded, every one goes back to "to give"', async () => {
    const app = makeApp();
    const screen = await openDispensing(app);
    api.markMedicationDistributionAsGiven.mockRejectedValue(Object.assign(new Error('Server error'), { status: 500 }));

    await screen.handleMarkGiven([21, 22], 'slot');
    await flush();

    expect(screen.distributions.map((dist) => dist.status)).toEqual(['scheduled', 'scheduled']);
    expect(app.showMessage.mock.calls.map(([message]) => message)).toContain('error_saving');
    screen.destroy();
  });
});

describe('medication reception', () => {
  test('passes axe, shows names as text and keeps the way back first', async () => {
    loadAll();
    const screen = new MedicationReception(makeApp(), { activityId: 3 });
    await screen.init();

    expect(page().querySelector('a').getAttribute('href')).toBe('/dashboard');
    expect(page().querySelector('img[src="x"]')).toBeNull();
    expect(page().textContent).toContain(HOSTILE);
    expect(await violations()).toEqual([]);
    screen.destroy();
  });

  test('receptions that did not load are an error with a retry, never "not received"', async () => {
    loadAll();
    api.getMedicationReceptions.mockRejectedValueOnce(new Error('offline'));
    const screen = new MedicationReception(makeApp(), { activityId: 3 });
    await screen.init();

    expect(page().querySelector('[role="alert"]').textContent).toBe('error_loading_data');
    expect(page().querySelector('.medication-reception-item')).toBeNull();

    page().querySelector('#page-retry').click();
    await flush();
    await flush();
    expect(page().querySelector('[role="alert"]')).toBeNull();
    screen.destroy();
  });

  test('declarations that did not load are said to be missing', async () => {
    loadAll();
    api.getFicheMedicationDeclarations.mockRejectedValue(new Error('offline'));
    const screen = new MedicationReception(makeApp(), { activityId: 3 });
    await screen.init();

    expect(page().querySelector('[role="alert"]').textContent).toBe('med_reception_declarations_unavailable');
    screen.destroy();
  });

  test('redrawing does not stack listeners: a status change is saved once', async () => {
    loadAll();
    api.saveMedicationReception.mockResolvedValue({ success: true });
    const screen = new MedicationReception(makeApp(), { activityId: 3 });
    await screen.init();
    // Redraw as the page does after a toggle.
    page().querySelector('#showAllParticipants').click();
    page().querySelector('#showAllParticipants').click();

    const radio = page().querySelector('.medication-reception-item input[type="radio"][value="received"]');
    radio.click();
    await flush();

    expect(api.saveMedicationReception).toHaveBeenCalledTimes(1);
    screen.destroy();
  });

  test('leaving releases the listeners it put on #app', async () => {
    loadAll();
    api.saveMedicationReception.mockResolvedValue({ success: true });
    const screen = new MedicationReception(makeApp(), { activityId: 3 });
    await screen.init();
    const radio = page().querySelector('.medication-reception-item input[type="radio"][value="received"]');

    screen.destroy();
    radio.click();
    await flush();

    expect(api.saveMedicationReception).not.toHaveBeenCalled();
  });

  test('only the children the chosen activity invites are listed', async () => {
    loadAll();
    const invited = { id: 6, first_name: 'Maxime', last_name: 'Tremblay' };
    const notInvited = { id: 8, first_name: 'Vincent', last_name: 'Gagnon' };
    api.getParticipants.mockResolvedValue({ success: true, data: [PARTICIPANT, invited, notInvited] });
    api.getParticipantMedications.mockResolvedValue({
      success: true,
      data: {
        participant_medications: [
          ASSIGNMENT,
          { id: 2, medication_requirement_id: 11, participant_id: 6 },
          { id: 3, medication_requirement_id: 11, participant_id: 8 },
        ],
      },
    });
    api.getMedicationReceptions.mockResolvedValue({
      success: true,
      data: { receptions: [], invited_participant_ids: [6] },
    });
    const screen = new MedicationReception(makeApp(), { activityId: 3 });
    await screen.init();

    const listed = () => [...page().querySelectorAll('.participant-reception-card h3')].map((name) => name.textContent);
    expect(listed()).toEqual(['Maxime Tremblay']);
    expect(page().textContent).toContain('med_reception_participants_only_notice');
    // Invitations and slips change elsewhere: the server is asked, the cache is only the offline copy.
    expect(api.getMedicationReceptions).toHaveBeenCalledWith({ activity_id: 3 }, { forceRefresh: true });

    // Showing everyone means every invited child, even without medication.
    page().querySelector('#showAllParticipants').click();
    expect(listed()).toEqual(['Maxime Tremblay']);
    expect(await violations()).toEqual([]);
    screen.destroy();
  });

  test('a child whose permission slip was declined is not listed', async () => {
    loadAll();
    const declined = { id: 6, first_name: 'Maxime', last_name: 'Tremblay' };
    api.getParticipants.mockResolvedValue({ success: true, data: [PARTICIPANT, declined] });
    api.getParticipantMedications.mockResolvedValue({
      success: true,
      data: { participant_medications: [ASSIGNMENT, { id: 2, medication_requirement_id: 11, participant_id: 6 }] },
    });
    api.getMedicationReceptions.mockResolvedValue({
      success: true,
      data: { receptions: [], invited_participant_ids: null, declined_participant_ids: [6] },
    });
    const screen = new MedicationReception(makeApp(), { activityId: 3 });
    await screen.init();

    const ids = () => [...page().querySelectorAll('.participant-reception-card')].map((card) => card.dataset.participantId);
    expect(ids()).toEqual(['5']);
    expect(page().textContent).toContain('med_reception_participants_only_notice');
    page().querySelector('#showAllParticipants').click();
    expect(ids()).toEqual(['5']);
    screen.destroy();
  });

  test('an activity for the whole unit lists every child with medication', async () => {
    loadAll();
    const other = { id: 6, first_name: 'Maxime', last_name: 'Tremblay' };
    api.getParticipants.mockResolvedValue({ success: true, data: [PARTICIPANT, other] });
    api.getParticipantMedications.mockResolvedValue({
      success: true,
      data: { participant_medications: [ASSIGNMENT, { id: 2, medication_requirement_id: 11, participant_id: 6 }] },
    });
    api.getMedicationReceptions.mockResolvedValue({
      success: true,
      data: { receptions: [], invited_participant_ids: null },
    });
    const screen = new MedicationReception(makeApp(), { activityId: 3 });
    await screen.init();

    expect(page().querySelectorAll('.participant-reception-card')).toHaveLength(2);
    expect(page().textContent).not.toContain('med_reception_participants_only_notice');
    screen.destroy();
  });

  test('marking everything received is not reported as done when a save failed', async () => {
    loadAll();
    const app = makeApp();
    const screen = new MedicationReception(app, { activityId: 3 });
    await screen.init();
    api.saveMedicationReception.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

    await screen.markAllReceived(5);

    const messages = app.showMessage.mock.calls.map(([message]) => message);
    expect(messages).not.toContain('med_reception_all_marked_received');
    expect(messages).toContain('api_error_forbidden');
    screen.destroy();
  });
});

describe('a dose or reception saved offline and refused on replay', () => {
  const refuse = (kind) => window.dispatchEvent(new CustomEvent('offlineMutationRejected', {
    detail: { url: '/api/v1/medication/distributions/9', method: 'PATCH', kind, mutationId: 'm-1', status: 409 },
  }));

  async function openDispensing() {
    loadAll();
    const screen = new MedicationManagement(makeApp(), { view: 'dispensing' });
    await screen.init();
    return screen;
  }

  test('the dispensing view drops its copy and reloads what the server recorded', async () => {
    const screen = await openDispensing();
    const loadsBefore = api.getMedicationDistributions.mock.calls.length;
    const reload = jest.spyOn(screen, 'reloadAfterRejectedChange');

    refuse('medication');
    await reload.mock.results[0].value;

    expect(api.getMedicationDistributions.mock.calls.length).toBeGreaterThan(loadsBefore);
    expect(page().querySelector('h1').textContent).toBe('medication_dispensing_title');
    screen.destroy();
  });

  test('a refused change of another kind reloads nothing', async () => {
    const screen = await openDispensing();
    const loadsBefore = api.getMedicationDistributions.mock.calls.length;

    refuse('attendance');
    await flush();

    expect(api.getMedicationDistributions.mock.calls.length).toBe(loadsBefore);
    screen.destroy();
  });

  test('once the person has left, a refusal draws nothing over the next page', async () => {
    const screen = await openDispensing();
    screen.destroy();
    page().textContent = 'next page';
    const loadsBefore = api.getMedicationDistributions.mock.calls.length;

    refuse('medication');
    await flush();

    expect(api.getMedicationDistributions.mock.calls.length).toBe(loadsBefore);
    expect(page().textContent).toBe('next page');
  });
});
