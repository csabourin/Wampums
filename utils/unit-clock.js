/**
 * The unit's clock.
 *
 * "Today" is a calendar day where the unit meets, not where the server runs. The
 * server and the database keep UTC, where the day turns over in the middle of an
 * evening meeting in the Americas. Every "today", "upcoming" or "past" the app
 * decides goes through the unit's time zone (`organizations.time_zone`,
 * migration 088):
 *
 * - in SQL, `unit_today(<organization id>)` instead of `CURRENT_DATE`, and
 *   `unit_now(<organization id>)` (a timestamp without time zone) to compare
 *   with the dates and times of activities, which carry no zone;
 * - in JavaScript, `unitToday(db, organizationId)`.
 */

/**
 * Today's date where the unit is, as YYYY-MM-DD.
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - Unit whose calendar day is wanted
 * @returns {Promise<string>} The unit's calendar day
 */
async function unitToday(db, organizationId) {
  const result = await db.query('SELECT unit_today($1)::text AS today', [organizationId]);
  return result.rows[0].today;
}

module.exports = { unitToday };
