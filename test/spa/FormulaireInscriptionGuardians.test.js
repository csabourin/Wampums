/**
 * @jest-environment jsdom
 */

/**
 * Saving the Parent/Guardian section of a child's registration form.
 *
 * Each guardian is saved to its own contact record, which the API links to
 * the child. Fields a unit added to the parent_guardian form travel with the
 * guardian: the API keeps them on the child's own submission, per guardian,
 * under the same authorization. A guardian id is never a participant id, and
 * a parent is never sent through the forms route their role may not use.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  app: { showMessage: jest.fn() },
  translate: (key) => key,
}));

jest.mock('../../spa/dynamicFormHandler.js', () => ({
  DynamicFormHandler: jest.fn(),
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  getAuthHeader: jest.fn(),
  fetchParticipant: jest.fn(),
  saveFormSubmission: jest.fn(),
  getOrganizationFormFormats: jest.fn(),
  saveParticipant: jest.fn(),
  getGuardiansForParticipant: jest.fn(),
  saveGuardian: jest.fn(),
  linkUserParticipants: jest.fn(),
  linkParticipantToOrganization: jest.fn(),
  getCurrentOrganizationId: jest.fn(),
  fetchFromApi: jest.fn(),
}));

import { saveGuardian, saveFormSubmission } from '../../spa/ajax-functions.js';
import { FormulaireInscription } from '../../spa/formulaire_inscription.js';

const CHILD_ID = 42;
const EXISTING_GUARDIAN_ID = 7;
const NEW_GUARDIAN_ID = 9;

/**
 * A form with one guardian already on record and one offered from an account.
 *
 * @returns {FormulaireInscription} The form
 */
function formWithTwoGuardians() {
  const form = new FormulaireInscription({});
  form.formData = {
    guardians: [
      { guardian_id: EXISTING_GUARDIAN_ID, courriel: 'marie@example.test' },
      { guardian_id: null, account_user_id: '00000000-0000-0000-0000-00000000000c', courriel: 'carole@example.test' },
    ],
  };
  return form;
}

describe('saving the Parent/Guardian section', () => {
  beforeEach(() => {
    saveGuardian.mockReset();
    saveFormSubmission.mockReset();
    saveGuardian
      .mockResolvedValueOnce({ success: true, data: { guardian_id: EXISTING_GUARDIAN_ID } })
      .mockResolvedValueOnce({ success: true, data: { guardian_id: NEW_GUARDIAN_ID } });
    saveFormSubmission.mockResolvedValue({ success: true });
  });

  test('updates the loaded record and ties a new one to the offered account', async () => {
    const form = formWithTwoGuardians();

    await form.saveGuardians(CHILD_ID, [
      { nom: 'Parent', prenom: 'Marie', courriel: 'marie@example.test' },
      { nom: 'Gagnon', prenom: 'Carole', courriel: 'carole-edited@example.test' },
    ]);

    expect(saveGuardian.mock.calls[0][0]).toMatchObject({ participant_id: CHILD_ID, guardian_id: EXISTING_GUARDIAN_ID });
    expect(saveGuardian.mock.calls[0][0].account_user_id).toBeUndefined();
    expect(saveGuardian.mock.calls[1][0]).toMatchObject({
      participant_id: CHILD_ID,
      account_user_id: '00000000-0000-0000-0000-00000000000c',
    });
    expect(saveGuardian.mock.calls[1][0].guardian_id).toBeUndefined();
  });

  test('sends each guardian\'s custom fields with it, never as a separate submission', async () => {
    const form = formWithTwoGuardians();

    await form.saveGuardians(CHILD_ID, [
      { nom: 'Parent', prenom: 'Marie', courriel: 'marie@example.test', employeur: 'CCN' },
      { nom: 'Gagnon', prenom: 'Carole', courriel: 'carole@example.test', employeur: 'Ville' },
    ]);

    expect(saveGuardian.mock.calls[0][0].custom_fields).toEqual({ employeur: 'CCN' });
    expect(saveGuardian.mock.calls[1][0].custom_fields).toEqual({ employeur: 'Ville' });
    // Never under a guardian id, and never through the forms route parents may not use.
    expect(saveFormSubmission).not.toHaveBeenCalled();
  });

  test('sends no custom fields when the form has only the standard fields', async () => {
    const form = formWithTwoGuardians();

    await form.saveGuardians(CHILD_ID, [
      { nom: 'Parent', prenom: 'Marie', courriel: 'marie@example.test' },
      { nom: 'Gagnon', prenom: 'Carole', courriel: 'carole@example.test' },
    ]);

    expect(saveGuardian.mock.calls[0][0].custom_fields).toEqual({});
    expect(saveFormSubmission).not.toHaveBeenCalled();
  });
});
