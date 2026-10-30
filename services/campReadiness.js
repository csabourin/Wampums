/** Team preparation of a camp. Device/offline readiness is a separate concern. */
const { buildCampMaterialList } = require('./campMaterialList');
const { listLots } = require('./campEquipmentLots');

/**
 * Tasks and consent: what a planned camp and a camp recorded only as an activity share.
 * @returns {Array<Promise<void>>} Reads filling `sections`
 */
function eventReads(db, organizationId, camp, allowed, sections) {
  const reads = [];
  if (allowed.tasks) {
    reads.push(db.query(`SELECT t.id, t.title, t.status, t.due_date::text, u.full_name AS assignee_name,
        lr.lot_id AS equipment_lot_id
      FROM activity_tasks t JOIN users u ON u.id = t.assignee_id
      LEFT JOIN camp_equipment_lot_roles lr ON lr.task_id = t.id AND lr.organization_id = t.organization_id
      WHERE t.organization_id = $1 AND (t.meeting_id = $2 OR t.activity_id = $3)
      ORDER BY (t.status = 'done'), t.due_date, t.id`, [organizationId, camp.id, camp.activity_id]).then((data) => {
      sections.tasks = data.rows;
    }));
  }
  if (allowed.permissions && camp.activity_id) {
    // deadline_date is timestamptz, unlike the calendar dates above. Keep the
    // instant so pg and JSON serialize ISO UTC; a ::text cast produces a SQL
    // timestamp that the SPA's calendar-date formatter cannot read.
    reads.push(db.query(`SELECT status, COUNT(*)::int AS count, MIN(deadline_date) AS deadline
      FROM permission_slips WHERE organization_id = $1 AND activity_id = $2 AND status != 'archived'
      GROUP BY status ORDER BY status`, [organizationId, camp.activity_id]).then((data) => {
      sections.permissions = data.rows;
    }));
  }
  return reads;
}

/**
 * Read only sections authorized by the shared engine in the route. Every query
 * is scoped to the authenticated unit and the specific camp (or linked outing).
 * No overall "ready" flag: an unconfigured section is not proof of readiness.
 */
async function campReadiness(db, organizationId, meetingId, allowed) {
  const camp = (await db.query(`SELECT m.id, m.theme, m.meeting_date::text AS date_from,
      COALESCE(a.activity_end_date, m.meeting_date)::text AS date_to, m.activity_id, m.is_cancelled, m.year_plan_id
    FROM year_plan_meetings m LEFT JOIN activities a ON a.id = m.activity_id AND a.organization_id = m.organization_id
    WHERE m.organization_id = $1 AND m.id = $2 AND m.meeting_kind = 'camp'`, [organizationId, meetingId])).rows[0];
  if (!camp) { return null; }
  const sections = {};
  const reads = [];
  reads.push(buildCampMaterialList(db, organizationId, meetingId, { withInventory: allowed.inventory }).then((data) => {
    sections.material = data;
  }));
  if (allowed.lots) {
    reads.push(listLots(db, organizationId, meetingId).then((data) => { sections.lots = data; }));
  }
  reads.push(...eventReads(db, organizationId, camp, allowed, sections));
  await Promise.all(reads);
  return { camp, sections };
}

/**
 * A camp recorded as an activity (`is_camp`). When the year plan schedules it, its planned camp
 * answers; otherwise only tasks and consent exist, since collective material
 * and equipment lots are listed from a camp's schedule (`camp.scheduled` is false).
 * @returns {Promise<Object|null>} Null for another unit's, a removed, or a non-camp activity
 */
async function campReadinessForActivity(db, organizationId, activityId, allowed) {
  const planned = (await db.query(`SELECT id FROM year_plan_meetings
    WHERE organization_id = $1 AND activity_id = $2 AND meeting_kind = 'camp' ORDER BY id LIMIT 1`, [organizationId, activityId])).rows[0];
  if (planned) { return campReadiness(db, organizationId, planned.id, allowed); }
  const camp = (await db.query(`SELECT NULL::int AS id, a.name AS theme, a.activity_start_date::text AS date_from,
      a.activity_end_date::text AS date_to, a.id AS activity_id, false AS is_cancelled, NULL::int AS year_plan_id, false AS scheduled
    FROM activities a WHERE a.organization_id = $1 AND a.id = $2 AND a.is_active = TRUE AND a.is_camp`, [organizationId, activityId])).rows[0];
  if (!camp) { return null; }
  const sections = {};
  await Promise.all(eventReads(db, organizationId, camp, allowed, sections));
  return { camp, sections };
}
/**
 * Camps under way or starting within `days`, soonest first: planned camps, and camp activities
 * the year plan does not schedule, so the team finds their overview.
 * @param {Object} db
 * @param {number} organizationId
 * @param {number} days
 * @param {number} limit
 * @returns {Promise<Array<{id: number|null, activity_id: number|null, theme: string, date_from: string, date_to: string}>>}
 */
async function upcomingCamps(db, organizationId, days, limit) {
  return (await db.query(`SELECT * FROM (
      SELECT m.id, m.activity_id, m.theme, m.meeting_date::text AS date_from,
        COALESCE(a.activity_end_date, m.meeting_date)::text AS date_to
      FROM year_plan_meetings m LEFT JOIN activities a ON a.id = m.activity_id AND a.organization_id = m.organization_id
      WHERE m.organization_id = $1 AND m.meeting_kind = 'camp' AND NOT m.is_cancelled
        AND COALESCE(a.activity_end_date, m.meeting_date) >= CURRENT_DATE AND m.meeting_date <= CURRENT_DATE + $2::int
      UNION ALL
      SELECT NULL::int, a.id, a.name, a.activity_start_date::text, a.activity_end_date::text
      FROM activities a
      WHERE a.organization_id = $1 AND a.is_active = TRUE AND a.is_camp
        AND a.activity_end_date >= CURRENT_DATE AND a.activity_start_date <= CURRENT_DATE + $2::int
        AND NOT EXISTS (SELECT 1 FROM year_plan_meetings m WHERE m.organization_id = a.organization_id
          AND m.activity_id = a.id AND m.meeting_kind = 'camp')
    ) camps ORDER BY date_from, theme LIMIT $3`, [organizationId, days, limit])).rows;
}
module.exports = { campReadiness, campReadinessForActivity, upcomingCamps };
