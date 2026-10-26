'use strict';

/**
 * The unit's equipment catalogue, and what a schedule line needs.
 *
 * An article is named once per unit (name, category, unit of measure,
 * optionally the inventory item it is) and offered in every material list of
 * that unit, never another's. Articles are archived rather than deleted, so a
 * schedule line keeps naming one the unit no longer offers.
 *
 * A schedule line lists, with a quantity, catalogue articles and inventory
 * items the unit may use (services/equipmentAccess.js): what the unit has or
 * can borrow. An inventory item an active article already stands for is
 * offered as that article only. The line keeps its free-text material beside.
 *
 * @module services/equipmentCatalog
 */

const { EQUIPMENT_CATEGORIES } = require('./equipmentCategories');
const {
  isEquipmentAccessible,
  findAccessibleEquipmentIds,
  listAccessibleEquipmentIds,
} = require('./equipmentAccess');
const { units: EQUIPMENT_UNITS } = require('../config/equipment_units.json');

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const PG_UNIQUE_VIOLATION = '23505';

/** Longest article name, as equipment_items.name. */
const CATALOG_NAME_MAX_LENGTH = 150;
/** Most entries one schedule line may list. */
const MATERIAL_ITEMS_MAX = 50;
/** Most choices offered at once: enough for any unit, small enough for one AI call. */
const MATERIAL_OPTIONS_MAX = 300;
/** Most entries the assistant may give one activity of a meeting. */
const PLAN_ITEMS_PER_ACTIVITY_MAX = 10;
/** Most entries the assistant may give a whole outing, as equipment suggestions. */
const PLAN_ITEMS_PER_OUTING_MAX = 25;
const QUANTITY_DECIMALS = 100;
/** References the assistant uses for a choice: a3 is article 3, e7 inventory item 7. */
const PLAN_REF_PATTERN = /^([ae])([1-9]\d{0,9})$/;
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
 * @param {{catalog_item_id?: number|null, equipment_item_id?: number|null}} item
 * @returns {string} One key per article or inventory item: a3, e7
 */
function entryKey(item) {
  return item.catalog_item_id ? `a${item.catalog_item_id}` : `e${item.equipment_item_id}`;
}

/**
 * Read what a schedule line needs, as sent by a client: each entry names one
 * catalogue article (`catalog_item_id`) or one inventory item
 * (`equipment_item_id`), with a quantity.
 *
 * @param {*} value - `material_items` from a request body
 * @returns {Array<{catalog_item_id: number|null, equipment_item_id: number|null, quantity: number}>|null}
 *   The entries; null when the value is malformed, lists too many, or names
 *   one article or item twice
 */
function readMaterialItems(value) {
  if (!Array.isArray(value) || value.length > MATERIAL_ITEMS_MAX) {
    return null;
  }
  const items = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const hasArticle = item.catalog_item_id !== undefined && item.catalog_item_id !== null;
    const hasEquipment = item.equipment_item_id !== undefined && item.equipment_item_id !== null;
    if (hasArticle === hasEquipment) {
      return null;
    }
    const catalogItemId = hasArticle ? readId(item.catalog_item_id) : null;
    const equipmentItemId = hasEquipment ? readId(item.equipment_item_id) : null;
    const quantity = readQuantity(item.quantity);
    if (!(catalogItemId || equipmentItemId) || !quantity) {
      return null;
    }
    return { catalog_item_id: catalogItemId, equipment_item_id: equipmentItemId, quantity };
  });
  if (items.includes(null)) {
    return null;
  }
  const keys = new Set(items.map(entryKey));
  return keys.size === items.length ? items : null;
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
 * Replace what a schedule line needs. Inside the caller's transaction.
 *
 * A catalogue article must be the unit's and active, an inventory item one the
 * unit may use. Either may stay on a line that already lists it after it was
 * archived or stopped being shared, so saving a line never drops it silently.
 *
 * @param {Object} client - Transaction client
 * @param {number} organizationId
 * @param {number} activityId - year_plan_meeting_activities.id, of this unit
 * @param {Array<Object>} items - From readMaterialItems
 */
async function replaceActivityMaterialItems(client, organizationId, activityId, items) {
  const articleIds = items.filter((item) => item.catalog_item_id).map((item) => item.catalog_item_id);
  const equipmentIds = items.filter((item) => item.equipment_item_id).map((item) => item.equipment_item_id);
  const [usableArticles, accessible, listed] = await Promise.all([
    articleIds.length
      ? client.query(
        `SELECT c.id FROM equipment_catalog_items c
          WHERE c.organization_id = $1 AND c.id = ANY($2::int[])
            AND (c.archived_at IS NULL OR EXISTS (
              SELECT 1 FROM meeting_activity_equipment mae
               WHERE mae.organization_id = c.organization_id
                 AND mae.meeting_activity_id = $3 AND mae.catalog_item_id = c.id))
          FOR SHARE OF c`,
        [organizationId, articleIds, activityId],
      )
      : { rows: [] },
    equipmentIds.length ? findAccessibleEquipmentIds(client, organizationId, equipmentIds) : new Set(),
    equipmentIds.length
      ? client.query(
        `SELECT equipment_item_id FROM meeting_activity_equipment
          WHERE organization_id = $1 AND meeting_activity_id = $2 AND equipment_item_id = ANY($3::int[])`,
        [organizationId, activityId, equipmentIds],
      )
      : { rows: [] },
  ]);
  const keptEquipment = new Set(listed.rows.map((row) => Number(row.equipment_item_id)));
  const usableEquipment = equipmentIds.filter((id) => accessible.has(id) || keptEquipment.has(id));
  if (usableArticles.rows.length !== articleIds.length || usableEquipment.length !== equipmentIds.length) {
    throw new CatalogError('equipment_catalog_item_unavailable', HTTP_BAD_REQUEST, 'material_items');
  }
  await client.query(
    'DELETE FROM meeting_activity_equipment WHERE organization_id = $1 AND meeting_activity_id = $2',
    [organizationId, activityId],
  );
  if (items.length) {
    await client.query(
      `INSERT INTO meeting_activity_equipment
         (organization_id, meeting_activity_id, catalog_item_id, equipment_item_id, quantity)
       SELECT $1, $2, entry.catalog_item_id, entry.equipment_item_id, entry.quantity
         FROM unnest($3::int[], $4::int[], $5::numeric[]) AS entry(catalog_item_id, equipment_item_id, quantity)`,
      [
        organizationId, activityId,
        items.map((item) => item.catalog_item_id),
        items.map((item) => item.equipment_item_id),
        items.map((item) => item.quantity),
      ],
    );
  }
}

/**
 * What several schedule lines need, by line. An inventory item reads as
 * "each"; it is archived once inactive.
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
    `SELECT mae.meeting_activity_id, mae.catalog_item_id, mae.equipment_item_id, mae.quantity,
            COALESCE(c.name, ei.name) AS name,
            COALESCE(c.category, ei.category, 'other') AS category,
            COALESCE(c.unit_of_measure, 'each') AS unit_of_measure,
            (c.archived_at IS NOT NULL OR ei.is_active = FALSE) AS archived
       FROM meeting_activity_equipment mae
       LEFT JOIN equipment_catalog_items c
         ON c.id = mae.catalog_item_id AND c.organization_id = mae.organization_id
       LEFT JOIN equipment_items ei ON ei.id = mae.equipment_item_id
      WHERE mae.organization_id = $1 AND mae.meeting_activity_id = ANY($2::int[])
      ORDER BY lower(COALESCE(c.name, ei.name)), mae.id`,
    [organizationId, activityIds],
  );
  for (const row of result.rows) {
    if (!byActivity.has(row.meeting_activity_id)) {
      byActivity.set(row.meeting_activity_id, []);
    }
    byActivity.get(row.meeting_activity_id).push({
      catalog_item_id: row.catalog_item_id,
      equipment_item_id: row.equipment_item_id,
      quantity: Number(row.quantity),
      name: row.name,
      category: row.category,
      unit_of_measure: row.unit_of_measure,
      archived: row.archived === true,
    });
  }
  return byActivity;
}

/**
 * Give each schedule line what it needs (`material_items`).
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
 * Copy what schedule lines need onto their copies: active articles and
 * active inventory items. Inside the caller's transaction.
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
    `INSERT INTO meeting_activity_equipment
       (organization_id, meeting_activity_id, catalog_item_id, equipment_item_id, quantity)
     SELECT $1, pair.target_id, mae.catalog_item_id, mae.equipment_item_id, mae.quantity
       FROM unnest($2::int[], $3::int[]) AS pair(source_id, target_id)
       JOIN meeting_activity_equipment mae
         ON mae.organization_id = $1 AND mae.meeting_activity_id = pair.source_id
       LEFT JOIN equipment_catalog_items c
         ON c.id = mae.catalog_item_id AND c.organization_id = mae.organization_id
       LEFT JOIN equipment_items ei ON ei.id = mae.equipment_item_id
      WHERE c.archived_at IS NULL AND ei.is_active IS DISTINCT FROM FALSE`,
    [organizationId, sourceIds, targetIds],
  );
}

/**
 * What a schedule line may list: the unit's active articles, and the
 * inventory items it may use that no active article stands for.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @returns {Promise<{articles: Object[], equipment: Object[]}>}
 */
async function listMaterialOptions(db, organizationId) {
  const [articles, accessibleIds] = await Promise.all([
    listCatalog(db, organizationId),
    listAccessibleEquipmentIds(db, organizationId),
  ]);
  const represented = new Set(articles.map((item) => item.equipment_item_id).filter(Boolean));
  const ids = accessibleIds.filter((id) => !represented.has(id));
  const equipment = ids.length
    ? (await db.query(
      `SELECT id, name, category FROM equipment_items
        WHERE id = ANY($1::int[])
        ORDER BY lower(name), id
        LIMIT $2`,
      [ids, MATERIAL_OPTIONS_MAX],
    )).rows
    : [];
  return {
    articles: articles.slice(0, MATERIAL_OPTIONS_MAX).map((item) => ({
      id: item.id, name: item.name, category: item.category, unit_of_measure: item.unit_of_measure,
    })),
    equipment: equipment.map((item) => ({
      id: Number(item.id), name: item.name, category: item.category || 'other', unit_of_measure: 'each',
    })),
  };
}

/**
 * The material the assistant may choose from, each with a short reference.
 * Names and categories only: no counts, values or places.
 *
 * @param {{articles: Object[], equipment: Object[]}} options - From listMaterialOptions
 * @returns {Array<{ref: string, name: string, category: string, unit: string}>}
 */
function planMaterialChoices(options) {
  return [
    ...options.articles.map((item) => ({ ref: `a${item.id}`, name: item.name, category: item.category, unit: item.unit_of_measure })),
    ...options.equipment.map((item) => ({ ref: `e${item.id}`, name: item.name, category: item.category, unit: 'each' })),
  ].slice(0, MATERIAL_OPTIONS_MAX);
}

/**
 * Keep only what the assistant may say about one activity's material:
 * references it was offered, each once, with a sensible quantity.
 *
 * @param {*} entries - `materialItems` of one timeline item, or `materials` of an outing
 * @param {Map<string, Object>} choices - planMaterialChoices by ref
 * @param {number} [max] - Most entries kept
 * @returns {Object[]} material_items, as a schedule line lists them
 */
function readPlanMaterial(entries, choices, max = PLAN_ITEMS_PER_ACTIVITY_MAX) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const seen = new Set();
  return entries
    .map((entry) => {
      const ref = typeof entry?.ref === 'string' ? entry.ref.trim() : '';
      const match = PLAN_REF_PATTERN.exec(ref);
      const choice = choices.get(ref);
      if (!match || !choice || seen.has(ref)) {
        return null;
      }
      seen.add(ref);
      const asked = Math.round(Number(entry.quantity) * QUANTITY_DECIMALS) / QUANTITY_DECIMALS;
      const quantity = asked > 0 ? Math.min(asked, MATERIAL_QUANTITY_MAX) : 1;
      return {
        catalog_item_id: match[1] === 'a' ? Number(match[2]) : null,
        equipment_item_id: match[1] === 'e' ? Number(match[2]) : null,
        quantity,
        name: choice.name,
        category: choice.category,
        unit_of_measure: choice.unit,
        archived: false,
      };
    })
    .filter(Boolean)
    .slice(0, max);
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
  listMaterialOptions,
  planMaterialChoices,
  readPlanMaterial,
  PLAN_ITEMS_PER_OUTING_MAX,
};
