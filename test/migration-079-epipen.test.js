/**
 * Migration 079: the health form's EpiPen question follows the allergy answer,
 * in every unit's installed copy, without overriding a unit's own condition.
 */

const { addEpipenCondition } = require('../migrations/079_epipen_follows_allergies');

const ALLERGIES = { name: 'has_allergies', type: 'radio' };

describe('migration 079: EpiPen follows the allergy answer', () => {
  test('the EpiPen box gets the allergy condition and keeps a saved answer', () => {
    const updated = addEpipenCondition({ fields: [ALLERGIES, { name: 'epipen', type: 'checkbox', label: 'epipen_label' }] });

    expect(updated.fields[1]).toEqual({
      name: 'epipen', type: 'checkbox', label: 'epipen_label',
      dependsOn: { field: 'has_allergies', value: 'yes' }, keepSavedAnswer: true,
    });
  });

  test('running it again changes nothing', () => {
    const once = addEpipenCondition({ fields: [ALLERGIES, { name: 'epipen', type: 'checkbox' }] });
    expect(addEpipenCondition(once)).toBe(once);
  });

  test('a condition the unit chose itself is kept', () => {
    const own = { fields: [ALLERGIES, { name: 'epipen', type: 'checkbox', dependsOn: { field: 'other', value: 'x' } }] };
    expect(addEpipenCondition(own)).toBe(own);
  });

  test('a form without the allergy question is left alone', () => {
    const custom = { fields: [{ name: 'epipen', type: 'checkbox' }] };
    expect(addEpipenCondition(custom)).toBe(custom);
  });

  test('the catalog new units receive already asks it that way', () => {
    const { forms } = require('../config/default-form-formats.json');
    const { fields } = forms.find((form) => form.form_type === 'fiche_sante').form_structure;
    expect(fields.find((field) => field.name === 'epipen')).toMatchObject({
      dependsOn: { field: 'has_allergies', value: 'yes' }, keepSavedAnswer: true,
    });
  });
});
