/**
 * @jest-environment jsdom
 */

/**
 * The health form and the risk acceptance form open, and save.
 *
 * Both pages read fetchParticipant() as if it returned the participant; it
 * returns { success, participant }. The health form also read the guardian
 * list as an array (the API answers { success, data }), set up its dynamic
 * form before the form's container was on the page, and failed as a whole
 * when the contacts could not be read. The risk acceptance form treated "no
 * answer yet" (a 404, every new child) as a failure. And a successful save
 * of a dynamic form threw on its own confirmation message. Every one of these
 * ended on the error page.
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

// DateUtils reads the SPA config, which uses import.meta.
jest.mock('../../spa/utils/DateUtils.js', () => ({
  getTodayISO: () => '2026-09-28',
  formatDateShort: (value, lang) => `${lang}:${value}`,
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  fetchParticipant: jest.fn(),
  fetchParents: jest.fn(),
  getCurrentOrganizationId: jest.fn(),
  fetchAcceptationRisque: jest.fn(),
  saveAcceptationRisque: jest.fn(),
  getOrganizationFormFormats: jest.fn(),
  getFormSubmission: jest.fn(),
  saveFormSubmission: jest.fn(),
}));

import {
  fetchParticipant,
  fetchParents,
  getCurrentOrganizationId,
  fetchAcceptationRisque,
  saveFormSubmission,
} from '../../spa/ajax-functions.js';
import { FicheSante } from '../../spa/fiche_sante.js';
import { AcceptationRisque } from '../../spa/acceptation_risque.js';
import { DynamicFormHandler } from '../../spa/dynamicFormHandler.js';

const CHILD_ID = 1;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
const LEA = { id: CHILD_ID, first_name: '<b>Léa</b>', last_name: 'Parent', date_naissance: '2016-05-01' };

/**
 * An API error as the API layer throws it.
 *
 * @param {number} status - HTTP status
 * @returns {Error} The error
 */
function apiError(status) {
  const error = new Error('API request failed');
  error.status = status;
  return error;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  fetchParticipant.mockResolvedValue({ success: true, participant: LEA });
  getCurrentOrganizationId.mockResolvedValue(1);
});

describe('health form', () => {
  let containerAtInit;

  beforeEach(() => {
    containerAtInit = undefined;
    jest.spyOn(DynamicFormHandler.prototype, 'init').mockImplementation(async function init(formType, id, data, container) {
      containerAtInit = document.getElementById(container);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('opens with the child, the emergency contacts, and the dynamic form in its container', async () => {
    fetchParents.mockResolvedValue({
      success: true,
      data: [{ id: 7, prenom: 'Marie', nom: '<i>Parent</i>', telephone_cellulaire: '819-555-0101', is_emergency_contact: true }],
    });

    await new FicheSante({ lang: 'fr' }).init(CHILD_ID);

    const app = document.getElementById('app');
    expect(app.querySelector('h1').textContent).toBe('fiche_sante');
    expect(app.textContent).toContain('<b>Léa</b> Parent');
    // The birth date goes through the locale-aware formatter, in the page's language.
    expect(app.textContent).toContain('fr:2016-05-01');
    expect(app.querySelector('b, i')).toBeNull();
    expect(app.querySelector('#emergency_contact_7').checked).toBe(true);
    expect(containerAtInit).not.toBeNull();
    expect(containerAtInit.id).toBe('fiche-sante-container');
  });

  test('still opens, without the contacts section, when the contacts cannot be read', async () => {
    fetchParents.mockRejectedValue(apiError(FORBIDDEN));

    await new FicheSante({}).init(CHILD_ID);

    const app = document.getElementById('app');
    expect(app.querySelector('h1').textContent).toBe('fiche_sante');
    expect(app.querySelector('input[name="emergency_contacts[]"]')).toBeNull();
  });
});

describe('risk acceptance form', () => {
  test('opens empty for a child with no answer yet', async () => {
    fetchAcceptationRisque.mockRejectedValue(apiError(NOT_FOUND));

    await new AcceptationRisque({}).init(CHILD_ID);

    const app = document.getElementById('app');
    expect(app.querySelector('#acceptation-risque-form')).not.toBeNull();
    expect(app.querySelector('#groupe_district').value).toBe('');
    expect(app.textContent).toContain('<b>Léa</b> Parent');
  });

  test('opens with the saved answer', async () => {
    fetchAcceptationRisque.mockResolvedValue({
      success: true,
      data: { groupe_district: 'Meute 6A', nom_parent_tuteur: 'Marie Parent', accepte_risques: 1 },
    });

    await new AcceptationRisque({}).init(CHILD_ID);

    expect(document.getElementById('groupe_district').value).toBe('Meute 6A');
    expect(document.getElementById('nom_parent_tuteur').value).toBe('Marie Parent');
    expect(document.getElementById('accepte_risques').checked).toBe(true);
  });

  test('shows the error page for any other failure', async () => {
    fetchAcceptationRisque.mockRejectedValue(apiError(FORBIDDEN));

    await new AcceptationRisque({}).init(CHILD_ID);

    expect(document.getElementById('acceptation-risque-form')).toBeNull();
    expect(document.querySelector('#app h1').textContent).toBe('error');
  });
});

describe('dynamic form save', () => {
  test('a successful save confirms through the app and returns the result', async () => {
    saveFormSubmission.mockResolvedValue({ success: true, data: { id: 3 } });
    const app = { showMessage: jest.fn() };
    const handler = new DynamicFormHandler(app);
    handler.formType = 'fiche_sante';
    handler.participantId = CHILD_ID;

    await expect(handler.saveFormData({ allergie: 'aucune' })).resolves.toEqual({ success: true, data: { id: 3 } });
    expect(app.showMessage).toHaveBeenCalledWith('form_saved_successfully', 'success');
  });
});
