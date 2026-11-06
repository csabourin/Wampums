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

describe('submitting the standalone form while a save is on its way', () => {
  /** @returns {{ handler: DynamicFormHandler, app: Object, form: HTMLFormElement }} */
  function standaloneForm() {
    const app = { showMessage: jest.fn(), router: { navigate: jest.fn() } };
    const handler = new DynamicFormHandler(app);
    handler.formType = 'fiche_sante';
    handler.participantId = CHILD_ID;
    document.getElementById('app').innerHTML = '<form id="f"><input name="allergie" value="arachides">'
      + '<p class="dynamic-form-status" role="status"></p><button type="submit">save</button></form>';
    const form = document.getElementById('f');
    form.addEventListener('submit', (event) => handler.handleSubmit(event));
    return { handler, app, form };
  }
  const submit = (form) => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  test('a second submit during a slow save sends nothing more, and the form says it is saving', async () => {
    let finish;
    saveFormSubmission.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { app, form } = standaloneForm();

    submit(form);
    submit(form);
    await flush();

    expect(saveFormSubmission).toHaveBeenCalledTimes(1);
    expect(form.getAttribute('aria-busy')).toBe('true');
    expect(form.querySelector('button').disabled).toBe(true);
    expect(form.querySelector('[role="status"]').textContent).toBe('saving');

    finish({ success: true, data: { id: 3 } });
    await flush();

    expect(app.showMessage).toHaveBeenCalledTimes(1);
    expect(app.showMessage).toHaveBeenCalledWith('form_saved_successfully', 'success');
    expect(app.router.navigate).toHaveBeenCalledTimes(1);
  });

  test('after a refused save, what was typed stays and the form can be sent again', async () => {
    saveFormSubmission.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 503 }));
    const { app, form } = standaloneForm();

    submit(form);
    await flush();

    expect(app.router.navigate).not.toHaveBeenCalled();
    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(form.elements.allergie.value).toBe('arachides');
    expect(form.hasAttribute('aria-busy')).toBe(false);
    expect(form.querySelector('button').disabled).toBe(false);
    expect(form.querySelector('[role="status"]').textContent).toBe('');

    saveFormSubmission.mockResolvedValueOnce({ success: true, data: { id: 3 } });
    submit(form);
    await flush();

    expect(saveFormSubmission).toHaveBeenCalledTimes(2);
    expect(saveFormSubmission).toHaveBeenLastCalledWith('fiche_sante', CHILD_ID, { allergie: 'arachides' });
    expect(app.router.navigate).toHaveBeenCalledWith('/parent-dashboard');
  });
});

test('the standalone form, saving status included, passes axe', async () => {
  const app = { showMessage: jest.fn(), router: { navigate: jest.fn() } };
  const handler = new DynamicFormHandler(app);
  await handler.init('fiche_sante', null, { allergie: '' }, null, false, null, {
    fields: [{ name: 'allergie', type: 'text', label: 'allergie_label' }],
  });

  const form = document.querySelector('#dynamic-form-fiche_sante');
  expect(form.querySelector('[role="status"]')).not.toBeNull();
  const results = await axe.run(document.getElementById('app'), {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});
