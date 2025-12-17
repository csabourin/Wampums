import defaultMeetingSections from "../../config/meeting_sections.json";

/**
 * Merge custom meeting section configuration with defaults.
 *
 * @param {object|null} customConfig - Organization-specific meeting section config
 * @returns {object} Combined configuration
 */
export function mergeMeetingSectionConfig(customConfig) {
  const resolvedConfig = typeof customConfig === "object" && customConfig !== null
    ? customConfig
    : {};

  const sections = {
    ...(defaultMeetingSections.sections || {}),
    ...(resolvedConfig.sections || {})
  };

  const defaultSection = resolvedConfig.defaultSection
    || defaultMeetingSections.defaultSection
    || Object.keys(sections)[0];

  return {
    defaultSection,
    sections
  };
}

/**
 * Resolve which section configuration to use based on organization settings.
 *
 * @param {object} meetingSectionConfig - Config object that may already include merged sections
 * @param {object} organizationSettings - Organization settings payload
 * @returns {{ sectionKey: string, sectionConfig: object, mergedConfig: object }}
 */
export function getActiveSectionConfig(meetingSectionConfig, organizationSettings) {
  const mergedConfig = mergeMeetingSectionConfig(meetingSectionConfig || organizationSettings?.meeting_sections);
  const requestedSection = organizationSettings?.organization_info?.meeting_section;

  const sectionKey = requestedSection && mergedConfig.sections[requestedSection]
    ? requestedSection
    : mergedConfig.defaultSection;

  return {
    sectionKey,
    sectionConfig: mergedConfig.sections[sectionKey] || mergedConfig.sections[mergedConfig.defaultSection],
    mergedConfig
  };
}

/**
 * Get the honor label for the current section (translated if possible).
 *
 * @param {object} sectionConfig - Active section configuration
 * @param {Function} translateFn - Translate function
 * @returns {string} Honor label
 */
export function getHonorLabel(sectionConfig, translateFn) {
  if (sectionConfig?.honorField?.label) {
    return sectionConfig.honorField.label;
  }

  const labelKey = sectionConfig?.honorField?.labelKey || "youth_of_honor";
  return translateFn ? translateFn(labelKey) : labelKey;
}

/**
 * Return the activity templates for the active section, with a default fallback.
 *
 * @param {object} sectionConfig - Active section configuration
 * @returns {Array} Activity templates
 */
export function getSectionActivityTemplates(sectionConfig) {
  const fallbackSection = defaultMeetingSections.sections?.[defaultMeetingSections.defaultSection] || {};
  const fallbackTemplates = fallbackSection.activityTemplates || [];

  return sectionConfig?.activityTemplates?.length
    ? sectionConfig.activityTemplates
    : fallbackTemplates;
}
