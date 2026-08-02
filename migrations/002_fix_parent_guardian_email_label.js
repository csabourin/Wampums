'use strict';

/** Replace the untranslated Railway email label without mutating old versions. */
function correctEmailLabel(structure) {
  return {
    ...structure,
    fields: (structure?.fields || []).map((field) => (
      field.label === 'courriel' ? { ...field, label: 'courriel_label' } : field
    )),
  };
}

async function up(client, { organizationIds } = {}) {
  const result = await client.query(
    `SELECT id, organization_id, form_structure
     FROM organization_form_formats
     WHERE form_type = 'parent_guardian'
     ORDER BY id`,
  );
  const targets = Array.isArray(organizationIds) && organizationIds.length > 0
    ? new Set(organizationIds.map(Number))
    : null;

  for (const format of result.rows) {
    if (targets && !targets.has(format.organization_id)) continue;
    const corrected = correctEmailLabel(format.form_structure);
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
       VALUES ($1, $2, $3::jsonb, 'parent_guardian',
               'Use the bilingual email label key', NULL, true)
       RETURNING id`,
      [format.id, versionResult.rows[0].next_version, JSON.stringify(corrected)],
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
  description: 'Correct the parent/guardian email translation key',
  up,
};
