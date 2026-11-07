'use strict';

/**
 * Show the health form's "EpiPen or Twinject" box only to a family that
 * answers "yes" to allergies (issue #1405).
 *
 * The box had no condition: a parent who answered "no" to allergies still saw
 * it and wondered whether to tick it. The catalog
 * (config/default-form-formats.json) now gives `epipen` the same condition as
 * the allergy text; this brings every unit's installed health form up to it,
 * recording a new form version as migration 006 does.
 *
 * Nothing is removed from what families saved. A form saved with "no" to
 * allergies and an EpiPen ticked keeps it: the field is marked
 * `keepSavedAnswer`, so the form shows it while it holds a saved answer even
 * though its condition is not met (spa/JSONFormRenderer.js), and the camp allergy
 * list counts an EpiPen on its own (utils/health-form.js `declaresAllergy`).
 *
 * Re-runnable: a field that already carries a condition is left as it is, so a
 * condition a unit chose itself is kept too.
 */

const EPIPEN_CONDITION = Object.freeze({ field: 'has_allergies', value: 'yes' });

/**
 * The health form structure with `epipen` depending on the allergy answer.
 *
 * @param {Object} structure - Stored form structure
 * @returns {Object} The structure, unchanged when there is nothing to add
 */
function addEpipenCondition(structure) {
  const fields = Array.isArray(structure?.fields) ? structure.fields : [];
  const asksAllergies = fields.some((field) => field.name === EPIPEN_CONDITION.field);
  const needsCondition = (field) => field.name === 'epipen' && !field.dependsOn;
  if (!asksAllergies || !fields.some(needsCondition)) {
    return structure;
  }
  return {
    ...structure,
    fields: fields.map((field) => (needsCondition(field)
      ? { ...field, dependsOn: { ...EPIPEN_CONDITION }, keepSavedAnswer: true }
      : field)),
  };
}

async function up(client, { organizationIds } = {}) {
  const result = await client.query(
    `SELECT id, organization_id, form_type, form_structure
       FROM organization_form_formats
      WHERE form_type = 'fiche_sante'
      ORDER BY id`,
  );

  const targets = Array.isArray(organizationIds) && organizationIds.length > 0
    ? new Set(organizationIds.map(Number))
    : null;

  for (const format of result.rows) {
    if (targets && !targets.has(format.organization_id)) {continue;}

    const updated = addEpipenCondition(format.form_structure);
    if (updated === format.form_structure) {continue;}

    // One unit at a time, in order, inside the runner's transaction.
    // eslint-disable-next-line no-await-in-loop
    const versionResult = await client.query(
      `SELECT COALESCE(MAX(version_number), 0)::int + 1 AS next_version
         FROM form_format_versions WHERE form_format_id = $1`,
      [format.id],
    );
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      'UPDATE form_format_versions SET is_active = false WHERE form_format_id = $1',
      [format.id],
    );
    // eslint-disable-next-line no-await-in-loop
    const insertedVersion = await client.query(
      `INSERT INTO form_format_versions
         (form_format_id, version_number, form_structure, display_name,
          change_description, created_by, is_active)
       VALUES ($1, $2, $3::jsonb, $4,
               'Show the EpiPen question only when the family answers yes to allergies',
               NULL, true)
       RETURNING id`,
      [format.id, versionResult.rows[0].next_version, JSON.stringify(updated), format.form_type],
    );
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `UPDATE organization_form_formats
          SET form_structure = $1::jsonb, current_version_id = $2, updated_at = NOW()
        WHERE id = $3`,
      [JSON.stringify(updated), insertedVersion.rows[0].id, format.id],
    );
  }
}

module.exports = {
  description: 'Show the health form EpiPen question only after yes to allergies',
  up,
  addEpipenCondition,
};
