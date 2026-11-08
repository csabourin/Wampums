'use strict';
/**
 * The members in charge of a schedule line (#1417, camp plan slice 2).
 *
 * A line names who leads it among the unit's members whose roles reach beyond
 * their own children: the same people a camp's team is chosen from
 * (services/campRoster.js `listTeamCandidates`). The free-text `responsable`
 * stays beside them for a person without an account.
 *
 * - Naming someone who is not such an active member of the line's unit is
 *   refused (400 `schedule_leaders_invalid`), whatever unit they belong to.
 * - Someone already named who has since left the unit stays named, marked
 *   `active_member: false`, so the plan keeps who led what; they may be removed,
 *   never newly added.
 *
 * @module services/scheduleLeaders
 */
const { ON_TEAM_SQL } = require('./campRoster');

const HTTP_BAD_REQUEST = 400;
/** How many members one line may name. */
const MAX_LEADERS = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A refusal whose message is a translation key the SPA knows, naming its field. */
class ScheduleLeaderError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST, field = 'leader_ids') {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/**
 * Check a list of members, before any transaction opens.
 *
 * @param {*} value - Request body's `leader_ids`
 * @returns {string[]} Lower-cased ids, in the order sent
 */
function readLeaderIds(value) {
  if (!Array.isArray(value) || value.length > MAX_LEADERS
    || value.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
    throw new ScheduleLeaderError('schedule_leaders_invalid');
  }
  const ids = value.map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) {
    throw new ScheduleLeaderError('schedule_leaders_invalid');
  }
  return ids;
}

/**
 * Replace the members in charge of one line, inside the caller's transaction
 * (which has locked the line). A member newly named must be an active member of
 * the unit with a role reaching beyond their own children; one already named may stay.
 *
 * @param {Object} client - Transaction client
 * @param {number} organizationId
 * @param {number} activityId - The schedule line
 * @param {string[]} userIds - From readLeaderIds
 */
async function replaceLineLeaders(client, organizationId, activityId, userIds) {
  if (userIds.length) {
    const allowed = (await client.query(
      `SELECT uo.user_id::text AS user_id
         FROM user_organizations uo
        WHERE uo.organization_id = $1 AND uo.user_id = ANY($2::uuid[]) AND uo.status = 'active' AND ${ON_TEAM_SQL}
       UNION
       SELECT l.user_id::text FROM year_plan_meeting_activity_leaders l
        WHERE l.organization_id = $1 AND l.meeting_activity_id = $3 AND l.user_id = ANY($2::uuid[])`,
      [organizationId, userIds, activityId]
    )).rows.map((row) => row.user_id.toLowerCase());
    if (userIds.some((id) => !allowed.includes(id))) {
      throw new ScheduleLeaderError('schedule_leaders_invalid');
    }
  }
  await client.query(
    `DELETE FROM year_plan_meeting_activity_leaders
      WHERE organization_id = $1 AND meeting_activity_id = $2 AND NOT (user_id = ANY($3::uuid[]))`,
    [organizationId, activityId, userIds]
  );
  if (userIds.length) {
    await client.query(
      `INSERT INTO year_plan_meeting_activity_leaders (organization_id, meeting_activity_id, user_id, position)
       SELECT $1, $2, chosen.id, chosen.position - 1
         FROM unnest($3::uuid[]) WITH ORDINALITY AS chosen(id, position)
       ON CONFLICT (meeting_activity_id, user_id) DO UPDATE SET position = EXCLUDED.position`,
      [organizationId, activityId, userIds]
    );
  }
}

/**
 * Attach to each line the members in charge of it, in order.
 *
 * @param {Object} db
 * @param {number} organizationId
 * @param {Object[]} activities - Schedule lines (with `id`)
 * @returns {Promise<Object[]>} The lines, each with `leaders: [{user_id, name, active_member}]`
 */
async function withLeaders(db, organizationId, activities) {
  const ids = activities.map((row) => row.id);
  if (!ids.length) {
    return activities;
  }
  const rows = (await db.query(
    `SELECT l.meeting_activity_id, l.user_id, u.full_name AS name,
            COALESCE(uo.status = 'active', FALSE) AS active_member
       FROM year_plan_meeting_activity_leaders l
       JOIN users u ON u.id = l.user_id
       LEFT JOIN user_organizations uo ON uo.organization_id = l.organization_id AND uo.user_id = l.user_id
      WHERE l.organization_id = $1 AND l.meeting_activity_id = ANY($2::int[])
      ORDER BY l.meeting_activity_id, l.position, u.full_name, l.user_id`,
    [organizationId, ids]
  )).rows;
  return activities.map((row) => ({
    ...row,
    leaders: rows.filter((leader) => leader.meeting_activity_id === row.id)
      .map(({ user_id: userId, name, active_member: activeMember }) => ({ user_id: userId, name, active_member: activeMember })),
  }));
}

module.exports = { ScheduleLeaderError, MAX_LEADERS, readLeaderIds, replaceLineLeaders, withLeaders };
