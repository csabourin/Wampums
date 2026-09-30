/**
 * @jest-environment jsdom
 */

/**
 * A form field that depends on a drop-down or radio answer
 *
 * Example from the request: "Langue" is a select (Français, Anglais, Autre) and
 * "Autre langue" is a text box that only applies when the answer is "Autre".
 *
 * The form format already carried `dependsOn: { field, value }`, but the form
 * builder only offered radios and checkboxes as controlling fields and asked for
 * the trigger value as free text. These tests cover both halves: the builder
 * lets the admin pick a select and one of its options, and the rendered form
 * shows the dependent field only for that option — including on first render,
 * where a select with no saved answer still displays its first option.
 *
 * @module test/spa/FormFieldSelectDependency
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

import { FormBuilder } from '../../spa/formBuilder.js';
import { JSONFormRenderer } from '../../spa/JSONFormRenderer.js';
import { DynamicFormHandler } from '../../spa/dynamicFormHandler.js';
import { confirmDestructive } from '../../spa/utils/DialogUtils.js';

const LANGUAGE_FIELD = {
  name: 'langue',
  type: 'select',
  label: 'langue_label',
  required: true,
  options: [
    { label: 'francais', value: 'fr' },
    { label: 'anglais', value: 'en' },
    { label: 'autre', value: 'autre' }
  ]
};

const OTHER_LANGUAGE_FIELD = {
  name: 'autre_langue',
  type: 'text',
  label: 'autre_langue_label',
  required: true,
  dependsOn: { field: 'langue', value: 'autre' }
};

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } }
};

/**
 * Mount the field editor modal skeleton the builder writes into.
 *
 * @returns {void}
 */
function mountEditorShell() {
  document.body.innerHTML = `
    <div id="field-editor-modal" role="dialog" aria-modal="true" aria-labelledby="field-editor-title">
      <h2 id="field-editor-title"></h2>
      <div id="field-editor-content"></div>
    </div>
    <div id="fields-container"></div>
  `;
}

/**
 * A builder holding the language question and, optionally, its dependent.
 *
 * @param {Object[]} fields - Initial fields
 * @returns {FormBuilder} The builder
 */
function builderWith(fields) {
  const builder = new FormBuilder({ showMessage: jest.fn() });
  builder.currentFields = fields.map((field) => JSON.parse(JSON.stringify(field)));
  return builder;
}

/**
 * Change a select's value the way a user would, keyboard or pointer alike.
 *
 * @param {HTMLSelectElement} select - The select
 * @param {string} value - The option value to choose
 * @returns {void}
 */
function choose(select, value) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Form builder: depending on a select', () => {
  beforeEach(mountEditorShell);

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  it('offers a select field as a controlling field', () => {
    const builder = builderWith([LANGUAGE_FIELD]);
    builder.renderFieldEditor();

    const controller = document.getElementById('depends-on-field');
    const values = Array.from(controller.options).map((option) => option.value);
    expect(values).toContain('langue');
  });

  it('does not let a field depend on itself', () => {
    const builder = builderWith([LANGUAGE_FIELD]);
    builder.renderFieldEditor(0);

    const values = Array.from(document.getElementById('depends-on-field').options).map((o) => o.value);
    expect(values).not.toContain('langue');
  });

  it('offers the controlling select\'s options as trigger values once it is chosen', () => {
    const builder = builderWith([LANGUAGE_FIELD]);
    builder.renderFieldEditor();

    choose(document.getElementById('depends-on-field'), 'langue');

    const valueControl = document.getElementById('depends-on-value');
    expect(valueControl.tagName).toBe('SELECT');
    expect(Array.from(valueControl.options).map((o) => o.value)).toEqual(['fr', 'en', 'autre']);
    expect(document.getElementById('depends-on-value-group').style.display).toBe('block');
  });

  it('hides the trigger value again when the condition is cleared', () => {
    const builder = builderWith([LANGUAGE_FIELD]);
    builder.renderFieldEditor();
    const controller = document.getElementById('depends-on-field');

    choose(controller, 'langue');
    choose(controller, '');

    expect(document.getElementById('depends-on-value-group').style.display).toBe('none');
  });

  it('saves "Autre langue" as depending on langue = autre', () => {
    const builder = builderWith([LANGUAGE_FIELD]);
    builder.renderFieldEditor();

    document.getElementById('field-name').value = 'autre_langue';
    document.getElementById('field-label').value = 'autre_langue_label';
    choose(document.getElementById('depends-on-field'), 'langue');
    choose(document.getElementById('depends-on-value'), 'autre');
    builder.saveField();

    expect(builder.currentFields[1]).toMatchObject({
      name: 'autre_langue',
      type: 'text',
      dependsOn: { field: 'langue', value: 'autre' }
    });
  });

  it('pre-selects the saved trigger value when the dependent field is reopened', () => {
    const builder = builderWith([LANGUAGE_FIELD, OTHER_LANGUAGE_FIELD]);
    builder.renderFieldEditor(1);

    expect(document.getElementById('depends-on-field').value).toBe('langue');
    expect(document.getElementById('depends-on-value').value).toBe('autre');
  });

  it('keeps a saved trigger value the select no longer offers', () => {
    const builder = builderWith([
      LANGUAGE_FIELD,
      { ...OTHER_LANGUAGE_FIELD, dependsOn: { field: 'langue', value: 'other' } }
    ]);
    builder.renderFieldEditor(1);

    expect(document.getElementById('depends-on-value').value).toBe('other');
  });

  it('drops a saved condition on the field itself instead of offering it', () => {
    // A field cannot hide itself; a format saved that way (by hand or by an
    // older builder) must not have the self-dependency preserved on re-save.
    const builder = builderWith([
      { ...LANGUAGE_FIELD, dependsOn: { field: 'langue', value: 'autre' } }
    ]);
    builder.renderFieldEditor(0);

    const values = Array.from(document.getElementById('depends-on-field').options).map((o) => o.value);
    expect(values).not.toContain('langue');

    builder.saveField();
    expect(builder.currentFields[0].dependsOn).toBeUndefined();
  });

  it('offers "checked" as the only trigger for a checkbox', () => {
    const builder = builderWith([{ name: 'has_pet', type: 'checkbox', label: 'has_pet_label' }]);
    builder.renderFieldEditor();

    choose(document.getElementById('depends-on-field'), 'has_pet');

    const values = Array.from(document.getElementById('depends-on-value').options).map((o) => o.value);
    expect(values).toEqual(['yes']);
  });

  it('follows the controlling field when it is renamed', () => {
    const builder = builderWith([LANGUAGE_FIELD, OTHER_LANGUAGE_FIELD]);
    builder.renderFieldEditor(0);

    document.getElementById('field-name').value = 'language';
    builder.saveField();

    expect(builder.currentFields[1].dependsOn.field).toBe('language');
  });

  it('drops the condition when the controlling field is deleted, after warning', async () => {
    confirmDestructive.mockResolvedValue(true);
    const builder = builderWith([LANGUAGE_FIELD, OTHER_LANGUAGE_FIELD]);

    await builder.deleteField(0);

    expect(confirmDestructive).toHaveBeenCalledWith('confirm_delete_field_with_dependents');
    expect(builder.currentFields).toHaveLength(1);
    expect(builder.currentFields[0].dependsOn).toBeUndefined();
  });

  it('names the condition in the fields list, not only "conditional"', () => {
    const builder = builderWith([LANGUAGE_FIELD, OTHER_LANGUAGE_FIELD]);
    builder.updateFieldsList();

    const badge = document.querySelector('.field-item[data-field-index="1"] .badge-info');
    expect(badge.textContent).toContain('langue = autre');
  });

  it('labels and describes both condition controls', () => {
    const builder = builderWith([LANGUAGE_FIELD, OTHER_LANGUAGE_FIELD]);
    builder.renderFieldEditor(1);

    for (const id of ['depends-on-field', 'depends-on-value']) {
      const control = document.getElementById(id);
      expect(document.querySelector(`label[for="${id}"]`)).not.toBeNull();
      const describedBy = control.getAttribute('aria-describedby');
      expect(document.getElementById(describedBy)).not.toBeNull();
    }
  });

  it('has no WCAG A/AA violations in the field editor', async () => {
    const builder = builderWith([LANGUAGE_FIELD, OTHER_LANGUAGE_FIELD]);
    builder.renderFieldEditor(1);

    const results = await axe.run(document.getElementById('depends-on-group').parentElement, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

describe('Rendered form: a text field depending on a select', () => {
  /**
   * Render the language form and wire its dependencies through the real handler.
   *
   * @param {Object} formData - Saved answers
   * @returns {HTMLFormElement} The live form
   */
  function renderLive(formData = {}, fields = [LANGUAGE_FIELD, OTHER_LANGUAGE_FIELD]) {
    const structure = { fields };
    const renderer = new JSONFormRenderer(structure, formData, 'language_form');
    const form = document.createElement('form');
    form.innerHTML = renderer.render();
    document.body.appendChild(form);

    const handler = new DynamicFormHandler({ showMessage: jest.fn() });
    handler.formFormats = { language_form: structure };
    handler.formType = 'language_form';
    handler.formData = formData;
    handler.attachDependencyListeners();

    return form;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const otherLanguage = (form) => form.querySelector('[name="autre_langue"]');
  const isHidden = (element) => element.closest('.form-group').classList.contains('form-group--hidden');

  it('hides "Autre langue" while another language is chosen', () => {
    const form = renderLive({ langue: 'fr' });

    expect(isHidden(otherLanguage(form))).toBe(true);
    expect(otherLanguage(form).disabled).toBe(true);
  });

  it('shows and requires "Autre langue" when Autre is chosen', () => {
    const form = renderLive({ langue: 'fr' });

    choose(form.querySelector('[name="langue"]'), 'autre');

    expect(isHidden(otherLanguage(form))).toBe(false);
    expect(otherLanguage(form).disabled).toBe(false);
    expect(otherLanguage(form).required).toBe(true);
  });

  it('hides it again, and stops requiring it, when the answer changes back', () => {
    const form = renderLive({ langue: 'autre', autre_langue: 'Cri' });

    choose(form.querySelector('[name="langue"]'), 'en');

    expect(isHidden(otherLanguage(form))).toBe(true);
    expect(otherLanguage(form).required).toBe(false);
  });

  it('keeps a saved "Autre langue" editable and submitted', () => {
    const form = renderLive({ langue: 'autre', autre_langue: 'Cri' });

    expect(otherLanguage(form).disabled).toBe(false);
    expect(new FormData(form).get('autre_langue')).toBe('Cri');
  });

  it('follows what the select displays when nothing is saved yet', () => {
    // A select with no saved answer still shows its first option. When that
    // option is the trigger, the dependent field must be visible from the start
    // rather than wait for a change the user has no reason to make.
    const autreFirst = { ...LANGUAGE_FIELD, options: [...LANGUAGE_FIELD.options].reverse() };
    const form = renderLive({}, [autreFirst, OTHER_LANGUAGE_FIELD]);

    expect(form.querySelector('[name="langue"]').value).toBe('autre');
    expect(isHidden(otherLanguage(form))).toBe(false);
  });

  it('works the same with a radio group as the controlling field', () => {
    const radioLanguage = { ...LANGUAGE_FIELD, type: 'radio' };
    const form = renderLive({}, [radioLanguage, OTHER_LANGUAGE_FIELD]);

    expect(isHidden(otherLanguage(form))).toBe(true);

    const autre = form.querySelector('[name="langue"][value="autre"]');
    autre.checked = true;
    autre.dispatchEvent(new Event('change', { bubbles: true }));

    expect(isHidden(otherLanguage(form))).toBe(false);
  });

  it('clears "Autre langue" when another language is chosen', () => {
    const form = renderLive({ langue: 'autre', autre_langue: 'Cri' });

    choose(form.querySelector('[name="langue"]'), 'fr');

    expect(otherLanguage(form).value).toBe('');
    // Hidden, the field is disabled and absent from a native submit; the
    // handler's own collector still reads it, and must read it empty.
    expect(new FormData(form).has('autre_langue')).toBe(false);
  });

  it('comes back empty when Autre is chosen again', () => {
    const form = renderLive({ langue: 'autre', autre_langue: 'Cri' });
    const langue = form.querySelector('[name="langue"]');

    choose(langue, 'fr');
    choose(langue, 'autre');

    expect(isHidden(otherLanguage(form))).toBe(false);
    expect(otherLanguage(form).value).toBe('');
  });

  it('clears a stale saved answer whose condition is not met on load', () => {
    const form = renderLive({ langue: 'fr', autre_langue: 'Cri' });

    expect(otherLanguage(form).value).toBe('');
  });

  it.each([
    ['a radio group', { type: 'radio', options: [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }] }, 'a',
      (form) => form.querySelector('[name="detail"]:checked')],
    ['a select', { type: 'select', options: [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }] }, 'b',
      (form) => form.querySelector('[name="detail"]').value || null],
    ['a checkbox', { type: 'checkbox' }, '1',
      (form) => form.querySelector('[name="detail"]:checked')],
    ['a textarea', { type: 'textarea' }, 'Du texte',
      (form) => form.querySelector('[name="detail"]').value || null]
  ])('clears %s when it is hidden', (_label, definition, saved, answerOf) => {
    const detail = {
      name: 'detail',
      label: 'detail_label',
      dependsOn: { field: 'langue', value: 'autre' },
      ...definition
    };
    const form = renderLive({ langue: 'autre', detail: saved }, [LANGUAGE_FIELD, detail]);
    expect(answerOf(form)).not.toBeNull();

    choose(form.querySelector('[name="langue"]'), 'en');

    expect(answerOf(form)).toBeNull();
  });

  it('asks for a real choice when a cleared required select is shown again', () => {
    const detail = {
      name: 'detail',
      type: 'select',
      label: 'detail_label',
      required: true,
      options: [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }],
      dependsOn: { field: 'langue', value: 'autre' }
    };
    const form = renderLive({ langue: 'autre', detail: 'b' }, [LANGUAGE_FIELD, detail]);
    const langue = form.querySelector('[name="langue"]');

    choose(langue, 'fr');
    choose(langue, 'autre');

    const select = form.querySelector('[name="detail"]');
    expect(select.value).toBe('');
    expect(select.checkValidity()).toBe(false);
  });

  it('hides and clears a field further down the chain', () => {
    // "Dialecte" depends on "Autre langue" being answered; hiding and clearing
    // "Autre langue" must take "Dialecte" with it.
    const origin = {
      name: 'origine',
      type: 'radio',
      label: 'origine_label',
      options: [{ label: 'yes', value: 'yes' }, { label: 'no', value: 'no' }],
      dependsOn: { field: 'langue', value: 'autre' }
    };
    const dialect = {
      name: 'dialecte',
      type: 'text',
      label: 'dialecte_label',
      dependsOn: { field: 'origine', value: 'yes' }
    };
    const form = renderLive(
      { langue: 'autre', origine: 'yes', dialecte: 'Innu-aimun' },
      [LANGUAGE_FIELD, origin, dialect]
    );
    const dialectInput = form.querySelector('[name="dialecte"]');
    expect(dialectInput.value).toBe('Innu-aimun');

    choose(form.querySelector('[name="langue"]'), 'fr');

    expect(form.querySelector('[name="origine"]:checked')).toBeNull();
    expect(dialectInput.value).toBe('');
    expect(isHidden(dialectInput)).toBe(true);
  });

  describe('with a multi-select as the controlling field', () => {
    const MULTI_LANGUAGE_FIELD = { ...LANGUAGE_FIELD, name: 'langues', multiple: true };
    const OTHER_FOR_MULTI = { ...OTHER_LANGUAGE_FIELD, dependsOn: { field: 'langues', value: 'autre' } };
    const tick = (form, value, checked) => {
      const box = form.querySelector(`[name="langues"][value="${value}"]`);
      box.checked = checked;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    };

    it('shows the dependent field when the trigger is among the selected options', () => {
      const form = renderLive({}, [MULTI_LANGUAGE_FIELD, OTHER_FOR_MULTI]);
      expect(isHidden(otherLanguage(form))).toBe(true);

      tick(form, 'fr', true);
      expect(isHidden(otherLanguage(form))).toBe(true);

      tick(form, 'autre', true);
      expect(isHidden(otherLanguage(form))).toBe(false);
    });

    it('keeps it shown while another option is unticked, and hides it with the trigger', () => {
      const form = renderLive(
        { langues: 'fr,autre', autre_langue: 'Cri' },
        [MULTI_LANGUAGE_FIELD, OTHER_FOR_MULTI]
      );
      expect(isHidden(otherLanguage(form))).toBe(false);
      expect(otherLanguage(form).value).toBe('Cri');

      tick(form, 'fr', false);
      expect(isHidden(otherLanguage(form))).toBe(false);

      tick(form, 'autre', false);
      expect(isHidden(otherLanguage(form))).toBe(true);
      expect(otherLanguage(form).value).toBe('');
    });
  });

  it('compares a select\'s own options exactly, not as yes/no aliases', () => {
    // "yes" and "1" are two distinct answers here, not two spellings of yes.
    const scale = {
      name: 'niveau',
      type: 'select',
      label: 'niveau_label',
      options: [{ label: 'none', value: '0' }, { label: 'one', value: '1' }, { label: 'yes', value: 'yes' }]
    };
    const detail = { ...OTHER_LANGUAGE_FIELD, dependsOn: { field: 'niveau', value: 'yes' } };
    const form = renderLive({ niveau: '0' }, [scale, detail]);
    const select = form.querySelector('[name="niveau"]');

    choose(select, '1');
    expect(isHidden(otherLanguage(form))).toBe(true);

    choose(select, 'yes');
    expect(isHidden(otherLanguage(form))).toBe(false);
  });

  it('hides and clears on load an answer whose saved controller is a different exact option', () => {
    // The saved "1" is shown selected; it is not the awaited "yes", even though
    // the tolerant comparison of legacy answers would equate them.
    const scale = {
      name: 'niveau',
      type: 'select',
      label: 'niveau_label',
      options: [{ label: 'none', value: '0' }, { label: 'one', value: '1' }, { label: 'yes', value: 'yes' }]
    };
    const detail = { ...OTHER_LANGUAGE_FIELD, dependsOn: { field: 'niveau', value: 'yes' } };
    const form = renderLive({ niveau: '1', autre_langue: 'Périmé' }, [scale, detail]);

    expect(form.querySelector('[name="niveau"]').value).toBe('1');
    expect(isHidden(otherLanguage(form))).toBe(true);
    expect(otherLanguage(form).value).toBe('');
  });

  describe('with answers saved in an older spelling (fiche santé history)', () => {
    const YES_NO = [{ label: 'yes_label', value: 'yes' }, { label: 'no_label', value: 'no' }];
    const allergyFields = (type) => [
      { name: 'has_allergies', type, label: 'has_allergies_label', options: YES_NO },
      {
        name: 'allergie',
        type: 'textarea',
        label: 'allergie_label',
        dependsOn: { field: 'has_allergies', value: 'yes' }
      }
    ];
    const allergy = (form) => form.querySelector('[name="allergie"]');

    it.each([true, 'on', '1', 'oui', 'Yes'])(
      'keeps the allergy of a radio saved as %p, and shows the yes option ticked',
      (saved) => {
        const form = renderLive({ has_allergies: saved, allergie: 'Arachides' }, allergyFields('radio'));

        expect(allergy(form).value).toBe('Arachides');
        expect(isHidden(allergy(form))).toBe(false);
        expect(form.querySelector('[name="has_allergies"]:checked').value).toBe('yes');
      }
    );

    it('keeps the allergy of a select saved as true, and selects yes', () => {
      const form = renderLive({ has_allergies: true, allergie: 'Arachides' }, allergyFields('select'));

      expect(form.querySelector('[name="has_allergies"]').value).toBe('yes');
      expect(allergy(form).value).toBe('Arachides');
    });

    it.each(['yes', 'oui'])('renders a lone checkbox saved as %p ticked, keeping its dependent answer', (saved) => {
      const form = renderLive(
        { has_allergies: saved, allergie: 'Arachides' },
        allergyFields('checkbox').map((field) => ({ ...field, options: undefined }))
      );

      expect(form.querySelector('[name="has_allergies"]').checked).toBe(true);
      expect(allergy(form).value).toBe('Arachides');
    });

    it('never erases an answer on load whose saved condition is met, even if nothing on screen shows it', () => {
      // No option can display "yes" here; the saved answer still says the
      // allergy applies, so loading the form must not destroy it.
      const fields = allergyFields('radio');
      fields[0] = { ...fields[0], options: [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }] };
      const form = renderLive({ has_allergies: 'yes', allergie: 'Arachides' }, fields);

      expect(allergy(form).value).toBe('Arachides');
      expect(allergy(form).disabled).toBe(false);
    });
  });

  describe('with several forms on the page (one per guardian)', () => {
    /**
     * Mount one handler per guardian, each in its own container, the way
     * participant registration does. The forms share their field names.
     *
     * @param {Object[]} answers - Saved answers, one object per guardian
     * @returns {HTMLElement[]} The guardian containers
     */
    function renderGuardians(answers) {
      const structure = { fields: [LANGUAGE_FIELD, OTHER_LANGUAGE_FIELD] };
      return answers.map((formData, index) => {
        const container = document.createElement('div');
        container.innerHTML = new JSONFormRenderer(structure, formData, 'parent_guardian', true, index).render();
        document.body.appendChild(container);

        const handler = new DynamicFormHandler({ showMessage: jest.fn() });
        handler.container = container;
        handler.formFormats = { parent_guardian: structure };
        handler.formType = 'parent_guardian';
        handler.formData = formData;
        handler.attachDependencyListeners();
        return container;
      });
    }

    it('keeps each guardian\'s dependent answer when another guardian changes language', () => {
      const [first, second] = renderGuardians([
        { langue: 'autre', autre_langue: 'Cri' },
        { langue: 'autre', autre_langue: 'Innu-aimun' }
      ]);

      choose(first.querySelector('[name="langue"]'), 'fr');

      expect(otherLanguage(first).value).toBe('');
      expect(otherLanguage(second).value).toBe('Innu-aimun');
      expect(isHidden(otherLanguage(second))).toBe(false);
    });

    it('syncs each guardian from their own controlling field on load', () => {
      const [first, second] = renderGuardians([
        { langue: 'fr' },
        { langue: 'autre', autre_langue: 'Innu-aimun' }
      ]);

      expect(isHidden(otherLanguage(first))).toBe(true);
      expect(isHidden(otherLanguage(second))).toBe(false);
      expect(otherLanguage(second).value).toBe('Innu-aimun');
    });
  });

  it('has no WCAG A/AA violations with the dependent field shown or hidden', async () => {
    const form = renderLive({ langue: 'fr' });
    expect((await axe.run(form, AXE_OPTIONS)).violations).toEqual([]);

    choose(form.querySelector('[name="langue"]'), 'autre');
    expect((await axe.run(form, AXE_OPTIONS)).violations).toEqual([]);
  });
});
