/**
 * Labels for the starter activity catalogue's vocabularies
 * (config/activity_library_starter.json), in the reader's language.
 *
 * The keys are listed here rather than imported, so the catalogue's full text
 * stays out of the SPA bundle; test/spa/StarterActivities.test.js keeps the
 * lists equal to the catalogue's.
 *
 * @module spa/utils/ActivityLibraryUtils
 */

import { translate } from '../app.js';

/** Catalogue categories, in the catalogue's order. */
export const STARTER_CATEGORIES = Object.freeze([
  'game', 'technique', 'discovery', 'expression', 'discussion', 'ceremony', 'project', 'meeting_block',
]);

/** Catalogue branches (program sections it is written for). */
export const STARTER_BRANCHES = Object.freeze(['beavers', 'cubs', 'scouts']);

/** Catalogue seasons. */
export const STARTER_SEASONS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);

/** Settings every catalogue entry declares through its tags. */
export const STARTER_SETTINGS = Object.freeze(['indoor', 'outdoor']);

/**
 * The label of a library activity's category. Starter copies store the
 * catalogue key; activities written by hand keep the text their unit typed.
 *
 * @param {string|null|undefined} category - activity_library.category
 * @returns {string} Label (unescaped)
 */
export function activityCategoryLabel(category) {
  if (STARTER_CATEGORIES.includes(category)) {
    return translate(`starter_category_${category}`);
  }
  return typeof category === 'string' ? category : '';
}

/**
 * @param {string} branch - Catalogue branch key
 * @returns {string} Label in the reader's language
 */
export function starterBranchLabel(branch) {
  return STARTER_BRANCHES.includes(branch) ? translate(`starter_branch_${branch}`) : '';
}

/**
 * @param {string} season - Catalogue season key
 * @returns {string} Label in the reader's language
 */
export function starterSeasonLabel(season) {
  return STARTER_SEASONS.includes(season) ? translate(`starter_season_${season}`) : '';
}

/**
 * @param {string} setting - 'indoor' or 'outdoor'
 * @returns {string} Label in the reader's language
 */
export function starterSettingLabel(setting) {
  return STARTER_SETTINGS.includes(setting) ? translate(`starter_setting_${setting}`) : '';
}
