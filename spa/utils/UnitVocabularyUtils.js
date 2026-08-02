import customizationConfig from '../../config/unit_customization.json';

const CUSTOM_PROFILE = 'custom';
const CUSTOMIZABLE_LOCALES = new Set(['en', 'fr']);
const DIRECT_VOCABULARY_KEYS = Object.freeze({
  Tannière: 'subgroup_singular',
  first_leader: 'primary_youth_leader',
  second_leader: 'assistant_youth_leader',
  individuals: 'youth_plural',
  groups: 'subgroup_plural',
  honors: 'honor_plural',
  youth_of_honor: 'honor_singular',
  louveteau_dhonneur: 'honor_singular',
  youth_of_honor_label_cubs: 'honor_singular',
  manage_honors: 'honor_plural',
  honors_report_title: 'honor_plural',
  badge_type_proie: 'individual_achievement',
  badge_type_battue: 'group_achievement',
  scout_year_title: 'program_year',
  scout_year_dens_title: 'subgroup_plural',
});
const VOCABULARY_TEMPLATE_KEYS = Object.freeze({
  activity_welcome_cubs: 'vocabulary_activity_welcome',
  award_honor: 'vocabulary_award_honor',
  number_of_honors: 'vocabulary_number_of_honors',
  den_list_report: 'vocabulary_den_list_report',
  unassigned_participants: 'vocabulary_unassigned_participants',
  badge_tracker_title: 'vocabulary_badge_tracker_title',
  badge_tracker_subtitle: 'vocabulary_badge_tracker_subtitle',
  badge_search_placeholder: 'vocabulary_badge_search_placeholder',
  tile_den_list_report: 'vocabulary_tile_den_list_report',
  objectif_proie: 'vocabulary_individual_achievement_objective',
  meeting_focus_placeholder: 'vocabulary_meeting_focus_placeholder',
  honor_already_awarded: 'vocabulary_honor_already_awarded',
  honor_already_awarded_for_date: 'vocabulary_honor_already_awarded',
  honor_awarded_successfully: 'vocabulary_honor_awarded_successfully',
  honors_awarded_successfully: 'vocabulary_honors_awarded_successfully',
  scout_year_exception_placeholder: 'vocabulary_program_year_exception_placeholder',
  scout_year_dens_description: 'vocabulary_program_year_subgroups_description',
  scout_year_rollback_blocker_dens_assigned: 'vocabulary_program_year_subgroups_assigned',
  tile_manage_points_aliases: 'vocabulary_tile_manage_points_aliases',
  tile_manage_honors_aliases: 'vocabulary_tile_manage_honors_aliases',
  tile_manage_participants_aliases: 'vocabulary_tile_manage_participants_aliases',
  tile_manage_groups_aliases: 'vocabulary_tile_manage_groups_aliases',
  tile_den_list_report_aliases: 'vocabulary_tile_den_list_report_aliases',
  click_to_add_honors: 'vocabulary_click_to_add_honors',
  honor_awarded: 'vocabulary_honor_awarded',
  honor_count: 'vocabulary_honor_count',
  honors_count: 'vocabulary_honors_count',
  honor_name: 'vocabulary_honor_name',
  last_honor_date: 'vocabulary_last_honor_date',
  no_honors_on_this_date: 'vocabulary_no_honors_on_this_date',
  error_loading_honors: 'vocabulary_error_loading_honors',
  error_awarding_honor: 'vocabulary_error_awarding_honor',
  honor_reason_placeholder: 'vocabulary_honor_reason_placeholder',
  honor_reason_prompt: 'vocabulary_honor_reason_prompt',
  honor_reason_required: 'vocabulary_honor_reason_required',
  confirm_delete_honor: 'vocabulary_confirm_delete_honor',
  honor_updated_successfully: 'vocabulary_honor_updated_successfully',
  honor_date_updated_successfully: 'vocabulary_honor_date_updated_successfully',
  error_updating_honor: 'vocabulary_error_updating_honor',
  error_undoing_honor: 'vocabulary_error_undoing_honor',
  error_deleting_honor: 'vocabulary_error_deleting_honor',
  honor_undone_successfully: 'vocabulary_honor_undone_successfully',
  honor_deleted_successfully: 'vocabulary_honor_deleted_successfully',
  changing_date_warning: 'vocabulary_changing_honor_date_warning',
  select_individuals: 'vocabulary_select_youth',
});

/**
 * Resolve the effective vocabulary profile while preserving the legacy Cubs
 * experience for organizations that have never saved this setting.
 *
 * @param {object|null} organizationSettings - Loaded organization settings.
 * @returns {string} Built-in profile key or `custom`.
 */
export function getVocabularyProfile(organizationSettings = {}) {
  const configuredProfile = organizationSettings?.unit_vocabulary?.profile;
  if (configuredProfile === CUSTOM_PROFILE || customizationConfig.profiles[configuredProfile]) {
    return configuredProfile;
  }

  const programSection = organizationSettings?.program_section;
  if (programSection && customizationConfig.profiles[programSection]) {
    return programSection;
  }

  return 'cubs';
}

/**
 * Return a complete locale-specific vocabulary, merging editable organization
 * values over a safe built-in preset.
 *
 * @param {object|null} organizationSettings - Loaded organization settings.
 * @param {string} locale - Active interface locale.
 * @returns {object} Resolved vocabulary terms, or an empty object for locales
 *   without customizable presets so callers can retain same-locale translations.
 */
export function getUnitVocabulary(organizationSettings = {}, locale = 'en') {
  if (!CUSTOMIZABLE_LOCALES.has(locale)) {
    return {};
  }

  const profile = getVocabularyProfile(organizationSettings);
  const baseProfile = profile === CUSTOM_PROFILE ? 'generic' : profile;
  const defaults = customizationConfig.profiles[baseProfile]?.locales?.[locale]
    || customizationConfig.profiles.generic.locales[locale]
    || {};
  const overrides = organizationSettings?.unit_vocabulary?.locales?.[locale] || {};
  return { ...defaults, ...overrides };
}

/** Resolve one vocabulary term, retaining a translated same-locale fallback. */
export function getVocabularyTerm(organizationSettings, locale, termKey, fallback = '') {
  return getUnitVocabulary(organizationSettings, locale)[termKey] || fallback;
}

export function getDirectVocabularyTermKey(translationKey) {
  return DIRECT_VOCABULARY_KEYS[translationKey] || null;
}

export function getVocabularyTemplateKey(translationKey) {
  return VOCABULARY_TEMPLATE_KEYS[translationKey] || null;
}

/** Return a deep copy of a built-in profile for use in editable forms. */
export function createVocabularyFromProfile(profile) {
  const profileKey = customizationConfig.profiles[profile] ? profile : 'generic';
  return {
    version: customizationConfig.version,
    profile: profileKey,
    locales: JSON.parse(JSON.stringify(customizationConfig.profiles[profileKey].locales))
  };
}

export const UNIT_CUSTOMIZATION_CONFIG = customizationConfig;
