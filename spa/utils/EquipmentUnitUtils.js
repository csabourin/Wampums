/**
 * Units of measure of catalogue articles: a fixed list
 * (config/equipment_units.json, which the server validates against), each
 * shown in the reader's language.
 *
 * @module spa/utils/EquipmentUnitUtils
 */

import { translate } from '../app.js';
import { escapeHTML, escapeAttribute } from './SecurityUtils.js';
import { localeForLanguage } from './InterfaceLanguageUtils.js';
import unitConfig from '../../config/equipment_units.json';

/** Unit keys, in the order they are offered. */
export const EQUIPMENT_UNITS = Object.freeze([...unitConfig.units]);

/** At most two decimals, as the server stores them. */
const QUANTITY_FRACTION_DIGITS = 2;

/**
 * The label of a unit in the reader's language.
 *
 * @param {string|null|undefined} unit - Unit key
 * @returns {string} Translated label; "each" for a missing or unknown key
 */
export function equipmentUnitLabel(unit) {
  const key = EQUIPMENT_UNITS.includes(unit) ? unit : 'each';
  return translate(`equipment_unit_${key}`);
}

/**
 * `<option>`s for a unit picker, in the configured order.
 *
 * @param {string|null} selected - Key to preselect (each when none)
 * @returns {string} HTML
 */
export function equipmentUnitOptions(selected = 'each') {
  const current = EQUIPMENT_UNITS.includes(selected) ? selected : 'each';
  return EQUIPMENT_UNITS
    .map((key) =>
      `<option value="${escapeAttribute(key)}" ${key === current ? 'selected' : ''}>${escapeHTML(equipmentUnitLabel(key))}</option>`)
    .join('');
}

/**
 * A quantity with its unit, placed as the reader's language writes them
 * (`equipment_quantity_with_unit`).
 *
 * @param {number} quantity
 * @param {string} unit - Unit key
 * @param {string} lang - Reader's language
 * @returns {string} Plain text, e.g. "2.5 kg"
 */
export function formatEquipmentQuantity(quantity, unit, lang) {
  const amount = new Intl.NumberFormat(localeForLanguage(lang), {
    maximumFractionDigits: QUANTITY_FRACTION_DIGITS,
  }).format(Number(quantity) || 0);
  return translate('equipment_quantity_with_unit')
    .replace('{quantity}', amount)
    .replace('{unit}', equipmentUnitLabel(unit));
}
