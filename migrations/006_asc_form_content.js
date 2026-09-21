'use strict';

/**
 * Bring the risk-acceptance and health forms in line with the current ASC forms.
 *
 * Two problems, both visible to families filling the forms in:
 *
 *   * On the risk-acceptance form every acceptance checkbox from the fourth
 *     field onwards sat above the paragraph it belonged to and below the
 *     previous one, so people were ticking boxes against the wrong text. It also
 *     still carried the COVID-19, fourteen-day-symptom and travel-outside-Canada
 *     declarations, which the ASC form dropped.
 *   * The health form still asked the menstruation questions the ASC struck from
 *     its own form, and was missing the "affections particulières" checklist
 *     that replaced them, along with the privacy notice.
 *
 * The catalog in config/default-form-formats.json holds the corrected
 * definitions; this brings existing organizations up to them. Fields an
 * organization added for itself are kept and appended, so a local customization
 * survives the update.
 *
 * Nothing is deleted from form_submissions. Answers to a removed field stay in
 * the stored JSON; they simply stop being rendered.
 */

const catalog = require('../config/default-form-formats.json');

const TARGET_FORM_TYPES = ['acceptation_risque', 'fiche_sante'];

/**
 * Fields this update deliberately retires, by identity key.
 *
 * These have to be named. Absence from the catalog is not enough to identify
 * them: unknown fields are preserved as local customizations, so a retired
 * field would otherwise be appended straight back onto the end of the form.
 */
const RETIRED_FIELDS = {
  acceptation_risque: new Set([
    'name:accepte_covid19',
    'text:covid19_maladies_infectieuses_texte',
    'name:declaration_sante',
    'text:sante_symptomes_texte',
    'name:declaration_voyage',
    'text:voyage_exterieur_canada_texte',
  ]),
  fiche_sante: new Set([
    // The ASC struck the menstruation questions from its own form.
    'name:regles',
    'name:renseignee',
  ]),
};

/**
 * A stable identity for a field, so catalog and stored fields can be compared.
 *
 * Static text blocks carry no name, so they are identified by their translation
 * key instead.
 *
 * @param {Object} field - A form-structure field
 * @returns {string} Identity key
 */
function fieldKey(field) {
  return field.name ? `name:${field.name}` : `text:${field.infoText}`;
}

/**
 * Canonical field list for a form type, taken from the checked-in catalog.
 *
 * @param {string} formType - e.g. 'fiche_sante'
 * @returns {Array<Object>} The corrected fields
 */
function canonicalFields(formType) {
  const entry = catalog.forms.find((form) => form.form_type === formType);
  if (!entry) {
    throw new Error(`${formType} is missing from the default form catalog`);
  }
  return entry.form_structure.fields || [];
}

/**
 * Merge the corrected definition into an organization's stored structure.
 *
 * @param {string} formType - The form type being updated
 * @param {Object} structure - The organization's stored form_structure
 * @returns {Object} The updated structure
 */
function applyCorrectedFields(formType, structure) {
  const corrected = canonicalFields(formType);
  const correctedKeys = new Set(corrected.map(fieldKey));
  const stored = (structure && structure.fields) || [];

  const retired = RETIRED_FIELDS[formType] || new Set();

  // Anything the organization added itself is unknown to the catalog. Keep it,
  // after the corrected fields, rather than silently dropping someone's work —
  // but not the fields this update retires, which are unknown for that reason.
  const custom = stored.filter((field) => {
    const key = fieldKey(field);
    return !correctedKeys.has(key) && !retired.has(key);
  });

  return { ...structure, fields: [...corrected, ...custom] };
}

async function up(client, { organizationIds } = {}) {
  const result = await client.query(
    `SELECT id, organization_id, form_type, form_structure
       FROM organization_form_formats
      WHERE form_type = ANY($1::text[])
      ORDER BY id`,
    [TARGET_FORM_TYPES],
  );

  const targets = Array.isArray(organizationIds) && organizationIds.length > 0
    ? new Set(organizationIds.map(Number))
    : null;

  for (const format of result.rows) {
    if (targets && !targets.has(format.organization_id)) continue;

    const corrected = applyCorrectedFields(format.form_type, format.form_structure);
    if (JSON.stringify(corrected) === JSON.stringify(format.form_structure)) continue;

    const versionResult = await client.query(
      `SELECT COALESCE(MAX(version_number), 0)::int + 1 AS next_version
         FROM form_format_versions WHERE form_format_id = $1`,
      [format.id],
    );
    await client.query(
      'UPDATE form_format_versions SET is_active = false WHERE form_format_id = $1',
      [format.id],
    );
    const insertedVersion = await client.query(
      `INSERT INTO form_format_versions
         (form_format_id, version_number, form_structure, display_name,
          change_description, created_by, is_active)
       VALUES ($1, $2, $3::jsonb, $4,
               'Align with the current ASC form: pair each acceptance with its own text, drop the COVID-era declarations, and follow the ASC health form',
               NULL, true)
       RETURNING id`,
      [format.id, versionResult.rows[0].next_version, JSON.stringify(corrected), format.form_type],
    );
    await client.query(
      `UPDATE organization_form_formats
          SET form_structure = $1::jsonb, current_version_id = $2, updated_at = NOW()
        WHERE id = $3`,
      [JSON.stringify(corrected), insertedVersion.rows[0].id, format.id],
    );
  }
}

module.exports = {
  description: 'Align the risk-acceptance and health forms with the current ASC forms',
  up,
  applyCorrectedFields,
};
