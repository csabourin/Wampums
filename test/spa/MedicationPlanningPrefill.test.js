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
jest.mock('../../spa/utils/DOMUtils.js', () => ({ setContent: jest.fn() }));
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
 * Build the planning form with the two fields the prefill touches.
 *
 * @returns {HTMLFormElement} The form
 */
function buildForm() {
  document.body.innerHTML = `
    <form id="medicationRequirementForm">
      <input name="medication_name" />
      <textarea name="general_notes"></textarea>
      <p id="medicationPrefillHint" hidden></p>
    </form>`;
  return document.getElementById('medicationRequirementForm');
}

describe('Medication planning prefill', () => {
  let planning;

  beforeEach(() => {
    planning = new MedicationManagement({}, { view: 'planning' });
    planning.ficheDeclarations = new Map([[5, 'Ventolin\nRitalin 10 mg']]);
  });

  it('fills the first declared medication and the whole declaration', () => {
    const form = buildForm();

    planning.applyDeclaredPrefill(form, 5);

    expect(form.elements.medication_name.value).toBe('Ventolin');
    expect(form.elements.general_notes.value).toBe('Ventolin\nRitalin 10 mg');
    expect(document.getElementById('medicationPrefillHint').hidden).toBe(false);
  });

  it('skips a medication already planned for the participant', () => {
    planning.requirements = [{ id: 1, medication_name: 'ventolin' }];
    planning.participantMedications = [{ participant_id: 5, medication_requirement_id: 1 }];
    const form = buildForm();

    planning.applyDeclaredPrefill(form, 5);

    expect(form.elements.medication_name.value).toBe('Ritalin 10 mg');
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
    expect(form.elements.general_notes.value).toBe('');
    expect(document.getElementById('medicationPrefillHint').hidden).toBe(true);
  });
});
