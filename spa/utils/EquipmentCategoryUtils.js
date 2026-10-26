/**
 * Equipment categories: a fixed list (config/equipment_categories.json, which
 * the server validates against), each shown in the reader's language.
 *
 * @module spa/utils/EquipmentCategoryUtils
 */

import { translate } from '../app.js';
import { escapeHTML, escapeAttribute } from './SecurityUtils.js';
import categoryConfig from '../../config/equipment_categories.json';

/** Category keys, in the order they are offered. */
export const EQUIPMENT_CATEGORIES = Object.freeze([...categoryConfig.categories]);

/**
 * The label of a category in the reader's language.
 *
 * @param {string|null|undefined} category - Category key
 * @returns {string} Translated label; "Other" for a missing or unknown key
 */
export function equipmentCategoryLabel(category) {
  const key = EQUIPMENT_CATEGORIES.includes(category) ? category : 'other';
  return translate(`equipment_category_${key}`);
}

/**
 * `<option>`s for a category picker, sorted by label in the reader's language.
 *
 * @param {string|null} selected - Key to preselect (Other when none)
 * @returns {string} HTML
 */
export function equipmentCategoryOptions(selected = 'other') {
  const current = EQUIPMENT_CATEGORIES.includes(selected) ? selected : 'other';
  return EQUIPMENT_CATEGORIES
    .map((key) => ({ key, label: equipmentCategoryLabel(key) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ key, label }) =>
      `<option value="${escapeAttribute(key)}" ${key === current ? 'selected' : ''}>${escapeHTML(label)}</option>`)
    .join('');
}
