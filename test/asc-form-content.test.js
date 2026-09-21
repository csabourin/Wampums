/**
 * ASC form content migration (006).
 *
 * The risk-acceptance form paired every acceptance checkbox with the wrong
 * paragraph from the fourth field on, and still carried COVID-era declarations;
 * the health form still asked the menstruation questions the ASC struck from its
 * own form. The migration brings existing organizations onto the corrected
 * definitions without discarding anything they built for themselves.
 *
 * @module test/asc-form-content
 */

const { applyCorrectedFields } = require('../migrations/006_asc_form_content');
const catalog = require('../config/default-form-formats.json');

/**
 * Identity key matching the migration's own.
 *
 * @param {Object} field - A form-structure field
 * @returns {string} Identity key
 */
const key = (field) => (field.name ? `name:${field.name}` : `text:${field.infoText}`);

/**
 * @param {string} formType - Form type to read from the catalog
 * @returns {Array<Object>} Its corrected fields
 */
const catalogFields = (formType) => {
  const form = catalog.forms.find((entry) => entry.form_type === formType);
  const activeVersion = form?.versions?.find((version) => version.is_active);
  return (activeVersion?.form_structure?.fields || form?.form_structure?.fields || []);
};

describe('Risk acceptance form', () => {
  const fields = catalogFields('acceptation_risque');
  const keys = fields.map(key);

  it('drops the COVID-era declarations', () => {
    expect(keys).not.toContain('name:accepte_covid19');
    expect(keys).not.toContain('name:declaration_sante');
    expect(keys).not.toContain('name:declaration_voyage');
  });

  it('puts every acceptance checkbox after the text it belongs to', () => {
    // The defect: from the fourth field on, each paragraph was followed by the
    // checkbox for the *next* topic, so people ticked boxes against the wrong
    // text. Every checkbox must now be preceded by a block of standing text.
    fields.forEach((field, index) => {
      if (field.type !== 'checkbox') return;
      expect(index).toBeGreaterThan(0);
      expect(fields[index - 1].type).toBe('infoText');
    });
  });

  it('keeps the participant-facing signature fields last', () => {
    expect(keys).toContain('name:nom_parent_tuteur');
    expect(keys).toContain('name:date_signature');
    expect(keys[keys.length - 1]).toBe('text:declaration_parent_tuteur_texte');
  });
});

describe('Health form', () => {
  const keys = catalogFields('fiche_sante').map(key);

  it('drops the menstruation questions the ASC removed', () => {
    expect(keys).not.toContain('name:regles');
    expect(keys).not.toContain('name:renseignee');
  });

  it('adds the specific-conditions checklist and the privacy notice', () => {
    expect(keys).toContain('name:affections_particulieres');
    expect(keys).toContain('name:affections_autre');
    expect(keys).toContain('text:protection_renseignements_texte');
    expect(keys).toContain('name:declaration_exactitude');
  });

  it('offers the nine conditions the ASC form lists', () => {
    const field = catalogFields('fiche_sante').find((f) => f.name === 'affections_particulieres');
    expect(field.multiple).toBe(true);
    expect(field.options).toHaveLength(9);
  });
});

describe('Migrating an existing organization', () => {
  it('retires the removed fields instead of re-appending them as custom', () => {
    // Absence from the catalog is how a local customization is recognised, so a
    // retired field has to be named explicitly or it comes straight back.
    const result = applyCorrectedFields('acceptation_risque', {
      fields: [
        { name: 'accepte_covid19', type: 'checkbox' },
        { type: 'infoText', infoText: 'sante_symptomes_texte' },
      ],
    });
    const keys = result.fields.map(key);

    expect(keys).not.toContain('name:accepte_covid19');
    expect(keys).not.toContain('text:sante_symptomes_texte');
  });

  it("keeps a field the organization added for itself", () => {
    const result = applyCorrectedFields('fiche_sante', {
      fields: [{ name: 'regles', type: 'radio' }, { name: 'local_question', type: 'text' }],
    });
    const keys = result.fields.map(key);

    expect(keys).not.toContain('name:regles');
    expect(keys).toContain('name:local_question');
  });

  it('is a no-op the second time it runs', () => {
    const once = applyCorrectedFields('fiche_sante', { fields: catalogFields('fiche_sante') });
    const twice = applyCorrectedFields('fiche_sante', once);

    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('preserves other keys on the structure', () => {
    const result = applyCorrectedFields('fiche_sante', { title: 'Fiche santé', fields: [] });

    expect(result.title).toBe('Fiche santé');
  });
});
