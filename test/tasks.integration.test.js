/** Task access uses real membership and permission checks on a disposable database. */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('./jest-conditional-helpers');
const { saveTask, changeTaskStatus } = require('../services/activityTasks');
const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY = 'tasks-integration-secret';

describe.skipIf(!DATABASE_URL)('Shared activity tasks', () => {
  let pool;
  let app;
  const units = [];
  const users = [];
  let manager;
  let assignee;
  let colleague;
  let outsider;
  let activity;
  let foreignActivity;
  let meeting;
  let viewRole;
  let taskId;

  async function one(sql, params = []) {
    return Object.values((await pool.query(sql, params)).rows[0])[0];
  }
  async function unit() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const id = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional Task Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT');
      units.push(id);
      return id;
    } catch (err) {
      await db.query('ROLLBACK'); throw err;
    } finally {db.release();}
  }
  async function member(organizationId, roleId) {
    const id = await one("INSERT INTO users (email, password, full_name) VALUES ('task-' || gen_random_uuid() || '@example.test', 'x', 'Ada Example') RETURNING id");
    users.push(id);
    await pool.query('INSERT INTO user_organizations (organization_id, user_id, role_ids) VALUES ($1, $2, $3)', [organizationId, id, JSON.stringify([roleId])]);
    return id;
  }
  async function role(organizationId, keys) {
    const id = await one("INSERT INTO roles (role_name, display_name, data_scope, organization_id) VALUES ('task_' || gen_random_uuid(), 'Task helper', 'linked', $1) RETURNING id", [organizationId]);
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])', [id, keys]);
    return id;
  }
  function outing(organizationId) {
    return one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
      meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, 'Fictional camp', '2026-11-14', 'Local', '09:00', '09:00', '2026-11-14', '09:00', '2026-11-14', '16:00') RETURNING id`, [organizationId, manager]);
  }
  function as(userId, organizationId = units[0]) {
    return { Authorization: `Bearer ${jwt.sign({ user_id: userId, organizationId }, process.env.JWT_SECRET_KEY)}` };
  }
  function assignment(overrides = {}) {
    return { title: 'Pack tents', assignee_id: assignee, due_date: '2026-11-13', activity_id: activity, meeting_id: null, ...overrides };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const first = await unit(); const second = await unit();
    const manageRole = await role(first, ['tasks.view', 'tasks.manage']);
    viewRole = await role(first, ['tasks.view']);
    const otherRole = await role(second, ['tasks.view', 'tasks.manage']);
    manager = await member(first, manageRole);
    assignee = await member(first, viewRole);
    colleague = await member(first, viewRole);
    outsider = await member(second, otherRole);
    activity = await outing(first); foreignActivity = await outing(second);
    meeting = await one("INSERT INTO year_plan_meetings (organization_id, meeting_date, theme) VALUES ($1, '2026-11-15', 'Fictional meeting') RETURNING id", [first]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/tasks', require('../routes/tasks')(pool));
    app.use('/api/v1/participants', require('../routes/participants')(pool));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });
  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
      await pool.end();
    }
  });

  test('a manager creates an assignment with an initial status and actor in history', async () => {
    const res = await request(app).post('/api/v1/tasks').set(as(manager)).send(assignment());
    expect(res.status).toBe(201); taskId = res.body.data.id;
    const history = await pool.query('SELECT * FROM activity_task_history WHERE task_id = $1', [taskId]);
    expect(history.rows).toEqual([expect.objectContaining({ status: 'todo', previous_status: null, changed_by: manager })]);
  });
  test('an assignee can read and update their tasks without youth access', async () => {
    const list = await request(app).get('/api/v1/tasks/mine').set(as(assignee));
    expect(list.status).toBe(200); expect(list.body.data.map((task) => task.id)).toContain(taskId);
    expect(list.body.data[0].due_date).toBe('2026-11-13');
    expect((await request(app).get('/api/v1/participants').set(as(assignee))).status).toBe(403);
    const saved = await request(app).patch(`/api/v1/tasks/mine/${taskId}/status`).set(as(assignee)).send({ status: 'in_progress', expected_status: 'todo' });
    expect(saved.status).toBe(200);
    const history = await pool.query('SELECT status, changed_by FROM activity_task_history WHERE task_id = $1 ORDER BY id', [taskId]);
    expect(history.rows.at(-1)).toEqual({ status: 'in_progress', changed_by: assignee });
  });
  test('other assignees cannot see or change the assignment by guessing its id', async () => {
    const list = await request(app).get('/api/v1/tasks/mine').set(as(colleague));
    expect(list.body.data).toEqual([]);
    expect((await request(app).patch(`/api/v1/tasks/mine/${taskId}/status`).set(as(colleague)).send({ status: 'done', expected_status: 'in_progress' })).status).toBe(404);
    expect((await request(app).get('/api/v1/tasks').set(as(colleague))).status).toBe(403);
    expect((await request(app).get('/api/v1/tasks/options').set(as(colleague))).status).toBe(403);
  });
  test('another unit cannot list, edit or change the task', async () => {
    expect((await request(app).get('/api/v1/tasks').set(as(outsider, units[1]))).body.data).toEqual([]);
    expect((await request(app).put(`/api/v1/tasks/${taskId}`).set(as(outsider, units[1])).send(assignment())).status).toBe(404);
    expect((await request(app).patch(`/api/v1/tasks/${taskId}/status`).set(as(outsider, units[1])).send({ status: 'done', expected_status: 'in_progress' })).status).toBe(404);
  });
  test('only active members of the task unit may be assigned', async () => {
    expect((await request(app).post('/api/v1/tasks').set(as(manager)).send(assignment({ assignee_id: outsider }))).status).toBe(400);
    await pool.query("UPDATE user_organizations SET status = 'inactive' WHERE user_id = $1 AND organization_id = $2", [colleague, units[0]]);
    expect((await request(app).post('/api/v1/tasks').set(as(manager)).send(assignment({ assignee_id: colleague }))).status).toBe(400);
    await pool.query("UPDATE user_organizations SET status = 'active' WHERE user_id = $1 AND organization_id = $2", [colleague, units[0]]);
  });
  test('assignment choices contain only this unit’s active members and minimal event information', async () => {
    const res = await request(app).get('/api/v1/tasks/options').set(as(manager));
    expect(res.status).toBe(200);
    expect(res.body.data.members.map((member) => member.id)).toContain(assignee);
    expect(res.body.data.members.map((member) => member.id)).not.toContain(outsider);
    expect(Object.keys(res.body.data.members[0]).sort()).toEqual(['full_name', 'id']);
    expect(res.body.data.activities.map((event) => event.id)).toContain(activity);
    expect(res.body.data.activities.map((event) => event.id)).not.toContain(foreignActivity);
    expect(res.body.data.meetings.map((event) => event.id)).toContain(meeting);
  });
  test('an assignment cannot reference another unit’s event', async () => {
    expect((await request(app).post('/api/v1/tasks').set(as(manager)).send(assignment({ activity_id: foreignActivity }))).status).toBe(404);
  });
  test('planned meetings support the same assignments and can be reassigned', async () => {
    const saved = await saveTask(pool, units[0], manager, assignment({ activity_id: null, meeting_id: meeting }));
    expect(saved.meeting_id).toBe(meeting);
    await saveTask(pool, units[0], manager, assignment({ activity_id: null, meeting_id: meeting, assignee_id: colleague }), saved.id);
    expect((await request(app).get('/api/v1/tasks/mine').set(as(assignee))).body.data.map((task) => task.id)).not.toContain(saved.id);
    expect((await request(app).get('/api/v1/tasks/mine').set(as(colleague))).body.data.map((task) => task.id)).toContain(saved.id);
  });
  test('concurrent status changes keep one transition and refuse the stale edit', async () => {
    const task = await saveTask(pool, units[0], manager, assignment());
    const context = { organizationId: units[0], actorId: assignee, ownOnly: true };
    const results = await Promise.allSettled([
      changeTaskStatus(pool, context, task.id, 'in_progress', 'todo'),
      changeTaskStatus(pool, context, task.id, 'done', 'todo'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.status).toBe(409);
    expect(await one('SELECT COUNT(*)::int FROM activity_task_history WHERE task_id = $1', [task.id])).toBe(2);
  });
  test('revoking task rights closes the personal task list immediately', async () => {
    await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [viewRole]);
    expect((await request(app).get('/api/v1/tasks/mine').set(as(assignee))).status).toBe(403);
  });
});
