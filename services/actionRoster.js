'use strict';
const { isCalendarDate } = require('../utils/calendar-date');
const { findReplacedMeetings } = require('./meetingReplacement');
const { HTTP_STATUS } = require('../utils/http-status');

/** Roster snapshots shared by attendance, points, honors and offline preparation. */
async function getActionRoster(db, organizationId, startDate, endDate = startDate) {
  const activities = await db.query(
    `SELECT a.id, a.name,
            a.activity_start_date::text AS start_date, a.activity_end_date::text AS end_date,
            EXISTS (SELECT 1 FROM permission_slips ps
                     WHERE ps.activity_id = a.id AND ps.organization_id = $1
                       AND ps.status IN ('pending', 'signed', 'declined', 'revoked', 'expired')) AS requires_permission,
            ARRAY(SELECT DISTINCT ps.participant_id FROM permission_slips ps
                   WHERE ps.activity_id = a.id AND ps.organization_id = $1 AND ps.status = 'signed') AS signed_participant_ids
       FROM activities a
      WHERE a.organization_id = $1 AND a.is_active = TRUE
        AND a.activity_start_date <= $3::date AND a.activity_end_date >= $2::date
      ORDER BY a.activity_start_date, a.id`,
    [organizationId, startDate, endDate]
  );
  const attendance = await db.query(
    `SELECT participant_id, date::text AS date, status, is_on_site
       FROM attendance WHERE organization_id = $1 AND date BETWEEN $2::date AND $3::date`,
    [organizationId, startDate, endDate]
  );
  const meetings = await db.query(
    `SELECT date::text AS date FROM reunion_preparations
      WHERE organization_id = $1 AND date BETWEEN $2::date AND $3::date
      UNION SELECT meeting_date::text AS date FROM year_plan_meetings
      WHERE organization_id = $1 AND meeting_date BETWEEN $2::date AND $3::date AND activity_id IS NULL`,
    [organizationId, startDate, endDate]
  );
  // A date an outing replaces is the outing's day: its roster defaults to the outing.
  // Only meeting days can be replaced, so days without one need no lookup.
  const replacements = meetings.rows.length ? await findReplacedMeetings(db, organizationId, startDate, endDate) : [];
  const replaced = new Set(replacements.map((row) => row.meeting_date));
  return {
    activities: activities.rows,
    attendance: attendance.rows,
    meeting_dates: meetings.rows.map((row) => row.date).filter((date) => !replaced.has(date)),
    // The outing each replaced date follows, so the roster defaults to it even beside other activities.
    replacing_activities: Object.fromEntries(replacements.map((row) => [row.meeting_date, row.activity_id])),
  };
}

/**
 * Resolve the deliberately chosen activity and presence filter for an award.
 * Null means the whole unit; an empty set means nobody is currently eligible.
 * Explicit exceptions bypass the default filter, never unit enrollment checks.
 */
async function eligibleActionParticipants(db, organizationId, { date, activity_id: activityId, include_all: includeAll } = {}) {
  if (includeAll !== undefined && typeof includeAll !== 'boolean') {
    throw Object.assign(new Error('Invalid roster override'), { status: HTTP_STATUS.BAD_REQUEST });
  }
  if (activityId !== undefined && activityId !== null &&
      (!Number.isSafeInteger(activityId) || activityId <= 0)) {
    throw Object.assign(new Error('Invalid activity'), { status: HTTP_STATUS.BAD_REQUEST });
  }
  if (!isCalendarDate(date)) {
    throw Object.assign(new Error('Invalid roster date'), { status: HTTP_STATUS.BAD_REQUEST });
  }
  let allowed = null;
  if (activityId !== null && activityId !== undefined) {
    const activity = await db.query(
      `SELECT a.id,
              EXISTS (SELECT 1 FROM permission_slips ps WHERE ps.activity_id = a.id
                       AND ps.organization_id = $1 AND ps.status IN ('pending', 'signed', 'declined', 'revoked', 'expired')) AS requires_permission,
              ARRAY(SELECT DISTINCT ps.participant_id FROM permission_slips ps
                     WHERE ps.activity_id = a.id AND ps.organization_id = $1 AND ps.status = 'signed') AS signed_participant_ids
         FROM activities a WHERE a.organization_id = $1 AND a.id = $2 AND a.is_active = TRUE
          AND $3::date BETWEEN a.activity_start_date AND a.activity_end_date`,
      [organizationId, activityId, date]
    );
    const activityRow = activity.rows[0];
    if (!activityRow) { throw Object.assign(new Error('action_roster_activity_unavailable'), { status: HTTP_STATUS.CONFLICT }); }
    if (activityRow.requires_permission) { allowed = new Set(activityRow.signed_participant_ids.map(Number)); }
  }
  // Even an exception must name a real activity belonging to the current unit.
  if (includeAll === true) { return null; }
  const attendance = await db.query(
    `SELECT participant_id, status, is_on_site FROM attendance WHERE organization_id = $1 AND date = $2::date`,
    [organizationId, date]
  );
  if (attendance.rows.length > 0) {
    const present = new Set(attendance.rows.filter((row) =>
      ['present', 'late'].includes(row.status) && row.is_on_site !== false
    ).map((row) => Number(row.participant_id)));
    allowed = allowed === null ? present : new Set([...allowed].filter((id) => present.has(id)));
  }
  return allowed;
}

module.exports = { getActionRoster, eligibleActionParticipants };
