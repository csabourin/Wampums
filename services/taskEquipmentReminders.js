/** Material reminders reuse task ownership, event and due date. No emailed link performs a write. */
const { transaction, TaskError } = require('./activityTasks');
const { EQUIPMENT_REMINDERS: LIMITS } = require('../config/tasks');
const { sendEmail, getTranslationsByCode } = require('../utils/index');
const { isValidAddress } = require('./emailSender');
const { resolveOrganizationEmailSender } = require('./emailSender');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');
const { userHasPermission } = require('../middleware/auth');
const HTTP_NOT_FOUND = 404;
const ISO_DATE_LENGTH = 10;
const HTTP_CONFLICT = 409;

/** Lock the source task before its reminder, consistently with task edits. */
async function taskFor(db, organizationId, taskId, actorId = null) {
  const result = await db.query(`SELECT *, due_date::text AS due_date FROM activity_tasks WHERE organization_id = $1 AND id = $2
    AND ($3::uuid IS NULL OR assignee_id = $3) FOR UPDATE`, [organizationId, taskId, actorId]);
  if (!result.rows.length) {throw new TaskError('tasks_not_found', HTTP_NOT_FOUND);}
  return result.rows[0];
}

/** Store configuration without silently overwriting another manager's revision. */
function configure(pool, organizationId, taskId, value) {
  return transaction(pool, async (db) => {
    await taskFor(db, organizationId, taskId);
    const existing = (await db.query('SELECT * FROM task_equipment_reminders WHERE organization_id = $1 AND task_id = $2 FOR UPDATE', [organizationId, taskId])).rows[0];
    if ((existing?.revision || 0) !== value.expected_revision) {throw new TaskError('equipment_reminder_stale', HTTP_CONFLICT);}
    if (!value.enabled) {
      await db.query('DELETE FROM task_equipment_reminders WHERE organization_id = $1 AND task_id = $2', [organizationId, taskId]);
      return null;
    }
    const result = await db.query(`INSERT INTO task_equipment_reminders (organization_id, task_id, materials, lead_days, repeat_hours)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (task_id) DO UPDATE SET materials = EXCLUDED.materials,
      lead_days = EXCLUDED.lead_days, repeat_hours = EXCLUDED.repeat_hours,
      revision = nextval('task_equipment_reminder_revision'), confirmed_at = NULL,
      last_attempt_at = NULL, delivery_status = 'pending' RETURNING *`,
    [organizationId, taskId, value.materials, value.lead_days, value.repeat_hours]);
    return result.rows[0];
  });
}

/** Only the current assignee may confirm the revision they actually saw. */
function confirm(pool, organizationId, taskId, actorId, revision) {
  return transaction(pool, async (db) => {
    await taskFor(db, organizationId, taskId, actorId);
    const result = await db.query(`UPDATE task_equipment_reminders SET confirmed_at = COALESCE(confirmed_at, NOW())
      WHERE organization_id = $1 AND task_id = $2 AND revision = $3 RETURNING *`, [organizationId, taskId, revision]);
    if (!result.rows.length) {throw new TaskError('equipment_reminder_stale', HTTP_CONFLICT);}
    return result.rows[0];
  });
}

/** Re-read membership and cancellation at dispatch. Names from free-text responsibility fields never receive mail. */
async function recipientFor(db, task) {
  const result = await db.query(`SELECT u.email, u.language_preference, COALESCE(a.name, m.theme, '') AS event_name
    FROM user_organizations uo JOIN users u ON u.id = uo.user_id
    LEFT JOIN activities a ON a.id = $3 AND a.organization_id = $1 AND a.is_active = TRUE
    LEFT JOIN year_plan_meetings m ON m.id = $4 AND m.organization_id = $1 AND m.is_cancelled = FALSE
    WHERE uo.organization_id = $1 AND uo.user_id = $2 AND uo.status = 'active'
      AND (a.id IS NOT NULL OR m.id IS NOT NULL) FOR SHARE OF uo`,
  [task.organization_id, task.assignee_id, task.activity_id, task.meeting_id]);
  const person = result.rows[0];
  const req = { user: { id: task.assignee_id, organizationId: task.organization_id } };
  if (!person || typeof person.email !== 'string' || !isValidAddress(person.email) || !await userHasPermission(req, db, task.organization_id, 'tasks.view')) {return null;}
  return person;
}

/**
 * Serialize each candidate, persist a claim BEFORE transport and never replay an
 * interrupted/uncertain send. Repeat sends are separate reminders, at least 24h apart.
 * The task lock is retained during transport so confirmation/reassignment cannot race it.
 */
async function dispatchOne(pool, organizationId, taskId) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const task = await taskFor(db, organizationId, taskId);
    const reminder = (await db.query(`SELECT * FROM task_equipment_reminders
      WHERE organization_id = $1 AND task_id = $2 AND confirmed_at IS NULL
      AND delivery_status NOT IN ('sending', 'uncertain')
      AND (last_attempt_at IS NULL OR last_attempt_at <= NOW() - make_interval(hours => repeat_hours))
      AND $3::date BETWEEN (NOW() AT TIME ZONE $4)::date AND (NOW() AT TIME ZONE $4)::date + lead_days
      FOR UPDATE`, [organizationId, taskId, task.due_date, LIMITS.TIME_ZONE])).rows[0];
    if (!reminder || task.status === 'done') {await db.query('ROLLBACK'); return;}
    const person = await recipientFor(db, task);
    if (!person) {
      await db.query("UPDATE task_equipment_reminders SET last_attempt_at = NOW(), delivery_status = 'failed' WHERE organization_id = $1 AND task_id = $2", [organizationId, taskId]);
      await db.query('COMMIT'); return;
    }
    // Commit a durable claim. Hold a session advisory lock in tick across the gap.
    await db.query("UPDATE task_equipment_reminders SET last_attempt_at = NOW(), delivery_status = 'sending' WHERE organization_id = $1 AND task_id = $2", [organizationId, taskId]);
    await db.query('COMMIT');
    await db.query('BEGIN');
    const current = await taskFor(db, organizationId, taskId);
    const claimed = (await db.query(`SELECT * FROM task_equipment_reminders WHERE organization_id = $1 AND task_id = $2
      AND revision = $3 AND confirmed_at IS NULL AND delivery_status = 'sending' FOR UPDATE`, [organizationId, taskId, reminder.revision])).rows[0];
    const recipient = claimed && current.status !== 'done' ? await recipientFor(db, current) : null;
    if (!recipient) {await db.query('ROLLBACK'); return;}
    const baseUrl = await resolveOrganizationBaseUrl(db, organizationId);
    const sender = await resolveOrganizationEmailSender(db, organizationId);
    const en = getTranslationsByCode('en');
    const bundle = { ...en, ...getTranslationsByCode(recipient.language_preference) };
    const subject = bundle.equipment_reminder_email_subject;
    const text = `${bundle.equipment_reminder_email_intro}\n${recipient.event_name}\n${current.title}\n${current.due_date.slice(0, ISO_DATE_LENGTH)}\n\n${claimed.materials}\n\n${bundle.equipment_reminder_email_confirm}\n${baseUrl}/tasks?task_id=${taskId}`;
    let status;
    try {status = await sendEmail(recipient.email, subject, text, null, sender, { throwOnError: true }) ? 'sent' : 'failed';}
    catch {status = 'uncertain';}
    await db.query('UPDATE task_equipment_reminders SET delivery_status = $3 WHERE organization_id = $1 AND task_id = $2', [organizationId, taskId, status]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    if (!(err instanceof TaskError && err.status === HTTP_NOT_FOUND)) {throw err;}
  } finally {db.release();}
}

/** One poll across all server instances; only opt-in reminders are scanned. */
async function tick(pool) {
  const lock = await pool.connect();
  try {
    const acquired = (await lock.query('SELECT pg_try_advisory_lock($1) AS acquired', [LIMITS.LOCK_KEY])).rows[0]?.acquired;
    if (!acquired) {return;}
    try {
      const candidates = await lock.query(`SELECT r.organization_id, r.task_id FROM task_equipment_reminders r
        JOIN activity_tasks t ON t.id = r.task_id AND t.organization_id = r.organization_id
        WHERE r.confirmed_at IS NULL AND t.status <> 'done' AND r.delivery_status NOT IN ('sending', 'uncertain')
        AND t.due_date BETWEEN (NOW() AT TIME ZONE $2)::date AND (NOW() AT TIME ZONE $2)::date + r.lead_days
        AND (r.last_attempt_at IS NULL OR r.last_attempt_at <= NOW() - make_interval(hours => r.repeat_hours))
        ORDER BY r.last_attempt_at NULLS FIRST, r.task_id LIMIT $1`, [LIMITS.BATCH_SIZE, LIMITS.TIME_ZONE]);
      // Sequential so a provider call cannot generate an unbounded send burst.
      for (const row of candidates.rows) {
        // eslint-disable-next-line no-await-in-loop -- serialize transport while holding the dispatcher lock
        await dispatchOne(pool, row.organization_id, row.task_id);
      }
    } finally {await lock.query('SELECT pg_advisory_unlock($1)', [LIMITS.LOCK_KEY]);}
  } finally {lock.release();}
}

/** Start/stop with the application's other background services. */
class EquipmentReminderService {
  constructor(pool, logger) {this.pool = pool; this.logger = logger; this.timer = null; this.running = false;}
  start() {
    if (this.timer) {return;}
    this.timer = setInterval(() => this.poll(), LIMITS.POLL_MS);
    this.timer.unref?.(); this.poll();
  }
  async poll() {
    if (this.running) {return;}
    this.running = true;
    try {await tick(this.pool);} catch {this.logger.error('Equipment reminder poll failed');}
    finally {this.running = false;}
  }
  stop() {clearInterval(this.timer); this.timer = null;}
}
module.exports = { configure, confirm, tick, dispatchOne, EquipmentReminderService };
