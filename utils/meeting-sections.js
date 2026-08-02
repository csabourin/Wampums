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
 * Resolve the active section without letting the database's legacy `general`
 * default erase an explicitly saved meeting section. Once unit vocabulary has
 * been saved, its synchronized program section becomes authoritative.
 *
 * @param {object} meetingSections Merged meeting section configuration.
 * @param {object} context Organization section settings.
 * @returns {string} Active meeting section key.
 */
function resolveMeetingSectionKey(meetingSections, context = {}) {
  const sections = meetingSections?.sections || {};
  const legacySection = context.organizationInfo?.meeting_section;
  const programSection = context.programSection;

  if (!context.hasUnitVocabulary && legacySection && sections[legacySection]) {
    return legacySection;
  }
  if (programSection && sections[programSection]) {
    return programSection;
  }
  if (legacySection && sections[legacySection]) {
    return legacySection;
  }
  return meetingSections.defaultSection;
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
    `SELECT o.program_section,
            meeting_sections.setting_value AS meeting_sections,
            organization_info.setting_value AS organization_info,
            (unit_vocabulary.setting_value IS NOT NULL) AS has_unit_vocabulary
     FROM organizations o
     LEFT JOIN organization_settings meeting_sections
       ON meeting_sections.organization_id = o.id AND meeting_sections.setting_key = 'meeting_sections'
     LEFT JOIN organization_settings organization_info
       ON organization_info.organization_id = o.id AND organization_info.setting_key = 'organization_info'
     LEFT JOIN organization_settings unit_vocabulary
       ON unit_vocabulary.organization_id = o.id AND unit_vocabulary.setting_key = 'unit_vocabulary'
     WHERE o.id = $1`,
    [organizationId]
  );

  const organizationRow = orgSetting.rows[0] || {};
  const organizationInfo = parseSettingValue(organizationRow.organization_info, logger) || {};
  const sectionContext = {
    programSection: organizationRow.program_section,
    organizationInfo,
    hasUnitVocabulary: organizationRow.has_unit_vocabulary === true
  };
  const parsedOrgSetting = parseSettingValue(organizationRow.meeting_sections, logger);
  if (parsedOrgSetting) {
    const mergedConfig = mergeMeetingSectionConfig(parsedOrgSetting);
    mergedConfig.defaultSection = resolveMeetingSectionKey(mergedConfig, sectionContext);
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
    mergedShared.defaultSection = resolveMeetingSectionKey(mergedShared, sectionContext);
    return mergedShared;
  }

  // Final fallback to static defaults
  const mergedDefaults = mergeMeetingSectionConfig(defaultMeetingSections);
  mergedDefaults.defaultSection = resolveMeetingSectionKey(mergedDefaults, sectionContext);
  return mergedDefaults;
}

module.exports = {
  getMeetingSectionConfig,
  mergeMeetingSectionConfig,
  resolveMeetingSectionKey
};
