/**
 * When a unit changes its usual meeting time (Unit settings), its upcoming
 * planned meetings follow.
 *
 * The yearly planner copies the unit's meeting time into each meeting it
 * generates, so a later change of that setting used to leave every planned
 * meeting at the old hour. Only meetings still at the old hour move: one a
 * leader set to another hour keeps it. Cancelled meetings, days linked to an
 * outing or camp (they keep the activity's own hours) and anything but
 * ordinary meetings are left alone. The evening's schedule (its activities'
 * times) is the leaders' work and is not touched.
 */
const { DEFAULT_MEETING_TIME } = require('../utils/meeting-defaults');

/**
 * The unit's usual meeting time before this change, read under lock in the
 * caller's transaction.
 *
 * @param {Object} client - Transaction client
 * @param {number} organizationId - Authenticated unit
 * @returns {Promise<string>} "HH:MM"; the default every meeting was generated with when none was set
 */
async function currentMeetingTime(client, organizationId) {
  const result = await client.query(
    `SELECT setting_value->>'meeting_time' AS meeting_time
       FROM organization_settings
      WHERE organization_id = $1 AND setting_key = 'organization_info'
      FOR UPDATE`,
    [organizationId]
  );
  return result.rows[0]?.meeting_time || DEFAULT_MEETING_TIME;
}

/**
 * Move the upcoming ordinary meetings still at `previousTime` to `nextTime`,
 * shifting their end by the same amount.
 *
 * @param {Object} client - Transaction client
 * @param {number} organizationId - Authenticated unit
 * @param {string} previousTime - "HH:MM" the meetings were planned at
 * @param {string} nextTime - "HH:MM" they now start at
 * @returns {Promise<number>} How many meetings moved
 */
async function moveUpcomingMeetings(client, organizationId, previousTime, nextTime) {
  if (!nextTime || previousTime === nextTime) {
    return 0;
  }
  const result = await client.query(
    `UPDATE year_plan_meetings
        SET start_time = $3::time,
            end_time = CASE WHEN end_time IS NULL THEN NULL ELSE end_time + ($3::time - $2::time) END,
            updated_at = NOW()
      WHERE organization_id = $1
        AND meeting_date >= CURRENT_DATE
        AND NOT is_cancelled
        AND activity_id IS NULL
        AND meeting_kind = 'regular'
        AND start_time = $2::time`,
    [organizationId, previousTime, nextTime]
  );
  return result.rowCount || 0;
}

module.exports = { currentMeetingTime, moveUpcomingMeetings };
