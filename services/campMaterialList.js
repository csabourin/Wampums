'use strict';

/**
 * The collective material list of a camp: what every schedule line of a
 * multi-day block needs, added up once per article.
 *
 * Catalogue articles and inventory items listed on the lines are consolidated
 * by article: one entry per article, its quantity the sum of every line that
 * names it. An inventory item listed directly on a line joins the article that
 * stands for it, when the camp lists one. Free-text material is not
 * consolidated: it is returned beside, line by line, for a person to read.
 *
 * With the inventory right, each entry that is an inventory item is compared
 * with the unit's equipment over the camp's dates: what this camp reserved
 * for all its days (a reservation of some days only, or of dates the outing
 * has since left, is not counted as the camp's), what is still free (counted as a reservation of those dates is, loans
 * included), and what is missing. Reservations made for this camp of
 * equipment no line lists are returned too, so nothing reserved is forgotten.
 *
 * @module services/campMaterialList
 */

const { EQUIPMENT_CATEGORIES } = require('./equipmentCategories');
const { findAccessibleEquipmentIds } = require('./equipmentAccess');

const QUANTITY_DECIMALS = 100;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
/** Longest equipment_reservations.reserved_for. */
const RESERVED_FOR_MAX_LENGTH = 200;
/** Statuses a reservation still holds equipment in. */
const ACTIVE_RESERVATION_STATUSES = ['reserved', 'confirmed'];
/** HH:MM of a database time. */
const SHORT_TIME_LENGTH = 5;

/** Where an inventory entry stands against the camp's needs. */
const INVENTORY_STATUS = Object.freeze({
  RESERVED: 'reserved',
  AVAILABLE: 'available',
  MISSING: 'missing',
  UNAVAILABLE: 'unavailable',
  NOT_IN_INVENTORY: 'not_in_inventory',
});

/**
 * @param {number} value
 * @returns {number} Rounded to the two decimals quantities are stored with
 */
function roundQuantity(value) {
  return Math.round(value * QUANTITY_DECIMALS) / QUANTITY_DECIMALS;
}

/**
 * The camp, its dates and the outing it is linked to.
 *
 * @param {Object} db - pg pool or client
 * @param {number} organizationId
 * @param {number} meetingId
 * @returns {Promise<Object|null>} null when the unit has no such block
 */
async function loadCamp(db, organizationId, meetingId) {
  const result = await db.query(
    `SELECT m.id, m.theme, m.meeting_kind, m.activity_id,
            COALESCE(NULLIF(btrim(m.theme), ''), act.name, '') AS label,
            m.meeting_date::text AS date_from,
            (m.meeting_date + GREATEST(
              1,
              COALESCE(act.activity_end_date, act.activity_start_date, act.activity_date, m.meeting_date)
                - m.meeting_date + 1
            ) - 1)::text AS date_to
       FROM year_plan_meetings m
       LEFT JOIN activities act
              ON act.id = m.activity_id
             AND act.organization_id = m.organization_id
             AND act.is_active = TRUE
      WHERE m.id = $1 AND m.organization_id = $2`,
    [meetingId, organizationId],
  );
  return result.rows[0] || null;
}

/**
 * Consolidate what the lines list into one entry per article.
 *
 * @param {Object[]} rows - Entries of meeting_activity_equipment, with their line
 * @returns {Object[]} Entries sorted by category, then name
 */
function consolidate(rows) {
  // An inventory item listed directly joins the article that stands for it.
  const articleForEquipment = new Map();
  for (const row of rows) {
    if (row.catalog_item_id && row.article_equipment_id && !articleForEquipment.has(row.article_equipment_id)) {
      articleForEquipment.set(row.article_equipment_id, row.catalog_item_id);
    }
  }
  const entries = new Map();
  for (const row of rows) {
    const articleId = row.catalog_item_id || articleForEquipment.get(row.equipment_item_id) || null;
    const key = articleId ? `a${articleId}` : `e${row.equipment_item_id}`;
    if (!entries.has(key)) {
      entries.set(key, {
        key,
        catalog_item_id: articleId,
        equipment_item_id: row.catalog_item_id ? row.article_equipment_id || null : row.equipment_item_id,
        name: row.name,
        category: row.category,
        unit_of_measure: row.unit_of_measure,
        archived: false,
        quantity: 0,
        uses: [],
      });
    }
    const entry = entries.get(key);
    // The article's own name, category and unit win over those of an item joined to it.
    if (row.catalog_item_id) {
      Object.assign(entry, { name: row.name, category: row.category, unit_of_measure: row.unit_of_measure });
    }
    entry.archived = entry.archived || row.archived === true;
    entry.quantity = roundQuantity(entry.quantity + Number(row.quantity));
    entry.uses.push({
      activity_id: row.meeting_activity_id,
      name: row.activity_name,
      day_offset: Number(row.day_offset) || 0,
      quantity: Number(row.quantity),
    });
  }
  const categoryOrder = (category) => EQUIPMENT_CATEGORIES.indexOf(category);
  return [...entries.values()]
    .map((entry) => ({ ...entry, category: EQUIPMENT_CATEGORIES.includes(entry.category) ? entry.category : 'other' }))
    .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category)
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Where each inventory item stands over the camp's dates.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {Object} camp - From loadCamp
 * @param {number[]} equipmentIds
 * @returns {Promise<Map<number, {reserved: number, free: number}>>} Only the items the unit may use
 */
async function loadInventoryStanding(db, organizationId, camp, equipmentIds) {
  const accessible = [...await findAccessibleEquipmentIds(db, organizationId, equipmentIds)];
  if (!accessible.length) {
    return new Map();
  }
  const result = await db.query(
    `SELECT e.id,
            COALESCE((
              SELECT SUM(er.reserved_quantity)
                FROM equipment_reservations er
               WHERE er.equipment_id = e.id
                 AND er.organization_id = $1
                 AND er.status IN ('reserved', 'confirmed')
                 AND (er.meeting_id = $4 OR ($5::int IS NOT NULL AND er.activity_id = $5::int))
                 AND COALESCE(er.date_from, er.meeting_date) <= $2::date
                 AND COALESCE(er.date_to, er.meeting_date) >= $3::date
            ), 0)::int AS reserved_for_camp,
            GREATEST(0,
              COALESCE(e.quantity_total, 0)
              - COALESCE((
                  SELECT SUM(er.reserved_quantity)
                    FROM equipment_reservations er
                   WHERE er.equipment_id = e.id
                     AND er.status IN ('reserved', 'confirmed')
                     AND COALESCE(er.date_from, er.meeting_date) <= $3::date
                     AND COALESCE(er.date_to, er.meeting_date) >= $2::date
                ), 0)
              - equipment_loans_beyond_reservations(e.id, $2::date, $3::date, $5::int)
            )::int AS free_for_dates
       FROM equipment_items e
      WHERE e.id = ANY($6::int[])`,
    [organizationId, camp.date_from, camp.date_to, camp.id, camp.activity_id, accessible],
  );
  return new Map(result.rows.map((row) => [
    Number(row.id),
    { reserved: Number(row.reserved_for_camp), free: Number(row.free_for_dates) },
  ]));
}

/**
 * Whole units of an inventory item still to reserve for a need: what the need
 * lacks beyond this camp's reservations, at most what is free.
 *
 * @param {number} needed - Quantity the camp needs
 * @param {{reserved: number, free: number}} standing
 * @returns {number}
 */
function quantityToReserve(needed, standing) {
  return Math.max(0, Math.min(standing.free, Math.ceil(needed) - standing.reserved));
}

/**
 * Compare one entry with the inventory.
 *
 * @param {Object} entry - From consolidate
 * @param {Map<number, {reserved: number, free: number}>} standing
 * @returns {Object} The inventory part of the entry
 */
function inventoryFor(entry, standing) {
  if (!entry.equipment_item_id) {
    return { status: INVENTORY_STATUS.NOT_IN_INVENTORY };
  }
  const item = standing.get(Number(entry.equipment_item_id));
  if (!item) {
    return { status: INVENTORY_STATUS.UNAVAILABLE, reserved: 0, free: 0, missing: entry.quantity, to_reserve: 0 };
  }
  const shortfall = roundQuantity(Math.max(0, entry.quantity - item.reserved - item.free));
  let status = INVENTORY_STATUS.MISSING;
  if (item.reserved >= entry.quantity) {
    status = INVENTORY_STATUS.RESERVED;
  } else if (shortfall === 0) {
    status = INVENTORY_STATUS.AVAILABLE;
  }
  return {
    status, reserved: item.reserved, free: item.free, missing: shortfall,
    to_reserve: quantityToReserve(entry.quantity, item),
  };
}

/**
 * Reservations made for this camp of equipment no line lists.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {Object} camp
 * @param {number[]} listedIds - Inventory items the list already covers
 * @returns {Promise<Object[]>}
 */
async function loadUnlistedReservations(db, organizationId, camp, listedIds) {
  const result = await db.query(
    `SELECT e.id AS equipment_item_id, e.name, e.category, SUM(er.reserved_quantity)::int AS reserved
       FROM equipment_reservations er
       JOIN equipment_items e ON e.id = er.equipment_id
      WHERE er.organization_id = $1
        AND er.status IN ('reserved', 'confirmed')
        AND (er.meeting_id = $2 OR ($3::int IS NOT NULL AND er.activity_id = $3::int))
        AND NOT (er.equipment_id = ANY($4::int[]))
      GROUP BY e.id, e.name, e.category
      ORDER BY lower(e.name), e.id`,
    [organizationId, camp.id, camp.activity_id, listedIds],
  );
  return result.rows.map((row) => ({
    equipment_item_id: Number(row.equipment_item_id),
    name: row.name,
    category: EQUIPMENT_CATEGORIES.includes(row.category) ? row.category : 'other',
    reserved: Number(row.reserved),
  }));
}

/**
 * The collective material list of a camp.
 *
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - Unit of the token
 * @param {number} meetingId - year_plan_meetings.id
 * @param {{withInventory?: boolean}} [options] - Compare with the inventory (inventory.view)
 * @returns {Promise<Object|null>} null when the unit has no such block
 */
async function buildCampMaterialList(db, organizationId, meetingId, { withInventory = false } = {}) {
  const camp = await loadCamp(db, organizationId, meetingId);
  if (!camp) {
    return null;
  }
  const [itemsResult, freeTextResult] = await Promise.all([
    db.query(
      `SELECT mae.meeting_activity_id, mae.catalog_item_id, mae.equipment_item_id, mae.quantity,
              c.equipment_item_id AS article_equipment_id,
              a.name AS activity_name, a.day_offset,
              COALESCE(c.name, ei.name) AS name,
              COALESCE(c.category, ei.category, 'other') AS category,
              COALESCE(c.unit_of_measure, 'each') AS unit_of_measure,
              (c.archived_at IS NOT NULL OR ei.is_active = FALSE) AS archived
         FROM meeting_activity_equipment mae
         JOIN year_plan_meeting_activities a
           ON a.id = mae.meeting_activity_id AND a.organization_id = mae.organization_id
         LEFT JOIN equipment_catalog_items c
           ON c.id = mae.catalog_item_id AND c.organization_id = mae.organization_id
         LEFT JOIN equipment_items ei ON ei.id = mae.equipment_item_id
        WHERE mae.organization_id = $1 AND a.meeting_id = $2
        ORDER BY a.day_offset, a.start_time NULLS LAST, a.sort_order, a.id, mae.id`,
      [organizationId, meetingId],
    ),
    db.query(
      `SELECT a.id AS activity_id, a.name, a.day_offset, a.start_time, a.material
         FROM year_plan_meeting_activities a
        WHERE a.organization_id = $1 AND a.meeting_id = $2
          AND length(btrim(COALESCE(a.material, ''))) > 0
        ORDER BY a.day_offset, a.start_time NULLS LAST, a.sort_order, a.id`,
      [organizationId, meetingId],
    ),
  ]);

  const items = consolidate(itemsResult.rows);
  let unlistedReservations = null;
  if (withInventory) {
    const listedIds = [...new Set(items.map((entry) => entry.equipment_item_id).filter(Boolean).map(Number))];
    const [standing, unlisted] = await Promise.all([
      listedIds.length ? loadInventoryStanding(db, organizationId, camp, listedIds) : new Map(),
      loadUnlistedReservations(db, organizationId, camp, listedIds),
    ]);
    // Two articles standing for one item share it: compare the item with
    // their combined need, and offer what is still to reserve on the first only.
    const combined = new Map();
    items.forEach((entry) => {
      const id = Number(entry.equipment_item_id);
      if (id) {
        combined.set(id, roundQuantity((combined.get(id) || 0) + entry.quantity));
      }
    });
    const offered = new Set();
    items.forEach((entry) => {
      const id = Number(entry.equipment_item_id);
      entry.inventory = inventoryFor(id ? { ...entry, quantity: combined.get(id) } : entry, standing);
      if (id && offered.has(id) && entry.inventory.to_reserve !== undefined) {
        entry.inventory.to_reserve = 0;
      }
      offered.add(id);
    });
    unlistedReservations = unlisted;
  }

  return {
    camp: {
      id: camp.id,
      theme: camp.theme,
      meeting_kind: camp.meeting_kind,
      date_from: camp.date_from,
      date_to: camp.date_to,
    },
    inventory_compared: withInventory,
    items,
    free_text: freeTextResult.rows.map((row) => ({
      activity_id: row.activity_id,
      name: row.name,
      day_offset: Number(row.day_offset) || 0,
      start_time: row.start_time ? String(row.start_time).slice(0, SHORT_TIME_LENGTH) : null,
      material: row.material.trim(),
    })),
    unlisted_reservations: unlistedReservations,
  };
}

/** A refusal of a camp reservation safe to return, as a translation key. */
class CampMaterialError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * What the camp needs of each inventory item, with how it stands. Two
 * articles standing for one item add up.
 *
 * @param {Object[]} items - Entries of buildCampMaterialList, with inventory
 * @returns {Map<number, {quantity: number, standing: {reserved: number, free: number}}>}
 */
function needsByEquipment(items) {
  const needs = new Map();
  for (const entry of items) {
    const usable = entry.equipment_item_id && [
      INVENTORY_STATUS.RESERVED, INVENTORY_STATUS.AVAILABLE, INVENTORY_STATUS.MISSING,
    ].includes(entry.inventory?.status);
    if (usable) {
      const id = Number(entry.equipment_item_id);
      const need = needs.get(id) || { quantity: 0, standing: entry.inventory };
      need.quantity = roundQuantity(need.quantity + entry.quantity);
      needs.set(id, need);
    }
  }
  return needs;
}

/**
 * Reserve, for the camp's dates, equipment its list still needs. All or none,
 * with the items locked while their standing is counted: an entry asking for
 * more than the camp still lacks, or than is free, is refused, so two people
 * pressing the button at once never reserve twice. Each reservation names the
 * camp's meeting and outing; one already made for this camp, covering all its
 * days, grows instead.
 *
 * @param {Object} pool - pg pool
 * @param {number} organizationId - Unit of the token
 * @param {string} userId - Who reserves
 * @param {number} meetingId - The camp (year_plan_meetings.id)
 * @param {Array<{equipment_item_id: number, quantity: number}>} requested - Validated, each item once
 * @returns {Promise<Object[]>} The reservations written
 */
async function reserveCampMaterial(pool, organizationId, userId, meetingId, requested) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT id FROM equipment_items WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
      [requested.map((item) => item.equipment_item_id)],
    );
    const list = await buildCampMaterialList(client, organizationId, meetingId, { withInventory: true });
    if (!list) {
      throw new CampMaterialError('Meeting not found', HTTP_NOT_FOUND);
    }
    const needs = needsByEquipment(list.items);
    const stale = requested.some((item) => {
      const need = needs.get(item.equipment_item_id);
      return !need || item.quantity > quantityToReserve(need.quantity, need.standing);
    });
    if (stale) {
      throw new CampMaterialError('camp_material_reservation_stale', HTTP_CONFLICT);
    }
    const camp = await loadCamp(client, organizationId, meetingId);
    const written = await client.query(
      `INSERT INTO equipment_reservations
         (organization_id, equipment_id, meeting_id, activity_id, meeting_date, date_from, date_to,
          reserved_quantity, reserved_for, status, created_by)
       SELECT $1, entry.equipment_id, $2, $3, $4::date, $4::date, $5::date, entry.quantity, $6, 'reserved', $7
         FROM unnest($8::int[], $9::int[]) AS entry(equipment_id, quantity)
       ON CONFLICT ON CONSTRAINT equipment_reservations_unique_reservation
       DO UPDATE SET
         reserved_quantity = CASE WHEN equipment_reservations.status = ANY($10::text[])
           THEN equipment_reservations.reserved_quantity + EXCLUDED.reserved_quantity
           ELSE EXCLUDED.reserved_quantity END,
         status = CASE WHEN equipment_reservations.status = ANY($10::text[])
           THEN equipment_reservations.status ELSE 'reserved' END,
         meeting_id = EXCLUDED.meeting_id,
         activity_id = COALESCE(EXCLUDED.activity_id, equipment_reservations.activity_id),
         date_from = EXCLUDED.date_from,
         date_to = EXCLUDED.date_to,
         updated_at = CURRENT_TIMESTAMP
       WHERE NOT (equipment_reservations.status = ANY($10::text[]))
          OR ((equipment_reservations.meeting_id = EXCLUDED.meeting_id
               OR (EXCLUDED.activity_id IS NOT NULL AND equipment_reservations.activity_id = EXCLUDED.activity_id))
              AND COALESCE(equipment_reservations.date_from, equipment_reservations.meeting_date) <= EXCLUDED.date_from
              AND COALESCE(equipment_reservations.date_to, equipment_reservations.meeting_date) >= EXCLUDED.date_to)
       RETURNING id, equipment_id, reserved_quantity`,
      [
        organizationId, camp.id, camp.activity_id, camp.date_from, camp.date_to,
        camp.label.slice(0, RESERVED_FOR_MAX_LENGTH), userId,
        requested.map((item) => item.equipment_item_id), requested.map((item) => item.quantity),
        ACTIVE_RESERVATION_STATUSES,
      ],
    );
    // Another booking of the same name and day holds the row: nothing of this camp to grow.
    if (written.rows.length !== requested.length) {
      throw new CampMaterialError('camp_material_reservation_conflict', HTTP_CONFLICT);
    }
    await client.query('COMMIT');
    return written.rows.map((row) => ({
      id: row.id, equipment_item_id: Number(row.equipment_id), reserved: Number(row.reserved_quantity),
    }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  INVENTORY_STATUS,
  CampMaterialError,
  reserveCampMaterial,
  buildCampMaterialList,
  consolidate,
  inventoryFor,
};
