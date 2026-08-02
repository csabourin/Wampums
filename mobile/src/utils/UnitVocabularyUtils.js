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

let vocabularyByLocale = {};

/**
 * Configure the runtime vocabulary from the authenticated organization's
 * settings. Both supported locales are retained so language changes are
 * reflected without another settings request.
 *
 * @param {object|null} organizationSettings Loaded organization settings.
 */
export function configureUnitVocabulary(organizationSettings = {}) {
  const locales = organizationSettings?.unit_vocabulary?.locales;
  vocabularyByLocale = locales && typeof locales === 'object' ? locales : {};
}

/**
 * Apply organization vocabulary to a mobile translation when configured.
 * Organizations without the new setting retain their existing translations.
 *
 * @param {object} i18n Active i18n-js instance.
 * @param {string} locale Active application locale.
 * @param {string} key Requested translation key.
 * @param {string} fallback Already resolved translation.
 * @param {object} options Standard interpolation options.
 * @returns {string} Vocabulary-aware translation.
 */
export function translateWithUnitVocabulary(i18n, locale, key, fallback, options = {}) {
  const vocabulary = vocabularyByLocale[locale];
  if (!vocabulary || typeof vocabulary !== 'object') return fallback;

  const directTerm = DIRECT_VOCABULARY_KEYS[key];
  if (directTerm && vocabulary[directTerm]) return vocabulary[directTerm];

  const templateKey = VOCABULARY_TEMPLATE_KEYS[key];
  if (!templateKey) return fallback;

  const values = { ...options, ...vocabulary };
  const template = i18n.t(templateKey, { defaultValue: fallback });
  return Object.entries(values).reduce((translated, [name, value]) => {
    const placeholder = new RegExp(`\\{\\{?${name}\\}?\\}`, 'g');
    return translated.replace(placeholder, String(value));
  }, template);
}
