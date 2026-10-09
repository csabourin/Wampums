/**
 * @jest-environment jsdom
 */

/**
 * The health and risk acceptance forms are dynamic forms
 * (/dynamic-form/<type>/<id>). A successful save of a dynamic form used to
 * throw on its own confirmation message and end on the error page.
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
  getOrganizationFormFormats: jest.fn(),
  getFormSubmission: jest.fn(),
  saveFormSubmission: jest.fn(),
}));

import { saveFormSubmission } from '../../spa/ajax-functions.js';
import { DynamicFormHandler } from '../../spa/dynamicFormHandler.js';

const CHILD_ID = 1;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
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

  test('a refused save is explained in the page language, not the server\'s English', async () => {
    saveFormSubmission.mockRejectedValue(
      Object.assign(new Error('API request failed: Insufficient permissions'), { status: 403 })
    );
    const app = { showMessage: jest.fn() };
    const handler = new DynamicFormHandler(app);
    handler.formType = 'fiche_sante';
    handler.participantId = CHILD_ID;

    await expect(handler.saveFormData({ allergie: 'aucune' })).rejects.toThrow();
    expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
  });

  test('the standalone form reports a failed submit the same way', async () => {
    saveFormSubmission.mockRejectedValue(
      Object.assign(new Error('API request failed: Participant ID, form_type, and submission_data are required'), { status: 400 })
    );
    const app = { showMessage: jest.fn(), router: { navigate: jest.fn() } };
    const handler = new DynamicFormHandler(app);
    handler.formType = 'fiche_sante';
    handler.participantId = CHILD_ID;
    document.getElementById('app').innerHTML = '<form id="f"><input name="a" value="1"></form>';

    await handler.handleSubmit({ preventDefault: jest.fn(), target: document.getElementById('f') });

    expect(app.showMessage).toHaveBeenCalledWith('api_error_invalid', 'error');
    expect(app.router.navigate).not.toHaveBeenCalled();
  });
});
