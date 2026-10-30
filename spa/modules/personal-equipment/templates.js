import rules from '../../../config/personal_equipment.json';

const TEMPLATE_CATEGORY = new Map([...rules.items, ...Object.values(rules.seasonal).flat()].map((item) => [item.key, item.category]));

/** Draft suggestions only: the team reviews quantities and conditions before publication. */
export function personalEquipmentTemplate(season, nights, stayType) {
  return [...rules.items.filter((item) => !item.overnight || stayType !== 'day'), ...(rules.seasonal[season] || [])]
    .map((item) => ({ key: item.key, label_fr: item.label_fr, label_en: item.label_en, category: item.category,
      quantity: item.per_day ? Math.max(1, Math.min(rules.MAX_QUANTITY, nights + 1)) : 1, catalog_item_id: null }));
}

/**
 * The category an item is shown under: its own, else its suggestion's, else "other".
 * Lists saved before categories existed are grouped without being edited.
 * @param {{key: string, category?: string|null}} item
 * @returns {string}
 */
export function itemCategory(item) {
  if (rules.CATEGORIES.includes(item.category)) { return item.category; }
  return TEMPLATE_CATEGORY.get(item.key) || 'other';
}

/**
 * Items grouped by category, in the configured category order, each group keeping the list's order.
 * @param {Object[]} items
 * @returns {Array<{category: string, items: Object[]}>} Non-empty groups only
 */
export function groupByCategory(items) {
  return rules.CATEGORIES
    .map((category) => ({ category, items: items.filter((item) => itemCategory(item) === category) }))
    .filter((group) => group.items.length);
}

export { rules as PERSONAL_EQUIPMENT };
