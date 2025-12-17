/**
 * Utilities for managing program sections per organization.
 *
 * Centralizes default section definitions, validation helpers, and
 * synchronization between the database tables and organization settings.
 */

const DEFAULT_PROGRAM_SECTIONS = [
  { key: 'general', labels: { en: 'General', fr: 'Général' } },
  { key: 'beavers', labels: { en: 'Beavers', fr: 'Castors' } },
  { key: 'cubs', labels: { en: 'Cubs', fr: 'Louveteaux' } },
  { key: 'scouts', labels: { en: 'Scouts', fr: 'Éclaireurs' } },
  { key: 'pioneers', labels: { en: 'Venturers', fr: 'Pionniers' } },
  { key: 'rovers', labels: { en: 'Rovers', fr: 'Routiers' } }
];

/**
 * Build the default program sections with labels in the desired locale.
 *
 * @param {string} [locale='en'] - Language code to prioritize for labels.
 * @returns {Array<{key: string, label: string}>} Default sections with labels.
 */
function buildDefaultProgramSections(locale = 'en') {
  return DEFAULT_PROGRAM_SECTIONS.map(section => ({
    key: section.key,
    label: section.labels[locale] || section.labels.en
  }));
}

/**
 * Parse a stored organization setting value into JSON, returning null on failure.
 *
 * @param {string} value - Raw setting value from the database.
 * @returns {any|null} Parsed JSON or null if parsing failed.
 */
function parseSettingValue(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

/**
 * Ensure program sections exist for an organization, seeding defaults when needed
 * and backfilling the organization_settings table when the key is missing or empty.
 *
 * @param {Object} db - Database client or pool exposing a `query` method.
 * @param {number} organizationId - Organization identifier.
 * @param {string} [locale='en'] - Locale used to pick default labels for settings.
 */
async function ensureProgramSectionsSeeded(db, organizationId, locale = 'en') {
  const defaults = buildDefaultProgramSections(locale);
  const sectionKeys = defaults.map(section => section.key);
  const sectionLabels = defaults.map(section => section.label);

  // Seed the organization_program_sections table when empty for this organization
  await db.query(
    `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
     SELECT $1, data.section_key, data.display_name
     FROM unnest($2::text[], $3::text[]) AS data(section_key, display_name)
     ON CONFLICT (organization_id, section_key) DO NOTHING`,
    [organizationId, sectionKeys, sectionLabels]
  );

  // Ensure organization_settings has a program_sections entry for clients
  const existingSetting = await db.query(
    `SELECT setting_value FROM organization_settings
     WHERE organization_id = $1 AND setting_key = 'program_sections'`,
    [organizationId]
  );

  const parsedSetting = existingSetting.rows[0]?.setting_value
    ? parseSettingValue(existingSetting.rows[0].setting_value)
    : null;

  const shouldUpsertSetting = !Array.isArray(parsedSetting) || parsedSetting.length === 0;

  if (shouldUpsertSetting) {
    const serializedDefaults = JSON.stringify(defaults);

    if (existingSetting.rows.length === 0) {
      await db.query(
        `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
         VALUES ($1, 'program_sections', $2)`,
        [organizationId, serializedDefaults]
      );
    } else {
      await db.query(
        `UPDATE organization_settings
         SET setting_value = $1
         WHERE organization_id = $2 AND setting_key = 'program_sections'`,
        [serializedDefaults, organizationId]
      );
    }
  }
}

/**
 * Retrieve the program sections available to an organization.
 *
 * @param {Object} db - Database client or pool exposing a `query` method.
 * @param {number} organizationId - Organization identifier.
 * @returns {Promise<Array<{key: string, label: string, labelKey: string}>>} List of sections.
 */
async function getProgramSections(db, organizationId) {
  const sectionsResult = await db.query(
    `SELECT section_key, display_name
     FROM organization_program_sections
     WHERE organization_id = $1
     ORDER BY display_name`,
    [organizationId]
  );

  // If nothing exists (legacy org), seed defaults then re-query
  if (sectionsResult.rows.length === 0) {
    await ensureProgramSectionsSeeded(db, organizationId);
    const refreshedResult = await db.query(
      `SELECT section_key, display_name
       FROM organization_program_sections
       WHERE organization_id = $1
       ORDER BY display_name`,
      [organizationId]
    );
    return refreshedResult.rows.map(row => ({
      key: row.section_key,
      label: row.display_name,
      labelKey: `program_section_${row.section_key}`
    }));
  }

  return sectionsResult.rows.map(row => ({
    key: row.section_key,
    label: row.display_name,
    labelKey: `program_section_${row.section_key}`
  }));
}

/**
 * Validate a program section key for a given organization.
 *
 * @param {Object} db - Database client or pool exposing a `query` method.
 * @param {number} organizationId - Organization identifier.
 * @param {string} programSection - Section key to validate.
 * @returns {Promise<{valid: boolean, message?: string}>>} Validation result.
 */
async function validateProgramSection(db, organizationId, programSection) {
  const normalizedSection = typeof programSection === 'string'
    ? programSection.trim()
    : '';

  if (!normalizedSection) {
    return { valid: false, message: 'Program section is required' };
  }

  const sections = await getProgramSections(db, organizationId);
  const exists = sections.some(section => section.key === normalizedSection);

  if (!exists) {
    return { valid: false, message: 'Invalid program section for this organization' };
  }

  return { valid: true };
}

module.exports = {
  DEFAULT_PROGRAM_SECTIONS,
  buildDefaultProgramSections,
  ensureProgramSectionsSeeded,
  getProgramSections,
  validateProgramSection
};
