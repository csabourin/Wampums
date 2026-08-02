const defaultMeetingSections = require('../config/meeting_sections.json');

/**
 * Safely parse a JSON string value from the database.
 *
 * @param {string|object} rawValue - Raw setting_value column value
 * @param {Object} logger - Winston logger
 * @returns {object|null} Parsed object or null
 */
function parseSettingValue(rawValue, logger) {
  if (!rawValue) return null;

  if (typeof rawValue === 'object') {
    return rawValue;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    if (logger) {
      logger.warn('Failed to parse meeting_sections setting, using defaults', { error: error.message });
    }
    return null;
  }
}

/**
 * Merge custom meeting section configuration with defaults.
 *
 * @param {object|null} customConfig - Custom configuration from settings
 * @returns {object} Merged meeting section configuration
 */
function mergeMeetingSectionConfig(customConfig) {
  const resolvedConfig = typeof customConfig === 'object' && customConfig !== null
    ? customConfig
    : {};

  const sections = {
    ...(defaultMeetingSections.sections || {}),
    ...(resolvedConfig.sections || {})
  };

  const defaultSectionKey = resolvedConfig.defaultSection
    || defaultMeetingSections.defaultSection
    || Object.keys(sections)[0];

  return {
    defaultSection: defaultSectionKey,
    sections
  };
}

/**
 * Get meeting section configuration for an organization, with fallback to
 * global defaults (organization_id = 0) and static defaults.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Organization identifier
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<object>} Meeting section configuration
 */
async function getMeetingSectionConfig(pool, organizationId, logger) {
  // Try organization-specific settings first
  const orgSetting = await pool.query(
    `SELECT o.program_section, os.setting_value
     FROM organizations o
     LEFT JOIN organization_settings os
       ON os.organization_id = o.id AND os.setting_key = 'meeting_sections'
     WHERE o.id = $1`,
    [organizationId]
  );

  const parsedOrgSetting = parseSettingValue(orgSetting.rows[0]?.setting_value, logger);
  if (parsedOrgSetting) {
    const mergedConfig = mergeMeetingSectionConfig(parsedOrgSetting);
    const programSection = orgSetting.rows[0]?.program_section;
    if (programSection && mergedConfig.sections[programSection]) {
      mergedConfig.defaultSection = programSection;
    }
    return mergedConfig;
  }

  // Fallback to shared defaults stored under organization_id = 0
  const sharedSetting = await pool.query(
    `SELECT setting_value FROM organization_settings
     WHERE organization_id = 0 AND setting_key = 'meeting_sections'`
  );

  const parsedShared = parseSettingValue(sharedSetting.rows[0]?.setting_value, logger);
  if (parsedShared) {
    const mergedShared = mergeMeetingSectionConfig(parsedShared);
    const programSection = orgSetting.rows[0]?.program_section;
    if (programSection && mergedShared.sections[programSection]) {
      mergedShared.defaultSection = programSection;
    }
    return mergedShared;
  }

  // Final fallback to static defaults
  const mergedDefaults = mergeMeetingSectionConfig(defaultMeetingSections);
  const programSection = orgSetting.rows[0]?.program_section;
  if (programSection && mergedDefaults.sections[programSection]) {
    mergedDefaults.defaultSection = programSection;
  }
  return mergedDefaults;
}

module.exports = {
  getMeetingSectionConfig,
  mergeMeetingSectionConfig
};
