/** Team preparation of a camp. Device/offline readiness is a separate concern. */
const { buildCampMaterialList } = require('./campMaterialList');
const { listLots } = require('./campEquipmentLots');

/**
 * Read only sections authorized by the shared engine in the route. Every query
 * is scoped to the authenticated unit and the specific camp (or linked outing).
 * No overall "ready" flag: an unconfigured section is not proof of readiness.
 */
async function campReadiness(db, organizationId, meetingId, allowed) {
  const camp = (await db.query(`SELECT m.id, m.theme, m.meeting_date::text AS date_from,
      COALESCE(a.activity_end_date, m.meeting_date)::text AS date_to, m.activity_id, m.is_cancelled
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
  if (allowed.tasks) {
    reads.push(db.query(`SELECT t.id, t.title, t.status, t.due_date::text, u.full_name AS assignee_name,
        lr.lot_id AS equipment_lot_id
      FROM activity_tasks t JOIN users u ON u.id = t.assignee_id
      LEFT JOIN camp_equipment_lot_roles lr ON lr.task_id = t.id AND lr.organization_id = t.organization_id
      WHERE t.organization_id = $1 AND (t.meeting_id = $2 OR t.activity_id = $3)
      ORDER BY (t.status = 'done'), t.due_date, t.id`, [organizationId, meetingId, camp.activity_id]).then((data) => {
      sections.tasks = data.rows;
    }));
  }
  if (allowed.permissions && camp.activity_id) {
    reads.push(db.query(`SELECT status, COUNT(*)::int AS count, MIN(deadline_date) AS deadline
      FROM permission_slips WHERE organization_id = $1 AND activity_id = $2 AND status != 'archived'
      GROUP BY status ORDER BY status`, [organizationId, camp.activity_id]).then((data) => {
      sections.permissions = data.rows;
    }));
  }
  await Promise.all(reads);
  return { camp, sections };
}
module.exports = { campReadiness };
