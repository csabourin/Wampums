/**
 * @jest-environment jsdom
 */

/**
 * Saving the Parent/Guardian section of a child's registration form.
 *
 * Each guardian is saved to its own contact record, which the API links to
 * the child. Fields a unit added to the parent_guardian form are kept on the
 * child's own form submission, per guardian: form_submissions is keyed by
 * participant, and a guardian id there would point at an unrelated child.
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

  test('keeps custom fields on the child\'s submission, per guardian, never under a guardian id', async () => {
    const form = formWithTwoGuardians();

    await form.saveGuardians(CHILD_ID, [
      { nom: 'Parent', prenom: 'Marie', courriel: 'marie@example.test', employeur: 'CCN' },
      { nom: 'Gagnon', prenom: 'Carole', courriel: 'carole@example.test', employeur: 'Ville' },
    ]);

    expect(saveFormSubmission).toHaveBeenCalledTimes(1);
    expect(saveFormSubmission).toHaveBeenCalledWith('parent_guardian', CHILD_ID, {
      guardians: {
        [EXISTING_GUARDIAN_ID]: { employeur: 'CCN' },
        [NEW_GUARDIAN_ID]: { employeur: 'Ville' },
      },
    });
  });

  test('writes no submission when the form has only the standard fields', async () => {
    const form = formWithTwoGuardians();

    await form.saveGuardians(CHILD_ID, [
      { nom: 'Parent', prenom: 'Marie', courriel: 'marie@example.test' },
      { nom: 'Gagnon', prenom: 'Carole', courriel: 'carole@example.test' },
    ]);

    expect(saveFormSubmission).not.toHaveBeenCalled();
  });
});
