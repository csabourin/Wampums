/**
 * Equipment catalogue limits, as the server checks them
 * (services/equipmentCatalog.js).
 *
 * @module spa/config/equipment-catalog
 */
export const EQUIPMENT_CATALOG_LIMITS = Object.freeze({
  NAME_MAX_LENGTH: 150,
  QUANTITY_MAX: 99999,
  ITEMS_MAX: 50,
});
