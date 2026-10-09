import { debugError } from '../utils/DebugUtils.js';

/**
 * Parent dashboard buttons a unit may hide (Unit settings → Parent dashboard).
 *
 * The keys must match `parentDashboardButtonKeys` in
 * `config/unit_customization.json`, which the server validates against.
 * Adding a child, account settings and sign-out are deliberately absent:
 * a unit can never hide them.
 *
 * Hiding a button only removes it from the parent dashboard. It changes no
 * permission, and a button still appears only to accounts allowed to open
 * its page.
 *
 * Shape:
 *   key      stored in `parent_dashboard_configuration.hidden_button_keys`
 *   label    translation key, the same label the parent sees
 *   section  `actions` (main actions) or `child` (on each child's card)
 */
export const PARENT_DASHBOARD_BUTTONS = Object.freeze([
  { key: 'finances', label: 'my_finances', section: 'actions' },
  { key: 'family_access', label: 'family_access_title', section: 'actions' },
  { key: 'program_progress', label: 'program_progress_parent_link', section: 'actions' },
  { key: 'download_calendar', label: 'download_activities_calendar', section: 'actions' },
  { key: 'carpool', label: 'carpool_coordination', section: 'actions' },
  { key: 'request_badge', label: 'manage_badge_progress', section: 'child' },
  { key: 'progress_report', label: 'view_progress_report', section: 'child' },
  { key: 'medications', label: 'manage_medications', section: 'child' },
]);

export const PARENT_DASHBOARD_BUTTON_SECTIONS = Object.freeze(['actions', 'child']);

/**
 * Button keys the unit has hidden on the parent dashboard.
 *
 * @param {Object} [settings] - Organization settings
 * @returns {Set<string>} Hidden button keys; empty when none are configured
 */
export function getHiddenParentDashboardButtons(settings) {
  const keys = settings?.parent_dashboard_configuration?.hidden_button_keys;
  return new Set(Array.isArray(keys) ? keys : []);
}

/**
 * Read which buttons the unit hid, fresh on every visit. The public settings
 * carry the choice to every account (parents may not hold org.view) and are
 * not cached in the browser, whereas the app's copy of the settings can be a
 * day old. That copy is the fallback when the request fails (offline); with
 * neither, every button shows: hiding is a convenience, never a reason to
 * break the page.
 *
 * @param {Object} [settings] - Organization settings already loaded by the app
 * @param {Function} fetchPublicSettings - Loads the public organization settings
 * @returns {Promise<Set<string>>} Hidden button keys
 */
export async function loadHiddenParentDashboardButtons(settings, fetchPublicSettings) {
  try {
    const response = await fetchPublicSettings();
    return getHiddenParentDashboardButtons(response?.data || response);
  } catch (error) {
    debugError('Failed to load parent dashboard buttons:', error);
    return getHiddenParentDashboardButtons(settings);
  }
}
