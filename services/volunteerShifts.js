/**
 * Volunteer shifts (#1251): what an activity or camp needs, by time slot, and who took a place.
 *
 * Every write runs in one transaction that locks the shift, so its places are never exceeded:
 * when two people take the last place at once, one is recorded and the other is refused (409).
 * Each shift has a type (config/volunteer_shifts.json); a type may carry requirements, such as a
 * background check for a camp aide. A place is confirmed when the person meets them all on the
 * shift's day, and otherwise held as pending until a manager records them. Lists show other
 * volunteers' names, and anyone's requirements, only to managers.
 */
const config = require('../config/volunteer_shifts.json');

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

/** Volunteer type keys, and the requirements each carries. */
const TYPE_REQUIREMENTS = new Map(config.types.map((type) => [type.key, type.requirements]));
const VOLUNTEER_TYPES = [...TYPE_REQUIREMENTS.keys()];
const REQUIREMENTS = config.requirements;
/** Requirements that last a set number of years from the day they were done (a background check: 3). */
const VALIDITY_YEARS = config.validity_years;
/** A check that lapses within this many days is listed as expiring soon. */
const EXPIRING_SOON_DAYS = config.expiring_soon_days;

/**
 * Requirements of a shift's type that a person does not meet on the shift's day.
 * @param {string} type - Volunteer type
 * @param {string} shiftDate - YYYY-MM-DD
 * @param {Array<{requirement_key: string, valid_until: string|null}>} records - What was verified for the person
 * @returns {Array<string>} Missing requirement keys, in the type's order
 */
function missingRequirements(type, shiftDate, records = []) {
  return (TYPE_REQUIREMENTS.get(type) || []).filter((key) => !records.some((record) =>
    record.requirement_key === key && (!record.valid_until || record.valid_until >= shiftDate)));
}

/**
 * @param {Object} db
 * @param {number} organizationId
 * @param {Array<string>} userIds
 * @returns {Promise<Map<string, Array<Object>>>} Each person's verified requirements
 */
async function requirementsByUser(db, organizationId, userIds) {
  const records = new Map(userIds.map((id) => [id, []]));
  if (!userIds.length) { return records; }
  const result = await db.query(
    `SELECT user_id, requirement_key, checked_on::text AS checked_on, valid_until::text AS valid_until FROM volunteer_requirements
      WHERE organization_id = $1 AND user_id = ANY($2::uuid[])`,
    [organizationId, userIds]
  );
  result.rows.forEach((row) => records.get(row.user_id)?.push(row));
  return records;
}

/**
 * Serialize what changes one person's places: taking a place and recording their requirements.
 * Each statement after it reads a fresh snapshot, so a place being created and a requirement being
 * withdrawn at the same moment cannot both commit on stale reads (a confirmed place without its check).
 * @param {Object} db - Transaction client
 * @param {number} organizationId
 * @param {string} userId
 */
async function lockMember(db, organizationId, userId) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`volunteer:${organizationId}:${userId}`]);
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
 * Upcoming shifts of the unit, soonest first: type, places (confirmed and pending), and the
 * caller's own place with what it still lacks. Managers also get each volunteer's name, status
 * and missing requirements.
 * @param {Object} db
 * @param {number} organizationId - Authenticated unit
 * @param {string} userId - The caller
 * @param {{withNames: boolean}} options - Managers see who signed up
 * @returns {Promise<Array<Object>>}
 */
async function listShifts(db, organizationId, userId, { withNames }) {
  const shifts = (await db.query(
    `SELECT s.id, s.activity_id, a.name AS activity_name, a.is_camp,
            a.activity_start_date::text AS activity_start_date, a.activity_end_date::text AS activity_end_date,
            s.volunteer_type, s.title, s.shift_date::text AS shift_date, to_char(s.start_time, 'HH24:MI') AS start_time,
            to_char(s.end_time, 'HH24:MI') AS end_time, s.slots, s.notes,
            COUNT(v.id)::int AS taken,
            COUNT(v.id) FILTER (WHERE v.status = 'pending')::int AS pending,
            MAX(v.status) FILTER (WHERE v.user_id = $2) AS my_status
       FROM volunteer_shifts s
       JOIN activities a ON a.id = s.activity_id AND a.organization_id = s.organization_id AND a.is_active = TRUE
       LEFT JOIN volunteer_signups v ON v.shift_id = s.id AND v.organization_id = s.organization_id
      WHERE s.organization_id = $1 AND s.shift_date >= CURRENT_DATE
      GROUP BY s.id, a.id
      ORDER BY s.shift_date, s.start_time, s.id`,
    [organizationId, userId]
  )).rows;
  const signups = withNames && shifts.length ? (await db.query(
    `SELECT v.shift_id, v.user_id, u.full_name AS name, v.status
       FROM volunteer_signups v JOIN users u ON u.id = v.user_id
      WHERE v.organization_id = $1 AND v.shift_id = ANY($2::int[])
      ORDER BY v.created_at, v.id`,
    [organizationId, shifts.map((shift) => shift.id)]
  )).rows : [];
  const records = await requirementsByUser(db, organizationId, [...new Set([userId, ...signups.map((row) => row.user_id)])]);
  return shifts.map((shift) => ({
    ...shift,
    requirements: TYPE_REQUIREMENTS.get(shift.volunteer_type) || [],
    mine: Boolean(shift.my_status),
    my_missing: shift.my_status === 'pending'
      ? missingRequirements(shift.volunteer_type, shift.shift_date, records.get(userId)) : [],
    volunteers: withNames ? signups.filter((row) => row.shift_id === shift.id).map((row) => ({
      user_id: row.user_id, name: row.name, status: row.status,
      missing: row.status === 'pending' ? missingRequirements(shift.volunteer_type, shift.shift_date, records.get(row.user_id)) : [],
    })) : null,
  }));
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
 * @param {Object} shift - Validated fields: activity_id, volunteer_type, title, shift_date, start_time, end_time, slots, notes
 * @param {number|null} shiftId - The shift to change, or null to create
 * @returns {Promise<Object>} The saved shift
 */
function saveShift(pool, organizationId, userId, shift, shiftId = null) {
  return transaction(pool, async (db) => {
    await checkActivity(db, organizationId, shift);
    const values = [organizationId, shift.activity_id, shift.title, shift.shift_date, shift.start_time,
      shift.end_time, shift.slots, shift.notes, shift.volunteer_type];
    if (!shiftId) {
      return (await db.query(
        `INSERT INTO volunteer_shifts (organization_id, activity_id, title, shift_date, start_time, end_time, slots, notes,
           volunteer_type, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [...values, userId]
      )).rows[0];
    }
    const locked = await db.query(
      'SELECT id FROM volunteer_shifts WHERE organization_id = $1 AND id = $2 FOR UPDATE', [organizationId, shiftId]);
    if (!locked.rows.length) { throw new VolunteerError('volunteer_shift_not_found', HTTP_NOT_FOUND); }
    // Counted in its own statement, once the lock is held, so a sign-up that committed while this
    // waited is seen (a statement's snapshot is taken before it waits for a lock).
    const { taken } = (await db.query(
      'SELECT COUNT(*)::int AS taken FROM volunteer_signups WHERE organization_id = $1 AND shift_id = $2',
      [organizationId, shiftId]
    )).rows[0];
    if (shift.slots < taken) { throw new VolunteerError('volunteer_slots_below_signups', HTTP_CONFLICT); }
    const saved = (await db.query(
      `UPDATE volunteer_shifts SET activity_id = $2, title = $3, shift_date = $4, start_time = $5, end_time = $6,
              slots = $7, notes = $8, volunteer_type = $9, updated_at = NOW()
        WHERE organization_id = $1 AND id = $10 RETURNING id`,
      [...values, shiftId]
    )).rows[0];
    // A new type or day changes what its places require.
    await refreshStatuses(db, organizationId, { shiftId });
    return saved;
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
 * the last place goes to one person, and the next is told the shift is full. A pending place
 * holds its seat while a manager verifies what the shift's type requires.
 * @param {Object} pool
 * @param {number} organizationId
 * @param {number} shiftId
 * @param {string} userId - The caller, an active member of the unit
 * @returns {Promise<{created: boolean, status: string, missing: Array<string>}>}
 *   `created` is false when the caller already had a place
 */
function signUp(pool, organizationId, shiftId, userId) {
  return transaction(pool, async (db) => {
    // A shift of a removed activity takes no place, even from a screen loaded before it was removed.
    const shift = (await db.query(
      `SELECT s.id, s.slots, s.volunteer_type, s.shift_date::text AS shift_date
         FROM volunteer_shifts s
         JOIN activities a ON a.id = s.activity_id AND a.organization_id = s.organization_id AND a.is_active = TRUE
        WHERE s.organization_id = $1 AND s.id = $2 AND s.shift_date >= CURRENT_DATE
        FOR UPDATE OF s`,
      [organizationId, shiftId]
    )).rows[0];
    if (!shift) { throw new VolunteerError('volunteer_shift_not_found', HTTP_NOT_FOUND); }
    await lockMember(db, organizationId, userId);
    const places = (await db.query(
      `SELECT COUNT(*)::int AS taken, MAX(status) FILTER (WHERE user_id = $3) AS mine
         FROM volunteer_signups WHERE organization_id = $1 AND shift_id = $2`,
      [organizationId, shiftId, userId]
    )).rows[0];
    const missing = missingRequirements(shift.volunteer_type, shift.shift_date,
      (await requirementsByUser(db, organizationId, [userId])).get(userId));
    if (places.mine) { return { created: false, status: places.mine, missing: places.mine === 'pending' ? missing : [] }; }
    if (places.taken >= shift.slots) { throw new VolunteerError('volunteer_shift_full', HTTP_CONFLICT); }
    const status = missing.length ? 'pending' : 'confirmed';
    await db.query(
      `INSERT INTO volunteer_signups (organization_id, shift_id, user_id, status, confirmed_at)
       VALUES ($1, $2, $3, $4::varchar, CASE WHEN $4::varchar = 'confirmed' THEN NOW() END)`,
      [organizationId, shiftId, userId, status]
    );
    return { created: true, status, missing };
  });
}

/**
 * Set each upcoming place's status from what its holder meets on the shift's day: confirmed
 * when nothing is missing, pending otherwise. Limited to one person or one shift.
 * @param {Object} db - Transaction client
 * @param {number} organizationId
 * @param {{userId?: string, shiftId?: number}} scope
 * @returns {Promise<number>} Places now confirmed that were pending
 */
async function refreshStatuses(db, organizationId, { userId = null, shiftId = null }) {
  const places = (await db.query(
    `SELECT v.id, v.user_id, v.status, s.volunteer_type, s.shift_date::text AS shift_date
       FROM volunteer_signups v
       JOIN volunteer_shifts s ON s.id = v.shift_id AND s.organization_id = v.organization_id
      WHERE v.organization_id = $1 AND s.shift_date >= CURRENT_DATE
        AND ($2::uuid IS NULL OR v.user_id = $2) AND ($3::int IS NULL OR v.shift_id = $3)
      FOR UPDATE OF v`,
    [organizationId, userId, shiftId]
  )).rows;
  const records = await requirementsByUser(db, organizationId, [...new Set(places.map((place) => place.user_id))]);
  const changes = places.map((place) => ({
    ...place,
    next: missingRequirements(place.volunteer_type, place.shift_date, records.get(place.user_id)).length ? 'pending' : 'confirmed',
  })).filter((place) => place.next !== place.status);
  if (changes.length) {
    await db.query(
      `UPDATE volunteer_signups v SET status = c.next,
              confirmed_at = CASE WHEN c.next = 'confirmed' THEN NOW() END
         FROM UNNEST($2::int[], $3::text[]) AS c(id, next)
        WHERE v.organization_id = $1 AND v.id = c.id`,
      [organizationId, changes.map((place) => place.id), changes.map((place) => place.next)]
    );
  }
  return changes.filter((place) => place.next === 'confirmed').length;
}

/**
 * What was verified for one member of the unit.
 * @param {Object} db
 * @param {number} organizationId
 * @param {string} userId
 * @returns {Promise<Array<{requirement_key: string, valid_until: string|null, verified_at: string}>>}
 * @throws {VolunteerError} 404 when the person is not an active member of the unit
 */
async function getRequirements(db, organizationId, userId) {
  const member = await db.query(
    "SELECT 1 FROM user_organizations WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
    [organizationId, userId]
  );
  if (!member.rows.length) { throw new VolunteerError('volunteer_member_not_found', HTTP_NOT_FOUND); }
  return (await db.query(
    `SELECT requirement_key, checked_on::text AS checked_on, valid_until::text AS valid_until, verified_at
       FROM volunteer_requirements
      WHERE organization_id = $1 AND user_id = $2 ORDER BY requirement_key`,
    [organizationId, userId]
  )).rows;
}

/**
 * Record what a manager verified for a member, replacing the previous record: requirements
 * named are verified, the others are not. A requirement with a set validity (a background check)
 * records the day it was done and lasts that many years from it, whatever the caller sends;
 * others last until their optional date. The member's upcoming places then follow: confirmed
 * when complete, pending again when something was withdrawn or lapses before the shift.
 * @param {Object} pool
 * @param {number} organizationId
 * @param {string} managerId - Who verified
 * @param {string} userId - The member
 * @param {Object<string, {checked_on?: string, valid_until?: string|null}>} verified - Validated keys
 * @returns {Promise<{confirmed: number}>} Places confirmed by this record
 */
function recordRequirements(pool, organizationId, managerId, userId, verified) {
  return transaction(pool, async (db) => {
    await lockMember(db, organizationId, userId);
    const member = await db.query(
      "SELECT 1 FROM user_organizations WHERE organization_id = $1 AND user_id = $2 AND status = 'active' FOR SHARE",
      [organizationId, userId]
    );
    if (!member.rows.length) { throw new VolunteerError('volunteer_member_not_found', HTTP_NOT_FOUND); }
    const keys = Object.keys(verified);
    await db.query(
      'DELETE FROM volunteer_requirements WHERE organization_id = $1 AND user_id = $2 AND NOT (requirement_key = ANY($3::text[]))',
      [organizationId, userId, keys]
    );
    if (keys.length) {
      await db.query(
        `INSERT INTO volunteer_requirements (organization_id, user_id, requirement_key, checked_on, valid_until, verified_by)
         SELECT $1, $2, k.key, k.checked_on,
                CASE WHEN k.years IS NULL THEN k.valid_until ELSE (k.checked_on + make_interval(years => k.years))::date END, $7
           FROM UNNEST($3::text[], $4::date[], $5::date[], $6::int[]) AS k(key, checked_on, valid_until, years)
         ON CONFLICT (organization_id, user_id, requirement_key) DO UPDATE SET
           checked_on = EXCLUDED.checked_on, valid_until = EXCLUDED.valid_until,
           verified_by = EXCLUDED.verified_by, verified_at = NOW()`,
        [organizationId, userId, keys,
          keys.map((key) => verified[key].checked_on || null),
          keys.map((key) => (VALIDITY_YEARS[key] ? null : verified[key].valid_until || null)),
          keys.map((key) => VALIDITY_YEARS[key] || null), managerId]
      );
    }
    return { confirmed: await refreshStatuses(db, organizationId, { userId }) };
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
 * Every adult of the unit whose background check a manager follows: the team (anyone holding a
 * role beyond a family's own children: leaders, finance, equipment, district…) and anyone holding
 * a place on an upcoming shift. Each with their check and its state: missing, expired, expiring
 * soon or valid.
 * @param {Object} db
 * @param {number} organizationId
 * @returns {Promise<Array<{user_id: string, name: string, on_team: boolean, volunteering: boolean,
 *   checked_on: string|null, valid_until: string|null, state: string}>>} Most urgent first
 */
async function teamChecks(db, organizationId) {
  const rows = (await db.query(
    `SELECT u.id AS user_id, u.full_name AS name,
            EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
                      JOIN roles r ON r.id = role_id_text::integer
                     WHERE r.data_scope IS DISTINCT FROM 'linked') AS on_team,
            EXISTS (SELECT 1 FROM volunteer_signups v
                      JOIN volunteer_shifts s ON s.id = v.shift_id AND s.organization_id = v.organization_id
                     WHERE v.organization_id = uo.organization_id AND v.user_id = u.id AND s.shift_date >= CURRENT_DATE) AS volunteering,
            c.checked_on::text AS checked_on, c.valid_until::text AS valid_until,
            CASE WHEN c.valid_until IS NULL THEN 'missing'
                 WHEN c.valid_until < CURRENT_DATE THEN 'expired'
                 WHEN c.valid_until <= CURRENT_DATE + $2::int THEN 'expiring'
                 ELSE 'valid' END AS state
       FROM user_organizations uo
       JOIN users u ON u.id = uo.user_id
       LEFT JOIN volunteer_requirements c
              ON c.organization_id = uo.organization_id AND c.user_id = u.id AND c.requirement_key = 'background_check'
      WHERE uo.organization_id = $1 AND uo.status = 'active'`,
    [organizationId, EXPIRING_SOON_DAYS]
  )).rows;
  const order = { missing: 0, expired: 1, expiring: 2, valid: 3 };
  return rows.filter((row) => row.on_team || row.volunteering)
    .sort((a, b) => order[a.state] - order[b.state] || String(a.valid_until).localeCompare(String(b.valid_until))
      || String(a.name).localeCompare(String(b.name)));
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
    `SELECT s.id, s.volunteer_type, s.title, s.shift_date::text AS shift_date, to_char(s.start_time, 'HH24:MI') AS start_time,
            to_char(s.end_time, 'HH24:MI') AS end_time, s.slots, COUNT(v.id)::int AS taken,
            COUNT(v.id) FILTER (WHERE v.status = 'pending')::int AS pending
       FROM volunteer_shifts s
       LEFT JOIN volunteer_signups v ON v.shift_id = s.id AND v.organization_id = s.organization_id
      WHERE s.organization_id = $1 AND s.activity_id = $2
      GROUP BY s.id ORDER BY s.shift_date, s.start_time, s.id`,
    [organizationId, activityId]
  )).rows;
}

module.exports = {
  VOLUNTEER_TYPES, REQUIREMENTS, TYPE_REQUIREMENTS, VALIDITY_YEARS, VolunteerError, missingRequirements, teamChecks,
  listShifts, listShiftActivities, saveShift, deleteShift, signUp, withdraw, shiftsForActivity,
  getRequirements, recordRequirements,
};
