const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { authorizationContextRow } = require('./mock-helpers');

process.env.JWT_SECRET_KEY = 'tasks-route-secret';
const USER = '00000000-0000-4000-8000-000000000001';
const TASK = { id: 3, title: 'Pack tents', status: 'todo', assignee_id: USER };
let permissions;
let demo;
let found;
let active;
let failHistory;
const db = {
  query: jest.fn((sql) => {
    if (sql.includes('AS authorization_permissions')) {
      return authorizationContextRow({ permissions, roles: [{ role_name: demo ? 'demoadmin' : 'custom_tasks', display_name: 'Tasks', data_scope: 'linked' }] });
    }
    if (sql.includes('SELECT organization_id FROM user_organizations')) {return { rows: [{ organization_id: 7 }] };}
    if (sql.includes('SELECT user_id FROM user_organizations')) {return { rows: active ? [{ user_id: USER }] : [] };}
    if (sql.includes('SELECT id FROM activities')) {return { rows: found ? [{ id: 4 }] : [] };}
    if (sql.includes('SELECT * FROM activity_tasks')) {return { rows: found ? [TASK] : [] };}
    if (sql.includes('INSERT INTO activity_task_history') && failHistory) {throw new Error('database detail');}
    if (sql.includes('RETURNING *')) {return { rows: [{ ...TASK, status: 'done' }] };}
    return { rows: [] };
  }),
  release: jest.fn(),
};
const pool = { query: db.query, connect: jest.fn(() => Promise.resolve(db)) };
const app = express();
app.locals.pool = pool;
app.use(express.json());
app.use('/api/v1/tasks', require('../routes/tasks')(pool));
app.use((err, req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
const token = () => jwt.sign({ user_id: USER, organizationId: 7 }, process.env.JWT_SECRET_KEY);
const payload = { title: 'Pack tents', assignee_id: USER, due_date: '2026-11-14', activity_id: 4, meeting_id: null };
const status = { status: 'done', expected_status: 'todo' };

beforeEach(() => {
  permissions = ['tasks.view', 'tasks.manage']; demo = false; found = true; active = true; failHistory = false;
  jest.clearAllMocks();
});

test.each([['get', '/mine'], ['get', '/'], ['get', '/options'], ['post', '/'], ['put', '/3'], ['patch', '/mine/3/status'], ['patch', '/3/status']])('%s %s requires authentication', async (method, path) => {
  expect((await request(app)[method](`/api/v1/tasks${path}`).send(payload)).status).toBe(401);
});

test('task management refuses a member with only personal task rights', async () => {
  permissions = ['tasks.view'];
  const res = await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token()}`).send(payload);
  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ required: ['tasks.manage'], missing: ['tasks.manage'] });
});

test('a personal task list always filters by the authenticated member and unit', async () => {
  await request(app).get('/api/v1/tasks/mine?assignee_id=someone&organization_id=99').set('Authorization', `Bearer ${token()}`);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('t.assignee_id = $2'), [7, USER]);
});

test.each([['post', '/', payload], ['put', '/3', payload], ['patch', '/mine/3/status', status], ['patch', '/3/status', status]])('demo members cannot %s %s', async (method, path, data) => {
  demo = true;
  const res = await request(app)[method](`/api/v1/tasks${path}`).set('Authorization', `Bearer ${token()}`).send(data);
  expect(res.status).toBe(403);
  expect(res.body.isDemo).toBe(true);
});

test.each([
  { ...payload, title: '' }, { ...payload, title: [] }, { ...payload, title: 'x'.repeat(256) },
  { ...payload, assignee_id: '12abc' }, { ...payload, assignee_id: [USER] }, { ...payload, activity_id: [4] }, { ...payload, activity_id: '12abc' },
  { ...payload, activity_id: 3000000000 }, { ...payload, activity_id: null },
  { ...payload, meeting_id: 4 }, { ...payload, due_date: '2026-02-30' },
  { ...payload, due_date: 'tomorrow' },
])('invalid assignments are refused before opening a transaction', async (data) => {
  const res = await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token()}`).send(data);
  expect(res.status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
});

test('inactive assignees are refused and the transaction is rolled back', async () => {
  active = false;
  const res = await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token()}`).send(payload);
  expect(res.status).toBe(400);
  expect(res.body.message).toBe('tasks_assignee_inactive');
  expect(res.body.errors).toEqual([{ path: 'assignee_id', location: 'body', msg: 'tasks_assignee_inactive' }]);
  expect(db.query).toHaveBeenCalledWith('ROLLBACK');
  expect(db.release).toHaveBeenCalled();
});

test('an event outside the unit is reported as missing', async () => {
  found = false;
  const res = await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token()}`).send(payload);
  expect(res.status).toBe(404);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM activities WHERE organization_id = $1'), [7, 4]);
});

test('creating a task records its initial status in the same transaction', async () => {
  const res = await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token()}`).send(payload);
  expect(res.status).toBe(201);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO activity_task_history'), [7, 3, null, 'done', USER]);
  expect(db.query).toHaveBeenLastCalledWith('COMMIT');
});

test('assignees cannot update a task outside their assignments', async () => {
  found = false;
  const res = await request(app).patch('/api/v1/tasks/mine/3/status').set('Authorization', `Bearer ${token()}`).send(status);
  expect(res.status).toBe(404);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('assignee_id = $3'), [7, 3, USER]);
});

test('a stale status change is refused without writing history', async () => {
  const res = await request(app).patch('/api/v1/tasks/mine/3/status').set('Authorization', `Bearer ${token()}`).send({ ...status, expected_status: 'in_progress' });
  expect(res.status).toBe(409);
  expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO activity_task_history'))).toBe(false);
});

test('history failures roll back the status change and release the connection', async () => {
  failHistory = true;
  const res = await request(app).patch('/api/v1/tasks/mine/3/status').set('Authorization', `Bearer ${token()}`).send(status);
  expect(res.status).toBe(500);
  expect(res.body.message).toBe('internal_server_error');
  expect(db.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(db.release).toHaveBeenCalled();
});

test.each(['12abc', '3000000000'])('malformed task id %s is refused before querying a task', async (id) => {
  const res = await request(app).patch(`/api/v1/tasks/mine/${id}/status`).set('Authorization', `Bearer ${token()}`).send(status);
  expect(res.status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
});


test.each([{ status: ['done'], expected_status: 'todo' }, { status: 'done', expected_status: ['todo'] }, { status: 'unknown', expected_status: 'todo' }])('invalid status changes never reach a transaction', async (data) => {
  const res = await request(app).patch('/api/v1/tasks/mine/3/status').set('Authorization', `Bearer ${token()}`).send(data);
  expect(res.status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
});
