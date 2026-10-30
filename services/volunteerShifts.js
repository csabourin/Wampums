/**
 * Volunteer shifts (#1251): what an activity or camp needs, by time slot, and who took a place.
 *
 * Every write runs in one transaction that locks the shift, so its places are never exceeded:
 * when two people take the last place at once, one is recorded and the other is refused (409).
 * A sign-up is confirmed when it is recorded. Lists show other volunteers' names only to managers.
 */

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

/** A refusal safe to return: its message is a translation key the SPA explains. */
class VolunteerError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {Object} pool - pg pool
 * @param {Function} work - Callback receiving a transaction client
 * @returns {Promise<*>} What `work` returns, once committed
 */
async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Upcoming shifts of the unit, soonest first, with their places and the caller's own sign-up.
 * @param {Object} db
 * @param {number} organizationId - Authenticated unit
 * @param {string} userId - The caller
 * @param {{withNames: boolean}} options - Managers see who signed up
 * @returns {Promise<Array<Object>>}
 */
async function listShifts(db, organizationId, userId, { withNames }) {
  const result = await db.query(
    `SELECT s.id, s.activity_id, a.name AS activity_name, a.is_camp,
            a.activity_start_date::text AS activity_start_date, a.activity_end_date::text AS activity_end_date,
            s.title, s.shift_date::text AS shift_date, to_char(s.start_time, 'HH24:MI') AS start_time,
            to_char(s.end_time, 'HH24:MI') AS end_time, s.slots, s.notes,
            COUNT(v.id)::int AS taken,
            BOOL_OR(v.user_id = $2) IS TRUE AS mine,
            CASE WHEN $3::boolean THEN COALESCE(
              JSON_AGG(JSON_BUILD_OBJECT('user_id', u.id, 'name', u.full_name) ORDER BY v.created_at, v.id)
                FILTER (WHERE v.id IS NOT NULL), '[]'::json) END AS volunteers
       FROM volunteer_shifts s
       JOIN activities a ON a.id = s.activity_id AND a.organization_id = s.organization_id AND a.is_active = TRUE
       LEFT JOIN volunteer_signups v ON v.shift_id = s.id AND v.organization_id = s.organization_id
       LEFT JOIN users u ON u.id = v.user_id
      WHERE s.organization_id = $1 AND s.shift_date >= CURRENT_DATE
      GROUP BY s.id, a.id
      ORDER BY s.shift_date, s.start_time, s.id`,
    [organizationId, userId, withNames === true]
  );
  return result.rows;
}

/**
 * Activities a shift may belong to: the unit's active ones not yet over. Names and dates only.
 * @param {Object} db
 * @param {number} organizationId
 * @returns {Promise<Array<Object>>}
 */
async function listShiftActivities(db, organizationId) {
  return (await db.query(
    `SELECT id, name, is_camp, activity_start_date::text AS activity_start_date, activity_end_date::text AS activity_end_date
       FROM activities
      WHERE organization_id = $1 AND is_active = TRUE AND activity_end_date >= CURRENT_DATE
      ORDER BY activity_start_date, id`,
    [organizationId]
  )).rows;
}

/**
 * Check a shift's day falls within its activity, which must belong to the unit.
 * @param {Object} db - Transaction client
 * @param {number} organizationId
 * @param {Object} shift - Validated fields
 */
async function checkActivity(db, organizationId, shift) {
  const activity = (await db.query(
    `SELECT activity_start_date::text AS start_date, activity_end_date::text AS end_date
       FROM activities WHERE organization_id = $1 AND id = $2 AND is_active = TRUE FOR SHARE`,
    [organizationId, shift.activity_id]
  )).rows[0];
  if (!activity) { throw new VolunteerError('volunteer_activity_not_found', HTTP_NOT_FOUND); }
  if (shift.shift_date < activity.start_date || shift.shift_date > activity.end_date) {
    throw new VolunteerError('volunteer_shift_outside_activity', HTTP_BAD_REQUEST);
  }
}

/**
 * Create a shift, or change one. Places cannot drop below the people already signed up.
 * @param {Object} pool
 * @param {number} organizationId
 * @param {string} userId - Who saves it
 * @param {Object} shift - Validated fields: activity_id, title, shift_date, start_time, end_time, slots, notes
 * @param {number|null} shiftId - The shift to change, or null to create
 * @returns {Promise<Object>} The saved shift
 */
function saveShift(pool, organizationId, userId, shift, shiftId = null) {
  return transaction(pool, async (db) => {
    await checkActivity(db, organizationId, shift);
    const values = [organizationId, shift.activity_id, shift.title, shift.shift_date, shift.start_time,
      shift.end_time, shift.slots, shift.notes];
    if (!shiftId) {
      return (await db.query(
        `INSERT INTO volunteer_shifts (organization_id, activity_id, title, shift_date, start_time, end_time, slots, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [...values, userId]
      )).rows[0];
    }
    const current = (await db.query(
      `SELECT s.id, (SELECT COUNT(*)::int FROM volunteer_signups v WHERE v.shift_id = s.id AND v.organization_id = s.organization_id) AS taken
         FROM volunteer_shifts s WHERE s.organization_id = $1 AND s.id = $2 FOR UPDATE`,
      [organizationId, shiftId]
    )).rows[0];
    if (!current) { throw new VolunteerError('volunteer_shift_not_found', HTTP_NOT_FOUND); }
    if (shift.slots < current.taken) { throw new VolunteerError('volunteer_slots_below_signups', HTTP_CONFLICT); }
    return (await db.query(
      `UPDATE volunteer_shifts SET activity_id = $2, title = $3, shift_date = $4, start_time = $5, end_time = $6,
              slots = $7, notes = $8, updated_at = NOW()
        WHERE organization_id = $1 AND id = $9 RETURNING id`,
      [...values, shiftId]
    )).rows[0];
  });
}

/**
 * @param {Object} pool
 * @param {number} organizationId
 * @param {number} shiftId
 * @returns {Promise<boolean>} Whether a shift was removed, with its sign-ups
 */
async function deleteShift(pool, organizationId, shiftId) {
  const result = await pool.query('DELETE FROM volunteer_shifts WHERE organization_id = $1 AND id = $2', [organizationId, shiftId]);
  return result.rowCount > 0;
}

/**
 * Take a place on a shift. The shift row is locked first, so its places are counted once:
 * the last place goes to one person, and the next is told the shift is full.
 * @param {Object} pool
 * @param {number} organizationId
 * @param {number} shiftId
 * @param {string} userId - The caller, an active member of the unit
 * @returns {Promise<{created: boolean}>} False when the caller already had a place
 */
function signUp(pool, organizationId, shiftId, userId) {
  return transaction(pool, async (db) => {
    const shift = (await db.query(
      `SELECT id, slots FROM volunteer_shifts
        WHERE organization_id = $1 AND id = $2 AND shift_date >= CURRENT_DATE FOR UPDATE`,
      [organizationId, shiftId]
    )).rows[0];
    if (!shift) { throw new VolunteerError('volunteer_shift_not_found', HTTP_NOT_FOUND); }
    const places = (await db.query(
      `SELECT COUNT(*)::int AS taken, BOOL_OR(user_id = $3) IS TRUE AS mine
         FROM volunteer_signups WHERE organization_id = $1 AND shift_id = $2`,
      [organizationId, shiftId, userId]
    )).rows[0];
    if (places.mine) { return { created: false }; }
    if (places.taken >= shift.slots) { throw new VolunteerError('volunteer_shift_full', HTTP_CONFLICT); }
    await db.query(
      'INSERT INTO volunteer_signups (organization_id, shift_id, user_id) VALUES ($1, $2, $3)',
      [organizationId, shiftId, userId]
    );
    return { created: true };
  });
}

/**
 * Give up a place: one's own, or, for a manager, someone else's.
 * @param {Object} pool
 * @param {number} organizationId
 * @param {number} shiftId
 * @param {string} userId - Whose place
 * @returns {Promise<boolean>} Whether a place was freed
 */
async function withdraw(pool, organizationId, shiftId, userId) {
  const result = await pool.query(
    'DELETE FROM volunteer_signups WHERE organization_id = $1 AND shift_id = $2 AND user_id = $3',
    [organizationId, shiftId, userId]
  );
  return result.rowCount > 0;
}

/**
 * Volunteer needs of one activity, for the camp readiness overview.
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} activityId
 * @returns {Promise<Array<Object>>} Each shift with its places and taken count
 */
async function shiftsForActivity(db, organizationId, activityId) {
  return (await db.query(
    `SELECT s.id, s.title, s.shift_date::text AS shift_date, to_char(s.start_time, 'HH24:MI') AS start_time,
            to_char(s.end_time, 'HH24:MI') AS end_time, s.slots, COUNT(v.id)::int AS taken
       FROM volunteer_shifts s
       LEFT JOIN volunteer_signups v ON v.shift_id = s.id AND v.organization_id = s.organization_id
      WHERE s.organization_id = $1 AND s.activity_id = $2
      GROUP BY s.id ORDER BY s.shift_date, s.start_time, s.id`,
    [organizationId, activityId]
  )).rows;
}

module.exports = {
  VolunteerError, listShifts, listShiftActivities, saveShift, deleteShift, signUp, withdraw, shiftsForActivity,
};
