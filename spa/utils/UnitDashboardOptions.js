/**
 * Controls a unit turns on for its leaders under Unit settings › Dashboard.
 *
 * They are off unless the unit lists them in
 * `dashboard_configuration.enabled_option_keys`: consulting an earlier scout
 * year and choosing dashboard colours are occasional needs, and a control
 * nobody uses is one more thing on a phone screen.
 *
 * @module spa/utils/UnitDashboardOptions
 */

/** The option keys, as `config/unit_customization.json` lists them. */
export const DASHBOARD_OPTIONS = Object.freeze({
  SCOUT_YEAR_SELECTOR: 'scout_year_selector',
  PALETTE_PICKER: 'palette_picker',
});

/**
 * Whether the unit turned an option on.
 *
 * @param {Object|null|undefined} organizationSettings - The unit's settings
 * @param {string} optionKey - One of DASHBOARD_OPTIONS
 * @returns {boolean} True when the unit listed it
 */
export function isUnitDashboardOptionEnabled(organizationSettings, optionKey) {
  const enabled = organizationSettings?.dashboard_configuration?.enabled_option_keys;
  return Array.isArray(enabled) && enabled.includes(optionKey);
}
