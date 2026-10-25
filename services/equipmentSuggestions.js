'use strict';

/**
 * Suggesting the equipment an activity needs, from the unit's own inventory.
 *
 * The leader describes the activity; the model receives that description and
 * the equipment the unit may use (names, categories, what is free for the
 * dates), and names items by id. Nothing about youths or families is sent.
 * The answer is a suggestion only: ids outside the list are dropped,
 * quantities are kept within what is free, and nothing is reserved.
 *
 * @module services/equipmentSuggestions
 */

const { generateText } = require('./aiText');
const { listAccessibleEquipmentIds } = require('./equipmentAccess');

/** Items the model may choose from: enough for any unit, small enough for one call. */
const MAX_EQUIPMENT_SENT = 300;
/** Items one suggestion may name. */
const MAX_SUGGESTED_ITEMS = 25;
/** Length of a reason shown under an item. */
const MAX_REASON_LENGTH = 200;

/**
 * The equipment the unit may use that is free from dateFrom to dateTo: the
 * total, less the reservations of those dates and the loans they do not
 * already cover, as a reservation of those dates is checked.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Unit
 * @param {string} dateFrom - YYYY-MM-DD
 * @param {string} dateTo - YYYY-MM-DD
 * @returns {Promise<Array<{id: number, name: string, category: string, available: number}>>}
 */
async function availableEquipment(pool, organizationId, dateFrom, dateTo) {
  const ids = await listAccessibleEquipmentIds(pool, organizationId);
  if (ids.length === 0) {
    return [];
  }
  // Counted as a reservation of these dates is, and only what is free: the
  // cap on what is sent applies to items that can be chosen.
  const result = await pool.query(
    `SELECT id, name, category, available
       FROM (
         SELECT ei.id, ei.name, ei.category,
                GREATEST(0, ei.quantity_total
                  - COALESCE((
                      SELECT SUM(er.reserved_quantity)
                        FROM equipment_reservations er
                       WHERE er.equipment_id = ei.id
                         AND er.status IN ('reserved', 'confirmed')
                         AND COALESCE(er.date_from, er.meeting_date) <= $3::date
                         AND COALESCE(er.date_to, er.meeting_date) >= $2::date
                    ), 0)
                  - equipment_loans_beyond_reservations(ei.id, $2::date, $3::date))::int AS available
           FROM equipment_items ei
          WHERE ei.id = ANY($1::int[])
       ) AS counted
      WHERE available > 0
      ORDER BY category, name
      LIMIT $4`,
    [ids, dateFrom, dateTo, MAX_EQUIPMENT_SENT],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    category: row.category,
    available: Number(row.available),
  }));
}

/**
 * Keep only what the answer may say: items of the list, free for the dates,
 * each once, with a quantity within what is free and a short reason.
 *
 * @param {Object} answer - The model's JSON answer
 * @param {Array<{id: number, available: number}>} equipment - What it was offered
 * @returns {Array<{equipment_id: number, quantity: number, reason: string}>}
 */
function readSuggestions(answer, equipment) {
  const offered = new Map(equipment.map((item) => [item.id, item]));
  const seen = new Set();
  const items = Array.isArray(answer?.items) ? answer.items : [];
  return items
    .map((entry) => {
      const id = Number(entry?.id);
      const item = offered.get(id);
      if (!item || item.available < 1 || seen.has(id)) {
        return null;
      }
      seen.add(id);
      const asked = Math.trunc(Number(entry.quantity)) || 1;
      return {
        equipment_id: id,
        quantity: Math.min(Math.max(1, asked), item.available),
        reason: typeof entry.reason === 'string' ? entry.reason.trim().slice(0, MAX_REASON_LENGTH) : '',
      };
    })
    .filter(Boolean)
    .slice(0, MAX_SUGGESTED_ITEMS);
}

/**
 * Suggest equipment for an activity.
 *
 * @param {Object} pool - Database pool
 * @param {Object} request
 * @param {number} request.organizationId - Unit
 * @param {string} request.userId - Leader asking (for the budget record)
 * @param {string} request.description - The activity, as the leader describes it
 * @param {string} request.dateFrom - YYYY-MM-DD
 * @param {string} request.dateTo - YYYY-MM-DD
 * @param {string} request.locale - Language of the reasons
 * @returns {Promise<{items: Array<Object>, usage: Object|null}>}
 */
async function suggestEquipment(pool, { organizationId, userId, description, dateFrom, dateTo, locale }) {
  const equipment = await availableEquipment(pool, organizationId, dateFrom, dateTo);
  const choosable = equipment.filter((item) => item.available > 0);
  if (choosable.length === 0) {
    // Nothing is free: there is nothing to choose, and no call to pay for.
    return { items: [], usage: null };
  }
  const result = await generateText('equipment_suggest', {
    locale,
    activity: description,
    dates: { from: dateFrom, to: dateTo },
    equipment: choosable,
  }, { userId, organizationId });
  return { items: readSuggestions(result.data, choosable), usage: result.usage };
}

module.exports = { suggestEquipment, readSuggestions, MAX_SUGGESTED_ITEMS };
