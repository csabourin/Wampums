/** Shared task persistence. All mutations and their history commit together. */

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

/** A task refusal safe to return to the caller. */
class TaskError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Run a task mutation atomically, rolling back before returning a refusal.
 * @param {Object} pool - pg pool
 * @param {Function} mutate - Callback receiving a transaction client
 * @returns {Promise<Object>} Saved task
 */
async function transaction(pool, mutate) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await mutate(client);
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
 * Lock an active membership and the unit's event before assigning a task.
 * @param {Object} db - Transaction client
 * @param {number} organizationId - Authenticated unit
 * @param {Object} task - Validated assignment
 */
async function validateAssignment(db, organizationId, task) {
  const member = await db.query(
    `SELECT user_id FROM user_organizations
      WHERE organization_id = $1 AND user_id = $2 AND status = 'active' FOR SHARE`,
    [organizationId, task.assignee_id]
  );
  if (!member.rows.length) {throw new TaskError('tasks_assignee_inactive', HTTP_BAD_REQUEST);}
  const event = task.activity_id
    ? await db.query('SELECT id FROM activities WHERE organization_id = $1 AND id = $2 FOR SHARE', [organizationId, task.activity_id])
    : await db.query('SELECT id FROM year_plan_meetings WHERE organization_id = $1 AND id = $2 FOR SHARE', [organizationId, task.meeting_id]);
  if (!event.rows.length) {throw new TaskError('tasks_event_not_found', HTTP_NOT_FOUND);}
}

/** Record a creation or transition inside the task transaction. */
async function recordStatus(db, organizationId, actorId, task, previousStatus) {
  await db.query(
    `INSERT INTO activity_task_history (organization_id, task_id, previous_status, status, changed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [organizationId, task.id, previousStatus, task.status, actorId]
  );
}

/**
 * Create or replace task details inside an existing transaction.
 * The caller owns BEGIN/COMMIT/ROLLBACK; status changes use changeTaskStatus instead.
 * @param {Object} db - Transaction client
 * @param {number} organizationId - Authenticated unit
 * @param {string} actorId - Authenticated member
 * @param {Object} task - Validated fields
 * @param {number|null} taskId - Existing task, or null to create
 * @returns {Promise<Object>} Saved task
 */
async function saveTaskInTransaction(db, organizationId, actorId, task, taskId = null) {
  if (taskId) {
    const existing = await db.query('SELECT id FROM activity_tasks WHERE organization_id = $1 AND id = $2 FOR UPDATE', [organizationId, taskId]);
    if (!existing.rows.length) {throw new TaskError('tasks_not_found', HTTP_NOT_FOUND);}
  }
  await validateAssignment(db, organizationId, task);
  const values = [organizationId, task.activity_id || null, task.meeting_id || null, task.title, task.assignee_id, task.due_date];
  const result = taskId
    ? await db.query(
      `UPDATE activity_tasks SET activity_id = $2, meeting_id = $3, title = $4,
        assignee_id = $5, due_date = $6, updated_at = NOW()
        WHERE organization_id = $1 AND id = $7 RETURNING *`, [...values, taskId])
    : await db.query(
      `INSERT INTO activity_tasks (organization_id, activity_id, meeting_id, title, assignee_id, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [...values, actorId]);
  if (!taskId) {await recordStatus(db, organizationId, actorId, result.rows[0], null);}
  return result.rows[0];
}

/** Lot-owned tasks are edited through their lot, so assignment and progress cannot diverge. */
async function assertStandaloneTask(db, organizationId, taskId) {
  const linked = await db.query('SELECT 1 FROM camp_equipment_lot_roles WHERE organization_id = $1 AND task_id = $2', [organizationId, taskId]);
  if (linked.rows.length) {throw new TaskError('camp_lot_task_managed', HTTP_CONFLICT);}
}

/** Write an ordinary task through the same transaction-aware implementation used by equipment lots. */
function saveTask(pool, organizationId, actorId, task, taskId = null) {
  return transaction(pool, async (db) => {
    if (taskId) {await assertStandaloneTask(db, organizationId, taskId);}
    return saveTaskInTransaction(db, organizationId, actorId, task, taskId);
  });
}

/**
 * Change an owned task (or any unit task for a manager). Row locking and the
 * expected status prevent concurrent changes from silently overwriting one another.
 * @param {Object} pool - pg pool
 * @param {Object} context - Unit, actor and ownership restriction
 * @param {number} taskId - Task id
 * @param {string} status - New status
 * @param {string} expectedStatus - Status the caller saw
 * @returns {Promise<Object>} Saved task
 */
function changeTaskStatus(pool, { organizationId, actorId, ownOnly }, taskId, status, expectedStatus) {
  return transaction(pool, async (db) => {
    const result = await db.query(
      `SELECT * FROM activity_tasks WHERE organization_id = $1 AND id = $2
        AND ($3::uuid IS NULL OR assignee_id = $3) FOR UPDATE`,
      [organizationId, taskId, ownOnly ? actorId : null]
    );
    const task = result.rows[0];
    if (!task) {throw new TaskError('tasks_not_found', HTTP_NOT_FOUND);}
    await assertStandaloneTask(db, organizationId, taskId);
    if (task.status !== expectedStatus) {throw new TaskError('tasks_status_conflict', HTTP_CONFLICT);}
    if (task.status === status) {return task;}
    const saved = await db.query(
      'UPDATE activity_tasks SET status = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2 RETURNING *',
      [organizationId, taskId, status]
    );
    await recordStatus(db, organizationId, actorId, saved.rows[0], task.status);
    return saved.rows[0];
  });
}

/**
 * List unit tasks or just the caller's assignments. Event names and status history
 * contain no youth or health data and do not confer access to the event's records.
 * @param {Object} db - pg pool
 * @param {number} organizationId - Authenticated unit
 * @param {string|null} assigneeId - Restrict to this member, or null for managers
 * @returns {Promise<Array>} Task summaries
 */
async function listTasks(db, organizationId, assigneeId) {
  const result = await db.query(
    `SELECT t.*, lr.lot_id AS equipment_lot_id, lr.role AS equipment_lot_role, u.full_name AS assignee_name, a.name AS activity_name,
            m.theme AS meeting_name, m.meeting_date::text,
            t.due_date::text,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('status', h.status,
              'previous_status', h.previous_status, 'changed_at', h.changed_at,
              'changed_by_name', actor.full_name) ORDER BY h.id)
              FROM activity_task_history h LEFT JOIN users actor ON actor.id = h.changed_by
              WHERE h.organization_id = t.organization_id AND h.task_id = t.id), '[]'::jsonb) AS history
       FROM activity_tasks t
       LEFT JOIN camp_equipment_lot_roles lr ON lr.task_id = t.id AND lr.organization_id = t.organization_id
       JOIN users u ON u.id = t.assignee_id
       LEFT JOIN activities a ON a.id = t.activity_id AND a.organization_id = t.organization_id
       LEFT JOIN year_plan_meetings m ON m.id = t.meeting_id AND m.organization_id = t.organization_id
      WHERE t.organization_id = $1 AND ($2::uuid IS NULL OR t.assignee_id = $2)
      ORDER BY (t.status = 'done'), t.due_date, t.id`,
    [organizationId, assigneeId]
  );
  return result.rows;
}

module.exports = { TaskError, saveTask, saveTaskInTransaction, recordStatus, changeTaskStatus, listTasks };
