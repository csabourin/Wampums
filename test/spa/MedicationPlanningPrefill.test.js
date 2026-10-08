/**
 * @jest-environment jsdom
 *
 * Medication planning prefilled from the health form.
 *
 * A medication a parent declared on the fiche santé is offered in the planning
 * form, one unplanned line at a time, without overwriting what the user typed.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn()
}));
jest.mock('../../spa/utils/SecurityUtils.js', () => ({
  escapeHTML: (value) => String(value ?? '')
}));
jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDate: (value) => value,
  getTodayISO: () => '2026-10-08'
}));
jest.mock('../../spa/indexedDB.js', () => ({}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => {
    element.innerHTML = html;
  }
}));
jest.mock('../../spa/utils/OptimisticUpdateManager.js', () => ({
  OptimisticUpdateManager: jest.fn()
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canManageMedication: () => false,
  canViewMedication: () => false
}));
jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({ buildApiCacheKey: jest.fn() }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: {} }));

const { MedicationManagement } = require('../../spa/medication_management.js');

/**
 * Build the planning form with the parts the prefill touches.
 *
 * @returns {HTMLFormElement} The form
 */
function buildForm() {
  document.body.innerHTML = `
    <form id="medicationRequirementForm">
      <input name="medication_name" />
      <textarea name="general_notes"></textarea>
      <p id="medicationPrefillHint" hidden></p>
      <div id="declaredMedications" hidden></div>
    </form>`;
  return document.getElementById('medicationRequirementForm');
}

/**
 * The declared medications listed in the form.
 *
 * @returns {Array<{name: string, planned: boolean}>} Listed buttons
 */
function listed() {
  return [...document.querySelectorAll('[data-declared-medication]')]
    .map((button) => ({ name: button.dataset.declaredMedication, planned: button.disabled }));
}

describe('Medication planning prefill', () => {
  let planning;

  beforeEach(() => {
    planning = new MedicationManagement({}, { view: 'planning' });
    planning.ficheDeclarations = new Map([[5, 'Vyvance\nLanzoprazole, Amlodipine']]);
  });

  it('lists each declared medication and fills the first one', () => {
    const form = buildForm();

    planning.applyDeclaredPrefill(form, 5);

    expect(form.elements.medication_name.value).toBe('Vyvance');
    expect(form.elements.general_notes.value).toBe('');
    expect(listed()).toEqual([
      { name: 'Vyvance', planned: false },
      { name: 'Lanzoprazole', planned: false },
      { name: 'Amlodipine', planned: false }
    ]);
    expect(document.getElementById('medicationPrefillHint').hidden).toBe(false);
  });

  it('moves on to the next medication once one is planned', () => {
    planning.requirements = [{ id: 1, medication_name: 'vyvance' }];
    planning.participantMedications = [{ participant_id: 5, medication_requirement_id: 1 }];
    const form = buildForm();

    planning.applyDeclaredPrefill(form, 5);

    expect(form.elements.medication_name.value).toBe('Lanzoprazole');
    expect(listed()[0]).toEqual({ name: 'Vyvance', planned: true });
  });

  it('never overwrites what the user typed', () => {
    const form = buildForm();
    form.elements.medication_name.value = 'Advil';

    planning.applyDeclaredPrefill(form, 5);

    expect(form.elements.medication_name.value).toBe('Advil');
  });

  it('clears its own prefill when another participant is chosen', () => {
    const form = buildForm();
    planning.applyDeclaredPrefill(form, 5);

    planning.applyDeclaredPrefill(form, 6);

    expect(form.elements.medication_name.value).toBe('');
    expect(listed()).toEqual([]);
    expect(document.getElementById('declaredMedications').hidden).toBe(true);
    expect(document.getElementById('medicationPrefillHint').hidden).toBe(true);
  });
});
