'use strict';

/**
 * An outing that replaces a meeting.
 *
 * A one-day outing, on the date of a regular or special meeting and with every
 * youth, replaces that meeting: the day (dashboard, programme, rosters) follows
 * the outing. The meeting is not deleted and keeps its schedule lines and tasks;
 * the year planner marks it "replaced by {outing}". The replacement is worked out
 * from what is recorded, never stored, so it follows the outing's dates and
 * permission requests as they change.
 *
 * "Every youth" is the rule of the action rosters (`services/actionRoster.js`):
 * an outing without permission requests concerns the whole unit; one with
 * permission requests concerns the youths who received one, so it replaces the
 * meeting only when each active enrollment of the active scout year has received
 * one. An outing that invites only some youths never replaces a meeting.
 *
 * Cancelling such an outing asks whether the meeting comes back: by default it
 * does (nothing replaces it any more); declining marks the meeting cancelled, in
 * the outing's own transaction (`cancelReplacedMeeting`).
 *
 * @module services/meetingReplacement
 */

/** Permission request states that count as "issued", as in the action rosters. */
const ISSUED_SLIP_STATUSES = ['pending', 'signed', 'declined', 'revoked', 'expired'];
/** Bounds standing for "every date". */
const FIRST_DATE = '0001-01-01';
const LAST_DATE = '9999-12-31';

const REPLACEMENT_SQL = `
  SELECT m.id AS meeting_id, m.meeting_date::text AS meeting_date,
         outing.id AS activity_id, outing.name AS activity_name
    FROM year_plan_meetings m
    JOIN LATERAL (
      SELECT a.id, a.name
        FROM activities a
       WHERE a.organization_id = m.organization_id
         AND a.is_active = TRUE
         AND a.is_camp IS NOT TRUE
         AND a.activity_start_date = m.meeting_date
         AND COALESCE(a.activity_end_date, a.activity_start_date) = m.meeting_date
         AND a.invites_everyone IS NOT FALSE
         -- An outing the year plan already holds as a date of its own is that date, not a replacement.
         AND NOT EXISTS (SELECT 1 FROM year_plan_meetings own
                          WHERE own.organization_id = a.organization_id AND own.activity_id = a.id)
         AND (
           NOT EXISTS (SELECT 1 FROM permission_slips ps
                        WHERE ps.activity_id = a.id AND ps.organization_id = a.organization_id
                          AND ps.status = ANY($4::text[]))
           OR NOT EXISTS (
             SELECT 1 FROM participant_enrollments pe
               JOIN scout_years sy ON sy.id = pe.scout_year_id AND sy.organization_id = pe.organization_id
                                  AND sy.status = 'active'
              WHERE pe.organization_id = a.organization_id AND pe.status = 'active'
                AND NOT EXISTS (SELECT 1 FROM permission_slips ps
                                 WHERE ps.activity_id = a.id AND ps.organization_id = a.organization_id
                                   AND ps.participant_id = pe.participant_id
                                   AND ps.status = ANY($4::text[])))
         )
       ORDER BY a.id
       LIMIT 1
    ) outing ON TRUE
   WHERE m.organization_id = $1
     AND m.is_cancelled = FALSE
     AND m.activity_id IS NULL
     AND m.meeting_kind IN ('regular', 'special')
     AND m.meeting_date BETWEEN $2::date AND $3::date
   ORDER BY m.meeting_date`;

/**
 * @typedef {Object} Replacement
 * @property {number} meeting_id - The meeting replaced
 * @property {string} meeting_date - Its date, YYYY-MM-DD
 * @property {number} activity_id - The outing replacing it
 * @property {string} activity_name - The outing's name
 */

/**
 * The meetings an outing replaces between two dates, inclusive.
 *
 * @param {Object} db - Pool or client
 * @param {number} organizationId - Authenticated unit
 * @param {string} [fromDate] - YYYY-MM-DD; every date when omitted
 * @param {string} [toDate] - YYYY-MM-DD; every date when omitted
 * @returns {Promise<Replacement[]>} In date order
 */
async function findReplacedMeetings(db, organizationId, fromDate = FIRST_DATE, toDate = LAST_DATE) {
  const result = await db.query(REPLACEMENT_SQL, [organizationId, fromDate, toDate, ISSUED_SLIP_STATUSES]);
  return result.rows.map((row) => ({
    meeting_id: Number(row.meeting_id),
    meeting_date: row.meeting_date,
    activity_id: Number(row.activity_id),
    activity_name: row.activity_name,
  }));
}

/**
 * The meeting an outing replaces, if any.
 *
 * @param {Object} db - Pool or client
 * @param {number} organizationId - Authenticated unit
 * @param {number} activityId - The outing
 * @returns {Promise<?Replacement>}
 */
async function findMeetingReplacedBy(db, organizationId, activityId) {
  const activity = (await db.query(
    `SELECT activity_start_date::text AS start_date FROM activities
      WHERE id = $1 AND organization_id = $2 AND is_active = TRUE`,
    [activityId, organizationId]
  )).rows[0];
  if (!activity?.start_date) {
    return null;
  }
  const replacements = await findReplacedMeetings(db, organizationId, activity.start_date, activity.start_date);
  return replacements.find((replacement) => replacement.activity_id === Number(activityId)) || null;
}

/**
 * The outing is cancelled and its meeting is not to come back: mark the meeting
 * cancelled. Nothing else of the meeting changes (schedule lines, tasks).
 *
 * @param {Object} client - Client inside the outing's cancellation transaction
 * @param {number} organizationId - Authenticated unit
 * @param {number} meetingId - The meeting the outing replaced
 * @returns {Promise<void>}
 */
async function cancelReplacedMeeting(client, organizationId, meetingId) {
  await client.query(
    `UPDATE year_plan_meetings SET is_cancelled = TRUE, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [meetingId, organizationId]
  );
}

module.exports = { ISSUED_SLIP_STATUSES, findReplacedMeetings, findMeetingReplacedBy, cancelReplacedMeeting };
