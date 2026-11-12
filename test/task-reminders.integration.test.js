/** Automatic task emails on migrated PostgreSQL: assignment notices, due reminders, one claim per email. */
const { Pool } = require('pg');
process.env.JWT_SECRET_KEY = 'task-reminder-integration';
jest.mock('../utils/index', () => ({
  sendEmail: jest.fn(),
  getTranslationsByCode: (code) => (code === 'fr'
    ? { task_reminder_email_subject_due: 'Rappel', task_reminder_email_today: 'Aujourd’hui :' }
    : { task_reminder_email_subject_assigned: 'Assigned', task_reminder_email_subject_due: 'Reminder',
      task_reminder_email_assigned: 'Assigned to you:', task_reminder_email_today: 'Due today:',
      task_reminder_email_soon: 'Due soon:', task_reminder_email_due: 'due {date}', task_reminder_email_open: 'Open your tasks:' }),
}));
jest.mock('../services/emailSender', () => ({ ...jest.requireActual('../services/emailSender'), resolveOrganizationEmailSender: jest.fn(() => ({ name: 'Fictional unit', email: 'unit@example.test' })) }));
jest.mock('../utils/public-url', () => ({ resolveOrganizationBaseUrl: jest.fn(() => 'https://fictional.wampums.app') }));
const { sendEmail } = require('../utils/index');
const { saveTask } = require('../services/activityTasks');
const { configure } = require('../services/taskEquipmentReminders');
const { tick, saveSettings, getSettings } = require('../services/taskReminders');
const { EQUIPMENT_REMINDERS } = require('../config/tasks');
const DATABASE_URL = process.env.TEST_DATABASE_URL;
/** Any hour of the day counts as "morning" in these tests. */
const NOW = { sendHour: 0 };

describe.skipIf(!DATABASE_URL)('Task email reminders', () => {
  let pool; let organizationId; let otherUnit; let manager; let assignee; let colleague; let role; let meeting;
  const users = [];
  const one = async (sql, values = []) => Object.values((await pool.query(sql, values)).rows[0])[0];
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional task reminder unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT'); return id;
    } finally {db.release();}
  }
  async function member(name = 'Ada Example') {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES ('task-reminder-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [name]);
    users.push(id);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids, status) VALUES ($1, $2, $3, $4)', [organizationId, id, JSON.stringify([role]), 'active']);
    return id;
  }
  /** The unit's civil date, offset by a number of days. */
  const day = (offset) => one('SELECT ((NOW() AT TIME ZONE $1)::date + $2::int)::text', [EQUIPMENT_REMINDERS.TIME_ZONE, offset]);
  const assign = async (offset, overrides = {}) => saveTask(pool, organizationId, manager,
    { title: 'Bring tents', meeting_id: meeting, due_date: await day(offset), assignee_id: assignee, ...overrides });
  /** As if the assignment had been made on an earlier day, so today's notice is not the reminder. */
  const assignedEarlier = () => pool.query("UPDATE task_reminder_deliveries SET created_at = NOW() - INTERVAL '3 days', status = 'sent' WHERE organization_id = $1 AND kind = 'assigned'", [organizationId]);
  const deliveries = async () => (await pool.query('SELECT kind, status FROM task_reminder_deliveries WHERE organization_id = $1 ORDER BY id', [organizationId])).rows;
  const emailTo = (id) => one('SELECT email FROM users WHERE id = $1', [id]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL }); organizationId = await unit(); otherUnit = await unit();
    role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('task_reminder_' || gen_random_uuid(), 'Task team', 'organization', $1) RETURNING id", [organizationId]);
    await pool.query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key IN ('tasks.view', 'tasks.manage')", [role]);
    manager = await member('Grace Example'); assignee = await member(); colleague = await member('Léa Exemple');
    meeting = await one("INSERT INTO year_plan_meetings (organization_id, meeting_date, theme) VALUES ($1, CURRENT_DATE + 3, 'Fictional meeting') RETURNING id", [organizationId]);
  });
  beforeEach(async () => {
    jest.clearAllMocks(); sendEmail.mockResolvedValue(true);
    await pool.query('DELETE FROM activity_tasks WHERE organization_id = $1', [organizationId]);
    await pool.query('DELETE FROM organization_settings WHERE organization_id = $1 AND setting_key = $2', [organizationId, 'task_email_reminders']);
    await pool.query("UPDATE user_organizations SET status = 'active', role_ids = $2 WHERE organization_id = $1", [organizationId, JSON.stringify([role])]);
    await pool.query("UPDATE users SET language_preference = 'en' WHERE id = ANY($1::uuid[])", [users]);
    await pool.query('UPDATE year_plan_meetings SET is_cancelled = FALSE WHERE id = $1', [meeting]);
  });
  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [[organizationId, otherUnit]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]); await pool.end();
  });

  test('someone assigned a task is told once by email, with a link that only opens their tasks', async () => {
    await assign(10);
    await Promise.all([tick(pool, NOW), tick(pool, NOW)]); await tick(pool, NOW);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, text] = sendEmail.mock.calls[0];
    expect(to).toBe(await emailTo(assignee));
    expect(subject).toBe('Assigned');
    expect(text).toContain('Assigned to you:\n- Bring tents (Fictional meeting)');
    expect(text.endsWith('https://fictional.wampums.app/tasks')).toBe(true);
    expect(await deliveries()).toEqual([{ kind: 'assigned', status: 'sent' }]);
  });

  test('nobody is emailed about a task they assigned to themselves', async () => {
    await assign(10, { assignee_id: manager });
    await tick(pool, NOW);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await deliveries()).toEqual([{ kind: 'assigned', status: 'skipped' }]);
  });

  test('a task reassigned before its notice left tells only the new assignee', async () => {
    const task = await assign(10);
    await saveTask(pool, organizationId, manager, { ...task, due_date: await day(10), assignee_id: colleague }, task.id);
    await tick(pool, NOW);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toBe(await emailTo(colleague));
  });

  test('editing a task without changing who does it sends no second notice', async () => {
    const task = await assign(10);
    await tick(pool, NOW);
    await saveTask(pool, organizationId, manager, { ...task, title: 'Bring the big tents', due_date: await day(12) }, task.id);
    await tick(pool, NOW);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('tasks due today and in two days are reminded together in one email, once', async () => {
    await assign(0, { title: 'Buy bread' }); await assign(2, { title: 'Print maps' }); await assign(5, { title: 'Later task' });
    await assignedEarlier();
    await Promise.all([tick(pool, NOW), tick(pool, NOW)]); await tick(pool, NOW);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [, subject, text] = sendEmail.mock.calls[0];
    expect(subject).toBe('Reminder');
    expect(text).toContain('Due today:\n- Buy bread');
    expect(text).toContain('Due soon:\n- Print maps');
    expect(text).not.toContain('Later task');
    expect((await deliveries()).filter((row) => row.kind !== 'assigned')).toEqual(
      expect.arrayContaining([{ kind: 'due_today', status: 'sent' }, { kind: 'due_soon', status: 'sent' }]));
  });

  test('due reminders wait for the morning', async () => {
    await assign(0); await assignedEarlier();
    await tick(pool, { sendHour: 24 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('a task assigned today for today is announced once, not announced and then reminded', async () => {
    await assign(0);
    await tick(pool, NOW); await tick(pool, NOW);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][1]).toBe('Assigned');
  });

  test('a reminder is written in the assignee\'s language, falling back to English for a missing text', async () => {
    await pool.query("UPDATE users SET language_preference = 'fr' WHERE id = $1", [assignee]);
    await assign(0); await assignedEarlier();
    await tick(pool, NOW);
    const [, subject, text] = sendEmail.mock.calls[0];
    expect(subject).toBe('Rappel');
    expect(text).toContain('Aujourd’hui :');
    expect(text).toContain('Open your tasks:');
  });

  test('moving the due date to today reminds again for the new date', async () => {
    const task = await assign(0); await assignedEarlier();
    await tick(pool, NOW);
    await saveTask(pool, organizationId, manager, { ...task, due_date: await day(2) }, task.id);
    await tick(pool, NOW); await tick(pool, NOW);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  test.each(['done', 'inactive', 'no_permission', 'cancelled', 'unit_off', 'material_reminder'])('a %s task is not reminded', async (reason) => {
    const task = await assign(0); await assignedEarlier();
    if (reason === 'done') {await pool.query("UPDATE activity_tasks SET status = 'done' WHERE id = $1", [task.id]);}
    if (reason === 'inactive') {await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE organization_id = $1 AND user_id = $2", [organizationId, assignee]);}
    if (reason === 'no_permission') {await pool.query("UPDATE user_organizations SET role_ids = '[]'::jsonb WHERE organization_id = $1 AND user_id = $2", [organizationId, assignee]);}
    if (reason === 'cancelled') {await pool.query('UPDATE year_plan_meetings SET is_cancelled = TRUE WHERE id = $1', [meeting]);}
    if (reason === 'unit_off') {await saveSettings(pool, organizationId, false);}
    if (reason === 'material_reminder') {
      await configure(pool, organizationId, task.id, { enabled: true, expected_revision: 0, materials: '2 tents', lead_days: 2, repeat_hours: 24 });
    }
    await tick(pool, NOW);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('a unit that turned reminders off sends no assignment notice either, even after turning them back on', async () => {
    await saveSettings(pool, organizationId, false);
    expect(await getSettings(pool, organizationId)).toEqual({ enabled: false, lead_days: 2 });
    expect((await getSettings(pool, otherUnit)).enabled).toBe(true);
    await assign(10);
    await tick(pool, NOW);
    await saveSettings(pool, organizationId, true);
    await tick(pool, NOW);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await deliveries()).toEqual([{ kind: 'assigned', status: 'skipped' }]);
  });

  test('a transport exception is recorded as uncertain and never replayed', async () => {
    await assign(0); await assignedEarlier();
    sendEmail.mockRejectedValueOnce(new Error('socket reset'));
    await tick(pool, NOW); await tick(pool, NOW);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await deliveries()).find((row) => row.kind === 'due_today').status).toBe('uncertain');
  });

  test('one unit\'s reminders never read another unit\'s tasks', async () => {
    await assign(0, { title: 'Our task' }); await assignedEarlier();
    await tick(pool, NOW);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await one('SELECT COUNT(*)::int FROM task_reminder_deliveries WHERE organization_id = $1', [otherUnit])).toBe(0);
  });
});
