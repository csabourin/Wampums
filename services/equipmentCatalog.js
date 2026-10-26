'use strict';

/**
 * The unit's equipment catalogue, and the catalogue articles a schedule line
 * needs.
 *
 * An article is named once per unit (name, category, unit of measure,
 * optionally the inventory item it is) and offered in every material list of
 * that unit, never another's. Articles are archived rather than deleted, so a
 * schedule line keeps naming one the unit no longer offers. A schedule line
 * keeps its free-text material; catalogue articles are listed beside it.
 *
 * @module services/equipmentCatalog
 */

const { EQUIPMENT_CATEGORIES } = require('./equipmentCategories');
const { isEquipmentAccessible } = require('./equipmentAccess');
const { units: EQUIPMENT_UNITS } = require('../config/equipment_units.json');

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const PG_UNIQUE_VIOLATION = '23505';

/** Longest article name, as equipment_items.name. */
const CATALOG_NAME_MAX_LENGTH = 150;
/** Most articles one schedule line may list. */
const MATERIAL_ITEMS_MAX = 50;
/** Largest quantity of one article (NUMERIC(10, 2) holds far more). */
const MATERIAL_QUANTITY_MAX = 99999;
const POSTGRES_INT_MAX = 2147483647;
const QUANTITY_PATTERN = /^\d{1,5}(?:\.\d{1,2})?$/;
const ID_PATTERN = /^[1-9]\d{0,9}$/;

/** A catalogue refusal safe to return to the caller, as a translation key. */
class CatalogError extends Error {
  constructor(message, status, field = null) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/**
 * Read an id sent as a number or a string of digits.
 *
 * @param {*} value
 * @returns {number|null} The id; null when it is not one
 */
function readId(value) {
  if (!['number', 'string'].includes(typeof value) || !ID_PATTERN.test(String(value))) {
    return null;
  }
  const id = Number(value);
  return id <= POSTGRES_INT_MAX ? id : null;
}

/**
 * Read a quantity sent as a number or a string: above zero, at most
 * MATERIAL_QUANTITY_MAX, and at most two decimals.
 *
 * @param {*} value
 * @returns {number|null} The quantity; null when it is not one
 */
function readQuantity(value) {
  if (!['number', 'string'].includes(typeof value) || !QUANTITY_PATTERN.test(String(value))) {
    return null;
  }
  const quantity = Number(value);
  return quantity > 0 && quantity <= MATERIAL_QUANTITY_MAX ? quantity : null;
}

/**
 * Read the catalogue articles of a schedule line, as sent by a client.
 *
 * @param {*} value - `material_items` from a request body
 * @returns {Array<{catalog_item_id: number, quantity: number}>|null}
 *   The articles; null when the value is malformed, lists too many, or names
 *   one article twice
 */
function readMaterialItems(value) {
  if (!Array.isArray(value) || value.length > MATERIAL_ITEMS_MAX) {
    return null;
  }
  const items = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const catalogItemId = readId(item.catalog_item_id);
    const quantity = readQuantity(item.quantity);
    return catalogItemId && quantity ? { catalog_item_id: catalogItemId, quantity } : null;
  });
  if (items.includes(null)) {
    return null;
  }
  const ids = new Set(items.map((item) => item.catalog_item_id));
  return ids.size === items.length ? items : null;
}

/**
 * express-validator check for an optional `material_items` field.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isMaterialItems(value) {
  return readMaterialItems(value) !== null;
}

/**
 * Turn a catalogue row into what the API returns.
 *
 * @param {Object} row
 * @returns {Object}
 */
function serializeCatalogItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit_of_measure: row.unit_of_measure,
    equipment_item_id: row.equipment_item_id,
    equipment_name: row.equipment_name || null,
    archived: row.archived_at !== null && row.archived_at !== undefined,
    usage_count: Number(row.usage_count) || 0,
  };
}

const CATALOG_SELECT = `
  SELECT c.id, c.name, c.category, c.unit_of_measure, c.equipment_item_id, c.archived_at,
         ei.name AS equipment_name,
         (SELECT COUNT(*) FROM meeting_activity_equipment mae
           WHERE mae.organization_id = c.organization_id AND mae.catalog_item_id = c.id) AS usage_count
    FROM equipment_catalog_items c
    LEFT JOIN equipment_items ei ON ei.id = c.equipment_item_id`;

/**
 * The unit's catalogue, sorted by name.
 *
 * @param {Object} db - pg pool or client
 * @param {number} organizationId
 * @param {{includeArchived?: boolean}} [options]
 * @returns {Promise<Object[]>}
 */
async function listCatalog(db, organizationId, { includeArchived = false } = {}) {
  const result = await db.query(
    `${CATALOG_SELECT}
      WHERE c.organization_id = $1
        AND ($2::boolean OR c.archived_at IS NULL)
      ORDER BY lower(c.name), c.id`,
    [organizationId, includeArchived],
  );
  return result.rows.map(serializeCatalogItem);
}

/**
 * One article of the unit's catalogue.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} itemId
 * @returns {Promise<Object|null>}
 */
async function getCatalogItem(db, organizationId, itemId) {
  const result = await db.query(
    `${CATALOG_SELECT}
      WHERE c.organization_id = $1 AND c.id = $2`,
    [organizationId, itemId],
  );
  return result.rows[0] ? serializeCatalogItem(result.rows[0]) : null;
}

/**
 * Refuse an inventory link to equipment the unit may not use.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {number|null} equipmentId
 */
async function checkEquipmentLink(db, organizationId, equipmentId) {
  if (equipmentId && !(await isEquipmentAccessible(db, organizationId, equipmentId))) {
    throw new CatalogError('equipment_catalog_equipment_unavailable', HTTP_BAD_REQUEST, 'equipment_item_id');
  }
}

/**
 * Run a write, reading a duplicate active name as a 409.
 *
 * @param {Function} write
 * @returns {Promise<*>}
 */
async function guardDuplicateName(write) {
  try {
    return await write();
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      throw new CatalogError('equipment_catalog_duplicate_name', HTTP_CONFLICT, 'name');
    }
    throw err;
  }
}

/**
 * Add an article to the unit's catalogue.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {string} userId - Who adds it
 * @param {{name: string, category?: string, unit_of_measure?: string, equipment_item_id?: number|null}} fields
 *   Validated fields
 * @returns {Promise<Object>} The new article
 */
async function createCatalogItem(db, organizationId, userId, fields) {
  const equipmentId = fields.equipment_item_id ? Number(fields.equipment_item_id) : null;
  await checkEquipmentLink(db, organizationId, equipmentId);
  const inserted = await guardDuplicateName(() => db.query(
    `INSERT INTO equipment_catalog_items
       (organization_id, name, category, unit_of_measure, equipment_item_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      organizationId, fields.name.trim(), fields.category || 'other',
      fields.unit_of_measure || 'each', equipmentId, userId,
    ],
  ));
  return getCatalogItem(db, organizationId, inserted.rows[0].id);
}

/**
 * Change an article of the unit's catalogue. Only the fields sent change;
 * `archived` archives or restores it.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} itemId
 * @param {Object} fields - Validated fields
 * @returns {Promise<Object>} The article as it now is
 */
async function updateCatalogItem(db, organizationId, itemId, fields) {
  const has = (field) => Object.prototype.hasOwnProperty.call(fields, field);
  const equipmentId = has('equipment_item_id') && fields.equipment_item_id
    ? Number(fields.equipment_item_id) : null;
  if (has('equipment_item_id')) {
    await checkEquipmentLink(db, organizationId, equipmentId);
  }
  const archived = has('archived') ? fields.archived === true || fields.archived === 'true' : null;
  const updated = await guardDuplicateName(() => db.query(
    `UPDATE equipment_catalog_items
        SET name = CASE WHEN $3::boolean THEN $4 ELSE name END,
            category = CASE WHEN $5::boolean THEN $6 ELSE category END,
            unit_of_measure = CASE WHEN $7::boolean THEN $8 ELSE unit_of_measure END,
            equipment_item_id = CASE WHEN $9::boolean THEN $10::integer ELSE equipment_item_id END,
            archived_at = CASE
              WHEN $11::boolean IS NULL THEN archived_at
              WHEN $11::boolean THEN COALESCE(archived_at, NOW())
              ELSE NULL
            END,
            updated_at = NOW()
      WHERE organization_id = $1 AND id = $2
      RETURNING id`,
    [
      organizationId, itemId,
      has('name'), has('name') ? String(fields.name).trim() : null,
      has('category'), fields.category ?? null,
      has('unit_of_measure'), fields.unit_of_measure ?? null,
      has('equipment_item_id'), equipmentId,
      archived,
    ],
  ));
  if (!updated.rows.length) {
    throw new CatalogError('equipment_catalog_item_not_found', HTTP_NOT_FOUND);
  }
  return getCatalogItem(db, organizationId, itemId);
}

/**
 * Replace the catalogue articles of a schedule line. Inside the caller's
 * transaction. An archived article may stay on a line that already lists it,
 * but is not offered for new ones.
 *
 * @param {Object} client - Transaction client
 * @param {number} organizationId
 * @param {number} activityId - year_plan_meeting_activities.id, of this unit
 * @param {Array<{catalog_item_id: number, quantity: number}>} items - From readMaterialItems
 */
async function replaceActivityMaterialItems(client, organizationId, activityId, items) {
  const ids = items.map((item) => item.catalog_item_id);
  if (ids.length) {
    const usable = await client.query(
      `SELECT c.id FROM equipment_catalog_items c
        WHERE c.organization_id = $1 AND c.id = ANY($2::int[])
          AND (c.archived_at IS NULL OR EXISTS (
            SELECT 1 FROM meeting_activity_equipment mae
             WHERE mae.organization_id = c.organization_id
               AND mae.meeting_activity_id = $3 AND mae.catalog_item_id = c.id))
        FOR SHARE OF c`,
      [organizationId, ids, activityId],
    );
    if (usable.rows.length !== ids.length) {
      throw new CatalogError('equipment_catalog_item_unavailable', HTTP_BAD_REQUEST, 'material_items');
    }
  }
  await client.query(
    'DELETE FROM meeting_activity_equipment WHERE organization_id = $1 AND meeting_activity_id = $2',
    [organizationId, activityId],
  );
  if (ids.length) {
    await client.query(
      `INSERT INTO meeting_activity_equipment (organization_id, meeting_activity_id, catalog_item_id, quantity)
       SELECT $1, $2, item.catalog_item_id, item.quantity
         FROM unnest($3::int[], $4::numeric[]) AS item(catalog_item_id, quantity)`,
      [organizationId, activityId, ids, items.map((item) => item.quantity)],
    );
  }
}

/**
 * The catalogue articles of several schedule lines, by line.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {number[]} activityIds
 * @returns {Promise<Map<number, Object[]>>}
 */
async function loadActivityMaterialItems(db, organizationId, activityIds) {
  const byActivity = new Map();
  if (!activityIds.length) {
    return byActivity;
  }
  const result = await db.query(
    `SELECT mae.meeting_activity_id, mae.catalog_item_id, mae.quantity,
            c.name, c.category, c.unit_of_measure, c.archived_at
       FROM meeting_activity_equipment mae
       JOIN equipment_catalog_items c
         ON c.id = mae.catalog_item_id AND c.organization_id = mae.organization_id
      WHERE mae.organization_id = $1 AND mae.meeting_activity_id = ANY($2::int[])
      ORDER BY lower(c.name), c.id`,
    [organizationId, activityIds],
  );
  for (const row of result.rows) {
    if (!byActivity.has(row.meeting_activity_id)) {
      byActivity.set(row.meeting_activity_id, []);
    }
    byActivity.get(row.meeting_activity_id).push({
      catalog_item_id: row.catalog_item_id,
      quantity: Number(row.quantity),
      name: row.name,
      category: row.category,
      unit_of_measure: row.unit_of_measure,
      archived: row.archived_at !== null,
    });
  }
  return byActivity;
}

/**
 * Give each schedule line its catalogue articles (`material_items`).
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {Object[]} activities - year_plan_meeting_activities rows
 * @returns {Promise<Object[]>} The same lines, each with material_items
 */
async function withMaterialItems(db, organizationId, activities) {
  const byActivity = await loadActivityMaterialItems(db, organizationId, activities.map((row) => row.id));
  return activities.map((row) => ({ ...row, material_items: byActivity.get(row.id) || [] }));
}

/**
 * Copy the active catalogue articles of schedule lines onto their copies.
 * Inside the caller's transaction.
 *
 * @param {Object} client
 * @param {number} organizationId
 * @param {number[]} sourceIds - Lines copied from
 * @param {number[]} targetIds - Their copies, in the same order
 */
async function copyActivityMaterialItems(client, organizationId, sourceIds, targetIds) {
  if (!sourceIds.length) {
    return;
  }
  await client.query(
    `INSERT INTO meeting_activity_equipment (organization_id, meeting_activity_id, catalog_item_id, quantity)
     SELECT $1, pair.target_id, mae.catalog_item_id, mae.quantity
       FROM unnest($2::int[], $3::int[]) AS pair(source_id, target_id)
       JOIN meeting_activity_equipment mae
         ON mae.organization_id = $1 AND mae.meeting_activity_id = pair.source_id
       JOIN equipment_catalog_items c
         ON c.id = mae.catalog_item_id AND c.organization_id = mae.organization_id
      WHERE c.archived_at IS NULL`,
    [organizationId, sourceIds, targetIds],
  );
}

module.exports = {
  CatalogError,
  CATALOG_NAME_MAX_LENGTH,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_UNITS,
  MATERIAL_ITEMS_MAX,
  MATERIAL_QUANTITY_MAX,
  readMaterialItems,
  isMaterialItems,
  listCatalog,
  getCatalogItem,
  createCatalogItem,
  updateCatalogItem,
  replaceActivityMaterialItems,
  loadActivityMaterialItems,
  withMaterialItems,
  copyActivityMaterialItems,
};
