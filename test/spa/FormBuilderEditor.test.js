/**
 * @jest-environment jsdom
 */

/**
 * Form builder: saving a field and reordering fields
 *
 * The field editor's "Enregistrer le champ" button sits in the modal footer,
 * outside the form, and is tied to it by `form="field-editor-form"`. The HTML
 * sanitizer stripped that attribute, so the button submitted nothing and every
 * modal built the same way was dead. These tests click the real button through
 * the real sanitizer and modal, rather than calling saveField() directly.
 *
 * @module test/spa/FormBuilderEditor
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

// config.js and the API layer use import.meta, which Jest's CommonJS transform
// cannot parse. Neither is exercised here: the builder is driven in memory.
jest.mock('../../spa/config.js', () => ({ CONFIG: {} }));
jest.mock('../../spa/api/api-core.js', () => ({ API: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../../spa/ajax-functions.js', () => ({
  getOrganizationFormFormats: jest.fn(),
  getFormSubmission: jest.fn(),
  saveFormSubmission: jest.fn()
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirmDestructive: jest.fn()
}));

import { FormBuilder } from '../../spa/modules/forms/FormBuilder.js';
import { sanitizeHTML } from '../../spa/utils/SecurityUtils.js';
import { closeAllModals } from '../../spa/utils/ModalUtils.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } }
};

const LANGUAGE_FIELD = {
  name: 'langue_maison',
  type: 'select',
  label: 'langue_maison_label',
  options: [
    { label: 'francais', value: 'fr' },
    { label: 'autre', value: 'autre' }
  ]
};

const OTHER_LANGUAGES_FIELD = {
  name: 'autres_langues',
  type: 'text',
  label: 'autres_langues_label',
  dependsOn: { field: 'langue_maison', value: 'autre' }
};

const CITY_FIELD = { name: 'ville', type: 'text', label: 'ville_label' };

/**
 * A builder holding copies of the given fields, with its list rendered.
 *
 * @param {Object[]} fields - Initial fields
 * @returns {FormBuilder} The builder
 */
function builderWith(fields) {
  document.body.innerHTML = '<div id="fields-container"></div>';
  const builder = new FormBuilder({ showMessage: jest.fn() });
  builder.currentFields = fields.map((field) => JSON.parse(JSON.stringify(field)));
  builder.updateFieldsList();
  return builder;
}

/**
 * The footer button that saves the field editor.
 *
 * @returns {HTMLButtonElement} The save button
 */
function saveButton() {
  return document.querySelector('#field-editor-modal .modal-footer button[type="submit"]');
}

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

describe('Sanitizer keeps a footer button tied to its form', () => {
  it('keeps the form attribute', () => {
    expect(sanitizeHTML('<button type="submit" form="field-editor-form">Save</button>'))
      .toContain('form="field-editor-form"');
  });

  it('still drops formaction, which could send the form elsewhere', () => {
    const html = sanitizeHTML('<button type="submit" form="f" formaction="javascript:alert(1)">Save</button>');
    expect(html).not.toContain('formaction');
    expect(html).not.toContain('javascript:');
  });
});

describe('Form builder: the save button', () => {
  it('is associated with the field editor form', () => {
    const builder = builderWith([LANGUAGE_FIELD, OTHER_LANGUAGES_FIELD]);
    builder.renderFieldEditor(1);

    expect(saveButton().form).toBe(document.getElementById('field-editor-form'));
  });

  it('saves the edited field and closes the editor when clicked', () => {
    const builder = builderWith([LANGUAGE_FIELD, OTHER_LANGUAGES_FIELD]);
    builder.renderFieldEditor(1);

    document.getElementById('field-required').checked = true;
    saveButton().click();

    expect(builder.currentFields[1]).toMatchObject({
      name: 'autres_langues',
      required: true,
      dependsOn: { field: 'langue_maison', value: 'autre' }
    });
    expect(document.getElementById('field-editor-modal')).toBeNull();
  });

  it('adds a new field when clicked from "Ajouter un champ"', () => {
    const builder = builderWith([CITY_FIELD]);
    builder.renderFieldEditor();

    document.getElementById('field-name').value = 'province';
    document.getElementById('field-label').value = 'province_label';
    saveButton().click();

    expect(builder.currentFields.map((field) => field.name)).toEqual(['ville', 'province']);
  });

  it('names every option control and its remove button', async () => {
    const builder = builderWith([LANGUAGE_FIELD]);
    builder.renderFieldEditor(0);
    document.getElementById('add-option').click();

    const rows = document.querySelectorAll('#options-container .option-item');
    expect(rows).toHaveLength(3);
    expect(rows[2].querySelector('.option-label').getAttribute('aria-label')).toBe('label_key 3');
    expect(rows[2].querySelector('.option-value').getAttribute('aria-label')).toBe('value 3');
    expect(rows[2].querySelector('.remove-option').getAttribute('aria-label')).toBe('remove_option 3');
    expect(document.activeElement).toBe(rows[2].querySelector('.option-label'));

    const results = await axe.run(document.getElementById('field-editor-modal'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

describe('Form builder: moving fields up and down', () => {
  it('keeps focus on the same arrow after moving a field', () => {
    const builder = builderWith([CITY_FIELD, LANGUAGE_FIELD, OTHER_LANGUAGES_FIELD]);
    const down = document.querySelector('.field-item[data-field-index="0"] .move-down');
    down.focus();
    down.click();

    expect(builder.currentFields.map((field) => field.name)).toEqual(['langue_maison', 'ville', 'autres_langues']);
    expect(document.activeElement).toBe(document.querySelector('.field-item[data-field-index="1"] .move-down'));
  });

  it('falls back to the row when the field reaches the top', () => {
    const builder = builderWith([CITY_FIELD, LANGUAGE_FIELD]);
    const up = document.querySelector('.field-item[data-field-index="1"] .move-up');
    up.focus();
    up.click();

    expect(builder.currentFields[0].name).toBe('langue_maison');
    expect(document.activeElement).toBe(document.querySelector('.field-item[data-field-index="0"]'));
  });

  it('renders a named list of fields with no WCAG A/AA violations', async () => {
    builderWith([CITY_FIELD, LANGUAGE_FIELD, OTHER_LANGUAGES_FIELD]);

    const list = document.querySelector('.fields-sortable');
    expect(list.getAttribute('role')).toBe('list');
    document.querySelectorAll('.move-up, .move-down').forEach((button) => {
      expect(button.getAttribute('aria-label')).toMatch(/^move_(up|down)$/);
    });

    const results = await axe.run(document.getElementById('fields-container'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
