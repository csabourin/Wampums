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

import { JSONFormRenderer } from '../../spa/JSONFormRenderer.js';

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
});
