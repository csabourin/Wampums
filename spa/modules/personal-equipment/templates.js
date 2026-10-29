import rules from '../../../config/personal_equipment.json';
/** Draft suggestions only: the team reviews quantities and conditions before publication. */
export function personalEquipmentTemplate(season, nights, stayType) {
  return [...rules.items.filter((item) => !item.overnight || stayType !== 'day'), ...(rules.seasonal[season] || [])]
    .map((item) => ({ key: item.key, label_fr: item.label_fr, label_en: item.label_en,
      quantity: item.per_day ? Math.max(1, Math.min(rules.MAX_QUANTITY, nights + 1)) : 1, catalog_item_id: null }));
}
export { rules as PERSONAL_EQUIPMENT };
