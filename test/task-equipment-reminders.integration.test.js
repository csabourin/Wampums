/** Durable mail claims, task ownership and confirmation on migrated PostgreSQL. */
const { Pool } = require('pg');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET_KEY = 'equipment-reminder-integration';
jest.mock('../utils/index', () => ({ sendEmail: jest.fn(), getTranslationsByCode: () => ({ equipment_reminder_email_subject: 'Material', equipment_reminder_email_intro: 'Bring', equipment_reminder_email_confirm: 'Confirm' }) }));
jest.mock('../services/emailSender', () => ({ ...jest.requireActual('../services/emailSender'), resolveOrganizationEmailSender: jest.fn(() => ({ name: 'Fictional unit', email: 'unit@example.test' })) }));
jest.mock('../utils/public-url', () => ({ resolveOrganizationBaseUrl: jest.fn(() => 'https://fictional.wampums.app') }));
const { sendEmail } = require('../utils/index');
const { saveTask, listTasks } = require('../services/activityTasks');
const { configure, confirm, tick } = require('../services/taskEquipmentReminders');
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Equipment reminders', () => {
  let pool; let organizationId; let otherUnit; let manager; let assignee; let colleague; let role; let meeting; let task; let app;
  const users = [];
  const one = async (sql, values = []) => Object.values((await pool.query(sql, values)).rows[0])[0];
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional reminder unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT'); return id;
    } finally {db.release();}
  }
  async function member() {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES ('reminder-' || gen_random_uuid() || '@example.test', 'x', 'Ada Example') RETURNING id");
    users.push(id);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids, status) VALUES ($1, $2, $3, $4)', [organizationId, id, JSON.stringify([role]), 'active']);
    return id;
  }
  const settings = (overrides = {}) => ({ enabled: true, expected_revision: 0, materials: '2 tents\n1 stove', lead_days: 2, repeat_hours: 24, ...overrides });
  const auth = (id, unitId = organizationId) => ({ Authorization: `Bearer ${jwt.sign({ user_id: id, organizationId: unitId }, process.env.JWT_SECRET_KEY)}` });
  const reminder = async () => (await pool.query('SELECT * FROM task_equipment_reminders WHERE task_id = $1', [task.id])).rows[0];
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL }); organizationId = await unit(); otherUnit = await unit();
    role = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('reminder_' || gen_random_uuid(), 'Task team', 'organization', $1) RETURNING id", [organizationId]);
    await pool.query("INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key IN ('tasks.view', 'tasks.manage')", [role]);
    manager = await member(); assignee = await member(); colleague = await member();
    meeting = await one("INSERT INTO year_plan_meetings (organization_id, meeting_date, theme) VALUES ($1, CURRENT_DATE + 1, 'Fictional meeting') RETURNING id", [organizationId]);
    app = express(); app.locals.pool = pool; app.use(express.json()); app.use('/api/v1/tasks', require('../routes/tasks')(pool));
  });
  beforeEach(async () => {
    jest.clearAllMocks(); sendEmail.mockResolvedValue(true);
    await pool.query('DELETE FROM activity_tasks WHERE organization_id = $1', [organizationId]);
    await pool.query("UPDATE user_organizations SET status = 'active' WHERE organization_id = $1", [organizationId]);
    await pool.query('UPDATE year_plan_meetings SET is_cancelled = FALSE WHERE id = $1', [meeting]);
    const due = await one('SELECT (CURRENT_DATE + 1)::text');
    task = await saveTask(pool, organizationId, manager, { title: 'Bring tents', meeting_id: meeting, due_date: due, assignee_id: assignee });
  });
  afterAll(async () => {
    if (!pool) {return;}
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [[organizationId, otherUnit]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]); await pool.end();
  });
  test('a manager configures a reminder through the API and a personal list explains its current state', async () => {
    const res = await request(app).put(`/api/v1/tasks/${task.id}/equipment-reminder`).set(auth(manager)).send(settings());
    expect(res.status).toBe(200);
    expect((await listTasks(pool, organizationId, assignee))[0]).toMatchObject({ assignee_active: true, assignee_can_confirm: true, equipment_reminder: { materials: '2 tents\n1 stove', delivery_status: 'pending' } });
  });
  test('concurrent polling sends one email and a second poll respects the repeat interval', async () => {
    await configure(pool, organizationId, task.id, settings());
    await Promise.all([tick(pool), tick(pool)]); await tick(pool);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await reminder()).delivery_status).toBe('sent');
    expect(sendEmail.mock.calls[0][2]).toContain('/tasks?task_id=');
    expect(sendEmail.mock.calls[0][2]).toContain('2 tents\n1 stove');
    await pool.query("UPDATE task_equipment_reminders SET last_attempt_at = NOW() - INTERVAL '25 hours' WHERE task_id = $1", [task.id]);
    await tick(pool); expect(sendEmail).toHaveBeenCalledTimes(2);
  });
  test('confirmation stops reminders without completing the task and another assignee cannot confirm', async () => {
    const saved = await configure(pool, organizationId, task.id, settings());
    await expect(confirm(pool, organizationId, task.id, colleague, saved.revision)).rejects.toMatchObject({ status: 404 });
    await expect(confirm(pool, otherUnit, task.id, assignee, saved.revision)).rejects.toMatchObject({ status: 404 });
    await confirm(pool, organizationId, task.id, assignee, saved.revision); await tick(pool);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await one('SELECT status FROM activity_tasks WHERE id = $1', [task.id])).toBe('todo');
  });
  test('reassignment invalidates the previous confirmation and stale confirmation cannot suppress the new request', async () => {
    const saved = await configure(pool, organizationId, task.id, settings());
    await confirm(pool, organizationId, task.id, assignee, saved.revision);
    await saveTask(pool, organizationId, manager, { ...task, assignee_id: colleague }, task.id);
    expect((await reminder()).confirmed_at).toBeNull();
    await expect(confirm(pool, organizationId, task.id, colleague, saved.revision)).rejects.toMatchObject({ status: 409 });
    await tick(pool); expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  test.each(['inactive', 'no_permission', 'cancelled', 'done'])('a %s assignment receives no mail', async (reason) => {
    await configure(pool, organizationId, task.id, settings());
    if (reason === 'inactive') {await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE organization_id = $1 AND user_id = $2", [organizationId, assignee]);}
    if (reason === 'no_permission') {await pool.query("UPDATE user_organizations SET role_ids = '[]'::jsonb WHERE organization_id = $1 AND user_id = $2", [organizationId, assignee]);}
    if (reason === 'cancelled') {await pool.query('UPDATE year_plan_meetings SET is_cancelled = TRUE WHERE id = $1', [meeting]);}
    if (reason === 'done') {await pool.query("UPDATE activity_tasks SET status = 'done' WHERE id = $1", [task.id]);}
    await tick(pool); expect(sendEmail).not.toHaveBeenCalled();
    await pool.query('UPDATE user_organizations SET role_ids = $3 WHERE organization_id = $1 AND user_id = $2', [organizationId, assignee, JSON.stringify([role])]);
  });
  test('editing a task returns the reminder revision its change renewed, so the same form can update the reminder', async () => {
    const first = await configure(pool, organizationId, task.id, settings());
    const edited = await saveTask(pool, organizationId, manager, { ...task, title: 'Bring the big tents' }, task.id);
    expect(edited.equipment_reminder_revision).not.toBe(first.revision);
    await expect(configure(pool, organizationId, task.id, settings({ expected_revision: first.revision }))).rejects.toMatchObject({ status: 409 });
    const next = await configure(pool, organizationId, task.id, settings({ expected_revision: edited.equipment_reminder_revision }));
    expect(next.revision).not.toBe(edited.equipment_reminder_revision);
  });
  test('a manager whose form holds an older reminder revision cannot overwrite another manager\'s change', async () => {
    const loaded = await configure(pool, organizationId, task.id, settings());
    await configure(pool, organizationId, task.id, settings({ expected_revision: loaded.revision, materials: 'Changed by a colleague' }));
    await expect(saveTask(pool, organizationId, manager, { ...task, title: 'Bring tents' }, task.id, { expectedReminderRevision: loaded.revision }))
      .rejects.toMatchObject({ status: 409, message: 'equipment_reminder_stale' });
    expect((await reminder()).materials).toBe('Changed by a colleague');
  });
  test('a transport exception is visible as uncertain and never automatically replayed', async () => {
    await configure(pool, organizationId, task.id, settings()); sendEmail.mockRejectedValueOnce(new Error('socket reset'));
    await tick(pool); expect((await reminder()).delivery_status).toBe('uncertain');
    await pool.query("UPDATE task_equipment_reminders SET last_attempt_at = NOW() - INTERVAL '25 hours' WHERE task_id = $1", [task.id]);
    await tick(pool); expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  test('a durable sending claim left by a crashed process is never replayed', async () => {
    await configure(pool, organizationId, task.id, settings());
    await pool.query("UPDATE task_equipment_reminders SET delivery_status = 'sending' WHERE task_id = $1", [task.id]);
    await tick(pool); expect(sendEmail).not.toHaveBeenCalled();
  });
  test('a replaced reminder cannot be confirmed with an old revision even after disabling it', async () => {
    const first = await configure(pool, organizationId, task.id, settings());
    await configure(pool, organizationId, task.id, settings({ enabled: false, expected_revision: first.revision }));
    const next = await configure(pool, organizationId, task.id, settings()); expect(next.revision).not.toBe(first.revision);
    await expect(confirm(pool, organizationId, task.id, assignee, first.revision)).rejects.toMatchObject({ status: 409 });
  });
});
