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
  canManageMedication: () => true,
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
    form.innerHTML = '<input name="medication_name" value="Advil"><input name="participant_id" value="5">';

    await screen.handleRequirementSubmit({ preventDefault: () => {}, target: form });

    const messages = app.showMessage.mock.calls.map(([message]) => message);
    expect(messages).toContain('medication_requirement_saved');
    expect(messages).not.toContain('error_saving');
    expect(screen.requirements.some((requirement) => requirement.medication_name === 'Advil')).toBe(true);
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
