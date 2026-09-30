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
});
