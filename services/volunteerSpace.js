'use strict';
/**
 * Volunteer space (#1360): what a member needs at the camps they take part in, on one page.
 *
 * Access comes from taking part, never from a role's name: a place on one of a camp's volunteer
 * shifts, or a seat on the camp's team (camp_team_members), opens that camp and no other. The
 * `volunteer_space.view` key only lets a member open the space.
 *
 * Nothing here reads a youth, family or health record, and no other volunteer is named: a camp
 * shows the member's own shifts and tasks, the camp's schedule (titles and times), its site and
 * emergency numbers, the team's instructions from the camp plan (rules of life, camp rules, code
 * of ethics, emergency procedures), and what the member's shift types call for
 * (config/volunteer_shifts.json `space_panels`): the menus for a cook, the departure and carpool
 * for a driver, emergencies first for a night watch or first aid.
 *
 * @module services/volunteerSpace
 */
const config = require('../config/volunteer_shifts.json');
const { missingRequirements, requirementsByUser } = require('./volunteerShifts');
const { UNIT_SECTIONS, listTemplates, resolveSections } = require('./campPlan');

const HTTP_NOT_FOUND = 404;
/** How many open tasks the overview lists; the rest are on /tasks. */
const OVERVIEW_TASKS = 5;

/** Panels each shift type adds to a camp's page. */
const TYPE_PANELS = new Map(config.types.map((type) => [type.key, type.space_panels || []]));

/** A refusal safe to return: its message is a translation key the SPA explains. */
class VolunteerSpaceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Whether the member takes part in the camp activity `a`: a place on one of its shifts, or a seat
 * on the team of its planned camp (not cancelled). $1 is the unit, $2 the member.
 */
const TAKES_PART_SQL = `(
  EXISTS (SELECT 1 FROM volunteer_signups v
            JOIN volunteer_shifts s ON s.id = v.shift_id AND s.organization_id = v.organization_id
           WHERE v.organization_id = $1 AND v.user_id = $2 AND s.activity_id = a.id)
  OR EXISTS (SELECT 1 FROM camp_team_members t
               JOIN year_plan_meetings m ON m.id = t.meeting_id AND m.organization_id = t.organization_id
              WHERE t.organization_id = $1 AND t.user_id = $2 AND m.activity_id = a.id AND NOT m.is_cancelled))`;

/**
 * Attach to each place what it still lacks for its holder.
 * @param {Object} db
 * @param {number} organizationId
 * @param {string} userId
 * @param {Array<Object>} shifts - Rows with volunteer_type, shift_date and status
 * @returns {Promise<Array<Object>>}
 */
async function withMissing(db, organizationId, userId, shifts) {
  if (!shifts.some((shift) => shift.status === 'pending')) {
    return shifts.map((shift) => ({ ...shift, missing: [] }));
  }
  const records = (await requirementsByUser(db, organizationId, [userId])).get(userId);
  return shifts.map((shift) => ({
    ...shift,
    missing: shift.status === 'pending' ? missingRequirements(shift.volunteer_type, shift.shift_date, records) : [],
  }));
}

const SHIFT_COLUMNS = `s.id, s.activity_id, a.name AS activity_name, a.is_camp, s.volunteer_type, s.title,
       s.shift_date::text AS shift_date, to_char(s.start_time, 'HH24:MI') AS start_time,
       to_char(s.end_time, 'HH24:MI') AS end_time, s.notes, v.status`;

/**
 * The space's first page: the camps the member takes part in that are not over, their own
 * upcoming places (camps and other activities), and their open tasks.
 *
 * @param {Object} db
 * @param {number} organizationId - Authenticated unit
 * @param {string} userId - The caller
 * @returns {Promise<{camps: Object[], shifts: Object[], tasks: Object[], open_tasks: number}>}
 */
async function readOverview(db, organizationId, userId) {
  const [camps, shifts, tasks] = await Promise.all([
    db.query(
      `SELECT a.id AS activity_id, a.name, a.activity_start_date::text AS start_date, a.activity_end_date::text AS end_date,
              (SELECT t.team_role FROM camp_team_members t
                 JOIN year_plan_meetings m ON m.id = t.meeting_id AND m.organization_id = t.organization_id
                WHERE t.organization_id = $1 AND t.user_id = $2 AND m.activity_id = a.id AND NOT m.is_cancelled
                LIMIT 1) AS team_role,
              (SELECT COUNT(*)::int FROM volunteer_signups v
                 JOIN volunteer_shifts s ON s.id = v.shift_id AND s.organization_id = v.organization_id
                WHERE v.organization_id = $1 AND v.user_id = $2 AND s.activity_id = a.id) AS shift_count,
              (SELECT COUNT(*)::int FROM volunteer_signups v
                 JOIN volunteer_shifts s ON s.id = v.shift_id AND s.organization_id = v.organization_id
                WHERE v.organization_id = $1 AND v.user_id = $2 AND s.activity_id = a.id AND v.status = 'pending') AS pending_count
         FROM activities a
        WHERE a.organization_id = $1 AND a.is_camp AND a.is_active AND a.activity_end_date >= CURRENT_DATE
          AND ${TAKES_PART_SQL}
        ORDER BY a.activity_start_date, a.id`,
      [organizationId, userId]
    ),
    db.query(
      `SELECT ${SHIFT_COLUMNS}
         FROM volunteer_signups v
         JOIN volunteer_shifts s ON s.id = v.shift_id AND s.organization_id = v.organization_id
         JOIN activities a ON a.id = s.activity_id AND a.organization_id = s.organization_id AND a.is_active
        WHERE v.organization_id = $1 AND v.user_id = $2 AND s.shift_date >= CURRENT_DATE
        ORDER BY s.shift_date, s.start_time, s.id`,
      [organizationId, userId]
    ),
    db.query(
      `SELECT t.id, t.title, t.status, t.due_date::text AS due_date, a.name AS activity_name, m.theme AS meeting_name,
              COUNT(*) OVER ()::int AS open_total
         FROM activity_tasks t
         LEFT JOIN activities a ON a.id = t.activity_id AND a.organization_id = t.organization_id
         LEFT JOIN year_plan_meetings m ON m.id = t.meeting_id AND m.organization_id = t.organization_id
        WHERE t.organization_id = $1 AND t.assignee_id = $2 AND t.status <> 'done'
        ORDER BY t.due_date, t.id
        LIMIT $3`,
      [organizationId, userId, OVERVIEW_TASKS]
    ),
  ]);
  return {
    camps: camps.rows,
    shifts: await withMissing(db, organizationId, userId, shifts.rows),
    tasks: tasks.rows.map(({ open_total: _total, ...task }) => task),
    open_tasks: tasks.rows[0]?.open_total || 0,
  };
}

/** The camp's schedule: each day with its heading and timed lines (titles and times only). */
async function campSchedule(db, organizationId, camp, meeting) {
  if (!meeting) {
    return [];
  }
  const [days, lines] = await Promise.all([
    db.query(
      `SELECT offsets.day_offset, ($3::date + offsets.day_offset)::text AS date, d.title
         FROM GENERATE_SERIES(0, GREATEST(0, $4::date - $3::date)) AS offsets(day_offset)
         LEFT JOIN year_plan_meeting_days d
                ON d.organization_id = $1 AND d.meeting_id = $2 AND d.day_offset = offsets.day_offset
        ORDER BY offsets.day_offset`,
      [organizationId, meeting.id, meeting.meeting_date, camp.end_date]
    ),
    db.query(
      `SELECT day_offset, name, to_char(start_time, 'HH24:MI') AS start_time, duration_minutes
         FROM year_plan_meeting_activities
        WHERE organization_id = $1 AND meeting_id = $2
        ORDER BY day_offset, start_time NULLS LAST, sort_order, id`,
      [organizationId, meeting.id]
    ),
  ]);
  return days.rows.map((day) => ({
    ...day,
    items: lines.rows.filter((line) => line.day_offset === day.day_offset)
      .map(({ day_offset: _offset, ...line }) => line),
  }));
}

/** The camp's site and emergency numbers, and who leads on site (a name, never a contact). */
async function campSite(db, organizationId, meeting) {
  if (!meeting) {
    return null;
  }
  return (await db.query(
    `SELECT s.name, s.address, s.phone, s.directions_url, s.hospital_name, s.hospital_address, s.hospital_phone,
            s.hospital_travel_minutes, s.hospital_directions_url, s.poison_centre_phone, s.other_emergency_numbers,
            d.contact_phone, lead.full_name AS on_site_lead_name
       FROM camp_details d
       LEFT JOIN camp_sites s ON s.id = d.camp_site_id AND s.organization_id = d.organization_id
       LEFT JOIN users lead ON lead.id = d.on_site_lead_id
      WHERE d.organization_id = $1 AND d.meeting_id = $2`,
    [organizationId, meeting.id]
  )).rows[0] || null;
}

/** The team's instructions: the camp plan's stable sections that have a text, the camp's own or the unit's template. */
async function teamSections(db, organizationId, meeting) {
  const rows = meeting ? (await db.query(
    `SELECT section_key, body_html, body_text, needs_review, version, updated_at
       FROM camp_plan_sections
      WHERE organization_id = $1 AND meeting_id = $2 AND section_key = ANY($3::text[])`,
    [organizationId, meeting.id, UNIT_SECTIONS]
  )).rows : [];
  const templates = await listTemplates(db, organizationId);
  return resolveSections(rows, templates)
    .filter((section) => UNIT_SECTIONS.includes(section.key) && section.body_html)
    .map(({ key, body_html: html, body_text: text }) => ({ key, body_html: html, body_text: text }));
}

/**
 * One camp of the member's: refused as not found when they take no part in it, so another camp's
 * existence is never revealed.
 *
 * @param {Object} db
 * @param {number} organizationId - Authenticated unit
 * @param {string} userId - The caller
 * @param {number} activityId - The camp activity
 * @returns {Promise<Object>} { camp, team_role, panels, shifts, schedule, tasks, sections, site, menus }
 */
async function readCamp(db, organizationId, userId, activityId) {
  const camp = (await db.query(
    `SELECT a.id AS activity_id, a.name, a.activity_start_date::text AS start_date, a.activity_end_date::text AS end_date,
            to_char(a.activity_start_time, 'HH24:MI') AS start_time, to_char(a.activity_end_time, 'HH24:MI') AS end_time,
            a.meeting_location_going, to_char(a.meeting_time_going, 'HH24:MI') AS meeting_time_going,
            to_char(a.departure_time_going, 'HH24:MI') AS departure_time_going,
            a.meeting_location_return, to_char(a.meeting_time_return, 'HH24:MI') AS meeting_time_return,
            to_char(a.departure_time_return, 'HH24:MI') AS departure_time_return
       FROM activities a
      WHERE a.organization_id = $1 AND a.id = $3 AND a.is_camp AND a.is_active AND ${TAKES_PART_SQL}`,
    [organizationId, userId, activityId]
  )).rows[0];
  if (!camp) {
    throw new VolunteerSpaceError('volunteer_space_camp_not_found', HTTP_NOT_FOUND);
  }
  const meeting = (await db.query(
    `SELECT m.id, m.meeting_date::text AS meeting_date, t.team_role
       FROM year_plan_meetings m
       LEFT JOIN camp_team_members t ON t.organization_id = m.organization_id AND t.meeting_id = m.id AND t.user_id = $3
      WHERE m.organization_id = $1 AND m.activity_id = $2 AND m.meeting_kind = 'camp' AND NOT m.is_cancelled
      ORDER BY m.meeting_date, m.id LIMIT 1`,
    [organizationId, activityId, userId]
  )).rows[0] || null;
  const shiftRows = (await db.query(
    `SELECT ${SHIFT_COLUMNS}
       FROM volunteer_signups v
       JOIN volunteer_shifts s ON s.id = v.shift_id AND s.organization_id = v.organization_id
       JOIN activities a ON a.id = s.activity_id AND a.organization_id = s.organization_id
      WHERE v.organization_id = $1 AND v.user_id = $2 AND s.activity_id = $3
      ORDER BY s.shift_date, s.start_time, s.id`,
    [organizationId, userId, activityId]
  )).rows;
  const shifts = await withMissing(db, organizationId, userId, shiftRows);
  const panels = config.space_panels.filter((panel) => shifts.some((shift) =>
    (TYPE_PANELS.get(shift.volunteer_type) || []).includes(panel)));
  const [schedule, tasks, sections, site, menus] = await Promise.all([
    campSchedule(db, organizationId, camp, meeting),
    db.query(
      `SELECT t.id, t.title, t.status, t.due_date::text AS due_date
         FROM activity_tasks t
        WHERE t.organization_id = $1 AND t.assignee_id = $2
          AND (t.activity_id = $3 OR t.meeting_id = $4)
        ORDER BY (t.status = 'done'), t.due_date, t.id`,
      [organizationId, userId, activityId, meeting?.id ?? null]
    ),
    teamSections(db, organizationId, meeting),
    campSite(db, organizationId, meeting),
    // The menu of each meal is written in its cook shifts' notes until menus have their own place (#1260).
    panels.includes('menus') ? db.query(
      `SELECT s.id, s.title, s.shift_date::text AS shift_date, to_char(s.start_time, 'HH24:MI') AS start_time,
              to_char(s.end_time, 'HH24:MI') AS end_time, s.notes
         FROM volunteer_shifts s
        WHERE s.organization_id = $1 AND s.activity_id = $2 AND s.volunteer_type = 'cook' AND BTRIM(s.notes) <> ''
        ORDER BY s.shift_date, s.start_time, s.id`,
      [organizationId, activityId]
    ) : Promise.resolve({ rows: [] }),
  ]);
  return {
    camp,
    team_role: meeting?.team_role || null,
    has_plan: Boolean(meeting),
    panels,
    shifts,
    schedule,
    tasks: tasks.rows,
    sections,
    site,
    menus: menus.rows,
  };
}

module.exports = { VolunteerSpaceError, OVERVIEW_TASKS, readOverview, readCamp };
