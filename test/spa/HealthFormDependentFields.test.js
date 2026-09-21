/**
 * @jest-environment jsdom
 */

/**
 * Dependent fields of a saved form (fiche santé allergy box)
 *
 * The allergy textarea only exists when `has_allergies` says yes, so the form
 * format marks it `dependsOn`. The renderer used to disable every dependent
 * field on every render, whatever the saved answers said. On a fiche santé that
 * already declares an allergy, that had two consequences: the parent could not
 * edit the allergy, and the standalone form — which submits through `FormData`,
 * where a disabled input is simply absent — dropped the allergy from the next
 * save. Both end with a child missing from the allergy report.
 *
 * @module test/spa/HealthFormDependentFields
 */

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

// dynamicFormHandler pulls in ajax-functions -> config.js, which uses
// import.meta and cannot be parsed by Jest's CommonJS transform. The network
// layer is irrelevant here: the toggle under test only reads the document.
jest.mock('../../spa/ajax-functions.js', () => ({
  getOrganizationFormFormats: jest.fn(),
  getFormSubmission: jest.fn(),
  saveFormSubmission: jest.fn()
}));

import { JSONFormRenderer } from '../../spa/JSONFormRenderer.js';
import { isDependencySatisfied } from '../../spa/utils/FormDependencyUtils.js';
import { DynamicFormHandler } from '../../spa/dynamicFormHandler.js';

const FICHE_SANTE_FIELDS = {
  fields: [
    {
      name: 'has_allergies',
      type: 'radio',
      label: 'has_allergies_label',
      options: [
        { label: 'yes_label', value: 'yes' },
        { label: 'no_label', value: 'no' }
      ],
      required: true
    },
    {
      name: 'allergie',
      type: 'textarea',
      label: 'allergie_label',
      required: true,
      dependsOn: { field: 'has_allergies', value: 'yes' }
    }
  ]
};

/**
 * Render the fiche santé fields against a submission and hand back the DOM.
 *
 * @param {Object} formData - Saved submission data
 * @returns {HTMLElement} Container holding the rendered form
 */
function renderWith(formData) {
  const renderer = new JSONFormRenderer(FICHE_SANTE_FIELDS, formData, 'fiche_sante');
  const container = document.createElement('form');
  container.innerHTML = renderer.render();
  return container;
}

describe('Dependent field state on a saved form', () => {
  it('leaves the allergy box editable when the form declares an allergy', () => {
    const form = renderWith({ has_allergies: 'yes', allergie: 'Arachides' });

    const allergyBox = form.querySelector('[name="allergie"]');
    expect(allergyBox.disabled).toBe(false);
    expect(allergyBox.value).toBe('Arachides');
  });

  it.each([
    ['a boolean checkbox', true],
    ['an "on" checkbox', 'on'],
    ['a "1" checkbox', '1'],
    ['a French radio', 'oui']
  ])('recognises %s as satisfying the dependency', (_label, answer) => {
    const form = renderWith({ has_allergies: answer, allergie: 'Arachides' });

    expect(form.querySelector('[name="allergie"]').disabled).toBe(false);
  });

  it('keeps the allergy box submitted when the form is saved untouched', () => {
    // FormData is what the standalone dynamic form submits with, and it skips
    // disabled inputs — this is the assertion that pins the data loss.
    const form = renderWith({ has_allergies: 'yes', allergie: 'Arachides' });

    expect(new FormData(form).get('allergie')).toBe('Arachides');
  });

  it('still disables the allergy box when no allergy is declared', () => {
    const form = renderWith({ has_allergies: 'no' });

    expect(form.querySelector('[name="allergie"]').disabled).toBe(true);
  });

  it('still disables the allergy box on an empty form', () => {
    const form = renderWith({});

    expect(form.querySelector('[name="allergie"]').disabled).toBe(true);
  });

  it('hides the allergy box until an allergy is declared', () => {
    // Greying the box out still left an irrelevant field on screen. The whole
    // group is hidden instead, and comes back the moment the answer is yes.
    const unanswered = renderWith({});
    const answered = renderWith({ has_allergies: 'yes', allergie: 'Arachides' });

    expect(
      unanswered.querySelector('[name="allergie"]').closest('.form-group').className
    ).toContain('form-group--hidden');
    expect(
      answered.querySelector('[name="allergie"]').closest('.form-group').className
    ).not.toContain('form-group--hidden');
  });
});

describe('Radio option markup', () => {
  it('wraps the options so they can sit beside the question', () => {
    // `.form-group` is a column flex container, so bare input/label pairs put
    // every option on a line of its own under the question.
    const form = renderWith({});
    const group = form.querySelector('.radio-group[data-field-name="has_allergies"]');

    expect(group).not.toBeNull();
    expect(group.querySelectorAll('.radio-option')).toHaveLength(2);
    expect(group.querySelectorAll('.radio-option input[type="radio"]')).toHaveLength(2);
  });
});

describe('Toggling a dependency live', () => {
  /**
   * Drive the real handler's toggle against a rendered form.
   *
   * `toggleDependentFields` reads only its arguments and the document, so it is
   * invoked off the prototype rather than standing up a whole handler — the
   * point is to exercise the shipped implementation, not a copy of it.
   *
   * @param {string} answer - The answer given to the controlling question
   * @returns {HTMLElement} The form after the toggle
   */
  function answerWith(answer) {
    const form = renderWith({});
    document.body.appendChild(form);

    DynamicFormHandler.prototype.toggleDependentFields.call(
      null,
      FICHE_SANTE_FIELDS.fields[1],
      answer
    );

    return form;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reveals and requires the allergy box when the answer is yes', () => {
    const form = answerWith('yes');
    const box = form.querySelector('[name="allergie"]');

    expect(box.disabled).toBe(false);
    expect(box.hasAttribute('required')).toBe(true);
    expect(box.closest('.form-group').className).not.toContain('form-group--hidden');
  });

  it('accepts the checkbox spelling of yes that the handler produces', () => {
    // getFieldValue() normalises a checkbox to 'yes'/'no' while the format says
    // 'yes'; a strict === between the two never matched, so answering the
    // question left the field it controlled disabled.
    expect(isDependencySatisfied('yes', 'yes')).toBe(true);
    expect(isDependencySatisfied(true, 'yes')).toBe(true);
    expect(isDependencySatisfied('oui', 'yes')).toBe(true);
    expect(isDependencySatisfied('no', 'yes')).toBe(false);
    expect(isDependencySatisfied('', 'yes')).toBe(false);
  });

  it('hides the allergy box again when the answer changes to no', () => {
    const form = answerWith('no');
    const box = form.querySelector('[name="allergie"]');

    expect(box.disabled).toBe(true);
    expect(box.hasAttribute('required')).toBe(false);
    expect(box.closest('.form-group').className).toContain('form-group--hidden');
  });
});
