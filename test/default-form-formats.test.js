'use strict';

const {
  defaultFormCatalog,
  getDefaultPermissionPolicy,
} = require('../services/defaultFormFormats');
const english = require('../lang/en.json');
const french = require('../lang/fr.json');

describe('standard form catalog', () => {
  test('contains the five Railway template formats with usable fields', () => {
    expect(defaultFormCatalog.forms.map((form) => form.form_type).sort()).toEqual([
      'acceptation_risque',
      'fiche_sante',
      'incident_report',
      'parent_guardian',
      'participant_registration',
    ]);
    for (const form of defaultFormCatalog.forms) {
      expect(Array.isArray(form.form_structure?.fields)).toBe(true);
      expect(form.form_structure.fields.length).toBeGreaterThan(0);
      expect(Array.isArray(form.display_context)).toBe(true);
    }
  });

  test('parents may maintain participant forms but cannot approve them', () => {
    for (const formType of [
      'acceptation_risque',
      'fiche_sante',
      'parent_guardian',
      'participant_registration',
    ]) {
      const parent = getDefaultPermissionPolicy(formType)
        .find((permission) => permission.role_name === 'parent');
      expect(parent).toMatchObject({
        can_view: true,
        can_submit: true,
        can_edit: true,
        can_approve: false,
      });
    }
  });

  test('incident reports are staff-scoped and demo roles stay read-only', () => {
    const permissions = getDefaultPermissionPolicy('incident_report');
    expect(permissions.some((permission) => permission.role_name === 'parent')).toBe(false);
    expect(permissions.find((permission) => permission.role_name === 'district'))
      .toMatchObject({ can_view: true, can_submit: true, can_edit: true, can_approve: true });
    expect(permissions.find((permission) => permission.role_name === 'demoadmin'))
      .toMatchObject({ can_view: true, can_submit: false, can_edit: false, can_approve: false });
  });

  test('every standard form label is translated in English and French', () => {
    const translationKeys = new Set();
    for (const form of defaultFormCatalog.forms) {
      for (const field of form.form_structure.fields) {
        if (field.label) translationKeys.add(field.label);
        if (field.infoText) translationKeys.add(field.infoText);
        for (const option of field.options || []) {
          if (option.label) translationKeys.add(option.label);
        }
      }
    }

    for (const key of translationKeys) {
      expect(english).toHaveProperty(key);
      expect(french).toHaveProperty(key);
    }
  });
});
