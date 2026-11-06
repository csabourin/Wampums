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

import axe from 'axe-core';
import { getFormSubmission, saveFormSubmission } from '../../spa/ajax-functions.js';
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

  test('the open form says whose it is, under the way back', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    getFormSubmission.mockResolvedValue({ success: true, form_data: { first_name: hostile } });
    const handler = new DynamicFormHandler({ showMessage: jest.fn() });

    await handler.init('fiche_sante', CHILD_ID, {}, null, false, null, {
      fields: [{ type: 'text', name: 'medecin', label: 'medecin' }],
    });

    const app = document.getElementById('app');
    expect(app.firstElementChild.tagName).toBe('A');
    expect(app.firstElementChild.getAttribute('href')).toBe('/dashboard');
    const heading = app.querySelector('h1');
    expect(heading.textContent).toBe(`fiche_sante — ${hostile}`);
    expect(app.querySelector('img')).toBeNull();
    expect(app.querySelector('button[type="submit"]').className).toBe('button button--primary');
    const results = await axe.run(app, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  describe('a parent who forgets to answer', () => {
    const FIELDS = [
      { type: 'radio', name: 'has_allergies', label: 'has_allergies_label', required: true,
        options: [{ label: 'yes_label', value: 'yes' }, { label: 'no_label', value: 'no' }] },
      { type: 'select', name: 'niveau_natation', label: 'niveau_natation_label',
        options: [{ label: 'ne_sait_pas_nager_label', value: 'ne_sait_pas_nager' }, { label: 'eau_profonde_label', value: 'eau_profonde' }] },
      { type: 'checkbox', name: 'declaration_exactitude', label: 'declaration_label', required: true },
    ];

    /** @returns {Promise<{handler: DynamicFormHandler, app: Object, form: HTMLFormElement}>} Open health form */
    async function open() {
      getFormSubmission.mockResolvedValue({ success: true, form_data: { first_name: 'Léa' } });
      const app = { showMessage: jest.fn(), router: { navigate: jest.fn() } };
      const handler = new DynamicFormHandler(app);
      await handler.init('fiche_sante', CHILD_ID, {}, null, false, null, { fields: FIELDS });
      return { handler, app, form: document.querySelector('form') };
    }
    const submit = async (form) => {
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    };

    test('required questions are announced as such, and the form says what the asterisk means', async () => {
      await open();
      const group = document.querySelector('[role="radiogroup"]');
      expect(group.getAttribute('aria-required')).toBe('true');
      expect(document.getElementById(group.getAttribute('aria-labelledby')).textContent).toBe('has_allergies_label');
      expect(document.getElementById(group.getAttribute('aria-labelledby')).className).toBe('label--required');
      expect(document.querySelector('.form-required-note').textContent).toBe('form_required_note');
    });

    test('an optional list starts without an answer instead of choosing one for the parent', async () => {
      await open();
      const select = document.querySelector('select[name="niveau_natation"]');
      expect(select.value).toBe('');
      expect(select.options[0].textContent).toBe('select_option');
    });

    test('nothing is sent; each missing answer is named at the top and explained under its question', async () => {
      const { form } = await open();

      await submit(form);

      expect(saveFormSubmission).not.toHaveBeenCalled();
      const summary = document.getElementById('dynamic-form-errors');
      expect(summary.hidden).toBe(false);
      expect(document.activeElement).toBe(summary);
      expect(summary.querySelector('p').textContent).toBe('form_missing_answers');
      expect([...summary.querySelectorAll('button')].map((button) => button.textContent))
        .toEqual(['has_allergies_label', 'declaration_label']);
      document.querySelectorAll('input[name="has_allergies"]').forEach((radio) => {
        expect(radio.getAttribute('aria-invalid')).toBe('true');
        expect(document.getElementById(radio.getAttribute('aria-describedby')).textContent).toBe('field_required');
      });
      const results = await axe.run(document.getElementById('app'), {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(results.violations).toEqual([]);

      summary.querySelector('button').click();
      expect(document.activeElement.name).toBe('has_allergies');
    });

    test('answering a question removes its message, and a complete form is saved with a success message', async () => {
      const { form, app } = await open();
      await submit(form);

      const no = document.getElementById('has_allergies_no');
      no.checked = true;
      no.dispatchEvent(new Event('change', { bubbles: true }));
      expect(document.getElementById('dynamic-form-error-has_allergies')).toBeNull();
      expect(no.hasAttribute('aria-invalid')).toBe(false);

      const box = form.querySelector('input[name="declaration_exactitude"]');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      saveFormSubmission.mockResolvedValue({ success: true });
      await submit(form);

      expect(saveFormSubmission).toHaveBeenCalledWith('fiche_sante', CHILD_ID, expect.objectContaining({ has_allergies: 'no' }));
      expect(app.showMessage).toHaveBeenCalledWith('form_saved_successfully', 'success');
    });
  });
});

