/**
 * Automatic emails about assigned tasks: a notice when a task is assigned to someone, then a
 * reminder a few days before its due date and another on the day. One email per person and poll
 * groups everything due. A unit may turn them off. No emailed link performs a write.
 */
const { TASK_REMINDERS: LIMITS, EQUIPMENT_REMINDERS } = require('../config/tasks');
const { sendEmail, getTranslationsByCode } = require('../utils/index');
const { isValidAddress, resolveOrganizationEmailSender } = require('./emailSender');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');

/** Reminder dates follow the same civil time zone as material reminders. */
const { TIME_ZONE } = EQUIPMENT_REMINDERS;

/**
 * Unfinished tasks owed a due reminder now: due today or in LEAD_DAYS, in a unit that has not
 * turned reminders off, on an event still planned, not yet reminded for this assignee and due
 * date, and not announced today by an assignment notice. A task with a material reminder is
 * left to it, so nobody receives two emails about one task.
 * Parameters: time zone, send hour, lead days, unit or null, assignee or null, row limit, setting key.
 */
const DUE_SQL = `WITH clock AS (SELECT (NOW() AT TIME ZONE $1)::date AS today,
    EXTRACT(HOUR FROM NOW() AT TIME ZONE $1)::int AS hour)
  SELECT t.id AS task_id, t.organization_id, t.assignee_id, t.title, t.due_date::text AS due_date,
    CASE WHEN t.due_date = clock.today THEN 'due_today' ELSE 'due_soon' END AS kind,
    COALESCE(a.name, m.theme, '') AS event_name
  FROM activity_tasks t CROSS JOIN clock
  LEFT JOIN activities a ON a.id = t.activity_id AND a.organization_id = t.organization_id AND a.is_active = TRUE
  LEFT JOIN year_plan_meetings m ON m.id = t.meeting_id AND m.organization_id = t.organization_id AND m.is_cancelled = FALSE
  WHERE t.status <> 'done' AND clock.hour >= $2::int
    AND t.due_date IN (clock.today, clock.today + $3::int)
    AND (a.id IS NOT NULL OR m.id IS NOT NULL)
    AND ($4::int IS NULL OR t.organization_id = $4) AND ($5::uuid IS NULL OR t.assignee_id = $5)
    AND NOT EXISTS (SELECT 1 FROM organization_settings s WHERE s.organization_id = t.organization_id
      AND s.setting_key = $7 AND s.setting_value->>'enabled' = 'false')
    AND NOT EXISTS (SELECT 1 FROM task_equipment_reminders er WHERE er.task_id = t.id AND er.organization_id = t.organization_id)
    AND NOT EXISTS (SELECT 1 FROM task_reminder_deliveries d WHERE d.task_id = t.id AND d.assignee_id = t.assignee_id
      AND d.due_date = t.due_date AND d.kind = CASE WHEN t.due_date = clock.today THEN 'due_today' ELSE 'due_soon' END)
    AND NOT EXISTS (SELECT 1 FROM task_reminder_deliveries n WHERE n.task_id = t.id AND n.assignee_id = t.assignee_id
      AND n.kind = 'assigned' AND (n.created_at AT TIME ZONE $1)::date = clock.today)
  ORDER BY t.due_date, t.id LIMIT $6`;

/** Queued assignment notices still true: same assignee, unfinished task, event still planned. */
const ASSIGNED_SQL = `SELECT d.id, t.id AS task_id, t.title, t.due_date::text AS due_date, COALESCE(a.name, m.theme, '') AS event_name
  FROM task_reminder_deliveries d
  JOIN activity_tasks t ON t.id = d.task_id AND t.organization_id = d.organization_id
    AND t.assignee_id = d.assignee_id AND t.status <> 'done'
  LEFT JOIN activities a ON a.id = t.activity_id AND a.organization_id = t.organization_id AND a.is_active = TRUE
  LEFT JOIN year_plan_meetings m ON m.id = t.meeting_id AND m.organization_id = t.organization_id AND m.is_cancelled = FALSE
  WHERE d.organization_id = $1 AND d.assignee_id = $2 AND d.kind = 'assigned' AND d.status = 'pending'
    AND (a.id IS NOT NULL OR m.id IS NOT NULL)
  ORDER BY t.due_date, t.id FOR UPDATE OF d`;

/**
 * Whether the unit sends task emails. They are on until a unit turns them off.
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - Authenticated unit
 * @returns {Promise<{enabled: boolean, lead_days: number}>}
 */
async function getSettings(db, organizationId) {
  const result = await db.query('SELECT setting_value FROM organization_settings WHERE organization_id = $1 AND setting_key = $2',
    [organizationId, LIMITS.SETTING_KEY]);
  return { enabled: result.rows[0]?.setting_value?.enabled !== false, lead_days: LIMITS.LEAD_DAYS };
}

/**
 * Turn the unit's task emails on or off.
 * @param {Object} db - pg pool or client
 * @param {number} organizationId - Authenticated unit
 * @param {boolean} enabled
 * @returns {Promise<{enabled: boolean, lead_days: number}>}
 */
async function saveSettings(db, organizationId, enabled) {
  await db.query(`INSERT INTO organization_settings (organization_id, setting_key, setting_value, created_at, updated_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    ON CONFLICT (organization_id, setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
  [organizationId, LIMITS.SETTING_KEY, JSON.stringify({ enabled })]);
  return { enabled, lead_days: LIMITS.LEAD_DAYS };
}

/**
 * Queue the notice of a new assignment inside the task's own transaction, so it exists exactly
 * when the assignment does. A notice not yet sent to a previous assignee is dropped, nobody is
 * told about a task they gave themselves, and an assignment made while the unit has reminders
 * off is never announced later, even if they are turned back on before the next poll.
 * @param {Object} db - Transaction client
 * @param {number} organizationId - Authenticated unit
 * @param {string} actorId - Member who assigned the task
 * @param {Object} task - Saved task row
 */
async function queueAssignmentNotice(db, organizationId, actorId, task) {
  await db.query(`UPDATE task_reminder_deliveries SET status = 'skipped'
    WHERE organization_id = $1 AND task_id = $2 AND kind = 'assigned' AND status = 'pending'`, [organizationId, task.id]);
  await db.query(`INSERT INTO task_reminder_deliveries (organization_id, task_id, assignee_id, kind, due_date, status)
    VALUES ($1, $2, $3, 'assigned', $4, CASE WHEN $5::boolean OR EXISTS (SELECT 1 FROM organization_settings s
      WHERE s.organization_id = $1 AND s.setting_key = $6 AND s.setting_value->>'enabled' = 'false')
      THEN 'skipped' ELSE 'pending' END)`,
  [organizationId, task.id, task.assignee_id, task.due_date, actorId === task.assignee_id, LIMITS.SETTING_KEY]);
}

/** Re-read membership, address and task access at dispatch: only a member who can open /tasks is written to. */
async function recipientFor(db, organizationId, assigneeId) {
  const result = await db.query(`SELECT u.email, u.language_preference FROM user_organizations uo JOIN users u ON u.id = uo.user_id
    WHERE uo.organization_id = $1 AND uo.user_id = $2 AND uo.status = 'active' FOR SHARE OF uo`, [organizationId, assigneeId]);
  const person = result.rows[0];
  // Loaded here, not at the top: the middleware refuses to load without a JWT secret, and
  // services/activityTasks.js, which queues notices, must stay loadable by scripts that have none.
  const { userHasPermission } = require('../middleware/auth');
  const req = { user: { id: assigneeId, organizationId } };
  if (!person || typeof person.email !== 'string' || !isValidAddress(person.email)
    || !await userHasPermission(req, db, organizationId, 'tasks.view')) {return null;}
  return person;
}

/** @param {string} isoDate - YYYY-MM-DD @param {string} language @returns {string} The date in words */
function formatDay(isoDate, language) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  try {
    return new Intl.DateTimeFormat(language || 'en', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
  }
}

/**
 * Plain-text email in the recipient's language, falling back to English key by key.
 * @param {string} language - Recipient's language
 * @param {Array} assigned - Newly assigned tasks
 * @param {Array} due - Tasks due today or soon
 * @param {string} baseUrl - The unit's address
 * @returns {{subject: string, text: string}}
 */
function buildMessage(language, assigned, due, baseUrl) {
  const bundle = { ...getTranslationsByCode('en'), ...getTranslationsByCode(language) };
  const line = (task) => `- ${task.title} (${task.event_name}) — ${bundle.task_reminder_email_due.replace('{date}', formatDay(task.due_date, language))}`;
  const sections = [
    [bundle.task_reminder_email_assigned, assigned],
    [bundle.task_reminder_email_today, due.filter((task) => task.kind === 'due_today')],
    [bundle.task_reminder_email_soon, due.filter((task) => task.kind === 'due_soon')],
  ].filter(([, tasks]) => tasks.length).map(([heading, tasks]) => `${heading}\n${tasks.map(line).join('\n')}`);
  return {
    subject: due.length ? bundle.task_reminder_email_subject_due : bundle.task_reminder_email_subject_assigned,
    text: `${sections.join('\n\n')}\n\n${bundle.task_reminder_email_open}\n${baseUrl}/tasks`,
  };
}

/**
 * Send one person everything a unit owes them now. The rows are claimed and committed BEFORE
 * transport, so a crash or an uncertain outcome is never replayed as a second email.
 * @param {Object} pool - pg pool
 * @param {number} organizationId
 * @param {string} assigneeId
 * @param {number} sendHour - Local hour from which due reminders leave
 */
async function dispatchGroup(pool, organizationId, assigneeId, sendHour) {
  const db = await pool.connect();
  let claim = null;
  try {
    await db.query('BEGIN');
    // Task rows first, the order task edits lock in, so an edit and a dispatch never deadlock.
    await db.query(`SELECT id FROM activity_tasks WHERE organization_id = $1 AND assignee_id = $2 AND status <> 'done'
      ORDER BY id FOR UPDATE`, [organizationId, assigneeId]);
    const assigned = (await db.query(ASSIGNED_SQL, [organizationId, assigneeId])).rows;
    await db.query(`UPDATE task_reminder_deliveries SET status = 'skipped'
      WHERE organization_id = $1 AND assignee_id = $2 AND kind = 'assigned' AND status = 'pending' AND id <> ALL($3::int[])`,
    [organizationId, assigneeId, assigned.map((row) => row.id)]);
    const due = (await db.query(DUE_SQL, [TIME_ZONE, sendHour, LIMITS.LEAD_DAYS, organizationId, assigneeId, LIMITS.BATCH_SIZE, LIMITS.SETTING_KEY])).rows;
    if (assigned.length || due.length) {
      const person = await recipientFor(db, organizationId, assigneeId);
      const status = person ? 'sending' : 'failed';
      const ids = assigned.map((row) => row.id);
      await db.query('UPDATE task_reminder_deliveries SET status = $2, attempted_at = NOW() WHERE id = ANY($1::int[])', [ids, status]);
      const claimed = await db.query(`INSERT INTO task_reminder_deliveries (organization_id, task_id, assignee_id, kind, due_date, status, attempted_at)
        SELECT $1, x.task_id, $2, x.kind, x.due_date, $4, NOW()
          FROM jsonb_to_recordset($3::jsonb) AS x(task_id int, kind text, due_date date)
        ON CONFLICT (task_id, assignee_id, kind, due_date) WHERE kind <> 'assigned' DO NOTHING RETURNING id`,
      [organizationId, assigneeId, JSON.stringify(due.map(({ task_id, kind, due_date }) => ({ task_id, kind, due_date }))), status]);
      ids.push(...claimed.rows.map((row) => row.id));
      if (person) {
        const baseUrl = await resolveOrganizationBaseUrl(db, organizationId);
        const sender = await resolveOrganizationEmailSender(db, organizationId);
        claim = { ids, to: person.email, sender, ...buildMessage(person.language_preference, assigned, due, baseUrl) };
      }
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {db.release();}
  if (!claim) {return;}
  let outcome;
  try {outcome = await sendEmail(claim.to, claim.subject, claim.text, null, claim.sender, { throwOnError: true }) ? 'sent' : 'failed';}
  catch {outcome = 'uncertain';}
  await pool.query('UPDATE task_reminder_deliveries SET status = $2 WHERE id = ANY($1::int[])', [claim.ids, outcome]);
}

/**
 * One poll across all server instances.
 * @param {Object} pool - pg pool
 * @param {{sendHour?: number}} [options] - Local hour from which due reminders leave
 */
async function tick(pool, { sendHour = LIMITS.SEND_HOUR } = {}) {
  const lock = await pool.connect();
  try {
    const acquired = (await lock.query('SELECT pg_try_advisory_lock($1) AS acquired', [LIMITS.LOCK_KEY])).rows[0]?.acquired;
    if (!acquired) {return;}
    try {
      // A unit that turned reminders off owes nobody the notices queued meanwhile.
      await lock.query(`UPDATE task_reminder_deliveries d SET status = 'skipped' WHERE d.status = 'pending'
        AND EXISTS (SELECT 1 FROM organization_settings s WHERE s.organization_id = d.organization_id
          AND s.setting_key = $1 AND s.setting_value->>'enabled' = 'false')`, [LIMITS.SETTING_KEY]);
      const [notices, due] = await Promise.all([
        pool.query(`SELECT DISTINCT organization_id, assignee_id FROM task_reminder_deliveries
          WHERE kind = 'assigned' AND status = 'pending' LIMIT $1`, [LIMITS.BATCH_SIZE]),
        pool.query(DUE_SQL, [TIME_ZONE, sendHour, LIMITS.LEAD_DAYS, null, null, LIMITS.BATCH_SIZE, LIMITS.SETTING_KEY]),
      ]);
      const groups = new Map([...notices.rows, ...due.rows].map((row) => [`${row.organization_id}:${row.assignee_id}`, row]));
      // Sequential so a provider call cannot generate an unbounded send burst.
      let failure = null;
      for (const row of groups.values()) {
        try {
          // eslint-disable-next-line no-await-in-loop -- serialize transport while holding the dispatcher lock
          await dispatchGroup(pool, row.organization_id, row.assignee_id, sendHour);
        } catch (err) {
          // One person's failure must not keep everyone after them waiting.
          failure = failure || err;
        }
      }
      if (failure) {throw failure;}
    } finally {await lock.query('SELECT pg_advisory_unlock($1)', [LIMITS.LOCK_KEY]);}
  } finally {lock.release();}
}

/** Start/stop with the application's other background services. */
class TaskReminderService {
  constructor(pool, logger) {this.pool = pool; this.logger = logger; this.timer = null; this.running = false;}
  start() {
    if (this.timer) {return;}
    this.timer = setInterval(() => this.poll(), LIMITS.POLL_MS);
    this.timer.unref?.(); this.poll();
  }
  async poll() {
    if (this.running) {return;}
    this.running = true;
    try {await tick(this.pool);} catch {this.logger.error('Task reminder poll failed');}
    finally {this.running = false;}
  }
  stop() {clearInterval(this.timer); this.timer = null;}
}

module.exports = { getSettings, saveSettings, queueAssignmentNotice, tick, TaskReminderService };
