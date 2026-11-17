/**
 * A unit's writes name only its own records, on a migrated PostgreSQL.
 *
 * Foreign keys only say a row exists, in any unit. Objective achievements,
 * library activities and budget categories and items are all given by id in
 * the request body; each must be checked against the authenticated unit, and
 * the reads that join them must stay inside it.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { ensureActiveScoutYear } = require('../services/scoutYear');
require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY ||= 'fictional-unit-references';
const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!DATABASE_URL)('writes name only the unit\'s own records', () => {
  let pool; let app;
  const ids = { participants: [], users: [] };
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0])[0];
  const count = (sql, params) => one(`SELECT COUNT(*)::int FROM ${sql}`, params);

  /** A unit with a district administrator, a plan, an objective, a youth, a library activity and a budget. */
  async function unit(name, youthName) {
    const db = await pool.connect();
    let id;
    try {
      await db.query('BEGIN');
      id = (await db.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [id]);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally { db.release(); }
    const admin = await one("INSERT INTO users (email, password, full_name) VALUES ('refs-' || gen_random_uuid() || '@example.test', 'x', $1) RETURNING id", [`${name} admin`]);
    ids.users.push(admin);
    await pool.query(`INSERT INTO user_organizations (organization_id, user_id, role_ids, status)
      SELECT $1, $2, jsonb_build_array(id), 'active' FROM roles WHERE role_name = 'district' AND organization_id IS NULL`, [id, admin]);
    const year = (await ensureActiveScoutYear(pool, id)).id;
    const youth = await one("INSERT INTO participants (first_name, last_name) VALUES ($1, 'Fiction') RETURNING id", [youthName]);
    ids.participants.push(youth);
    await pool.query("INSERT INTO participant_enrollments (organization_id, participant_id, scout_year_id, status) VALUES ($1, $2, $3, 'active')", [id, youth, year]);
    const plan = await one(`INSERT INTO year_plans (organization_id, title, start_date, end_date, created_by)
      VALUES ($1, 'Fictional year plan', CURRENT_DATE - 30, CURRENT_DATE + 300, $2) RETURNING id`, [id, admin]);
    const meeting = await one('INSERT INTO year_plan_meetings (organization_id, year_plan_id, meeting_date) VALUES ($1, $2, CURRENT_DATE + 7) RETURNING id', [id, plan]);
    const objective = await one('INSERT INTO year_plan_objectives (organization_id, year_plan_id, title) VALUES ($1, $2, $3) RETURNING id', [id, plan, `${name} secret objective`]);
    const library = await one("INSERT INTO activity_library (organization_id, name, category, created_by) VALUES ($1, $2, 'game', $3) RETURNING id", [id, `${name} secret game`, admin]);
    const category = await one('INSERT INTO budget_categories (organization_id, name) VALUES ($1, $2) RETURNING id', [id, `${name} secret category`]);
    const item = await one("INSERT INTO budget_items (organization_id, budget_category_id, name, item_type) VALUES ($1, $2, $3, 'expense') RETURNING id", [id, category, `${name} secret item`]);
    const activity = await one(`INSERT INTO activities (organization_id, created_by, name, activity_date, meeting_location_going,
        meeting_time_going, departure_time_going, activity_start_date, activity_start_time, activity_end_date, activity_end_time)
      VALUES ($1, $2, $3, CURRENT_DATE + 14, 'Hall', '09:00', '09:15', CURRENT_DATE + 14, '09:00', CURRENT_DATE + 14, '16:00')
      RETURNING id`, [id, admin, `${name} secret outing`]);
    const token = `Bearer ${jwt.sign({ user_id: admin, organizationId: id }, process.env.JWT_SECRET_KEY)}`;
    return { id, admin, youth, plan, meeting, objective, library, category, item, activity, token };
  }

  const call = (method, path, who) => request(app)[method](path).set('Authorization', who.token);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.mine = await unit('Fictional unit Ada', 'Grace');
    ids.theirs = await unit('Fictional unit Hedy', 'Margaret');
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, logger));
    app.use('/api', require('../routes/budgets')(pool, logger));
    app.use('/api/v1/incidents', require('../routes/incidents')(pool, logger));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) { return; }
    const units = [ids.mine?.id, ids.theirs?.id].filter(Boolean);
    for (const table of ['incident_reports', 'form_submissions', 'objective_achievements', 'activity_distribution_rules', 'year_plan_meeting_activities', 'budget_expenses',
      'budget_plans', 'budget_items', 'budget_categories', 'activity_library', 'year_plan_objectives', 'year_plan_meetings',
      'year_plans', 'activities', 'participant_enrollments', 'scout_years', 'user_organizations']) {
      // eslint-disable-next-line no-await-in-loop -- dependants first, one table at a time
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::int[])`, [units]);
    }
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [ids.participants]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [units]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids.users]);
    await pool.end();
  });

  describe('objective achievements', () => {
    test('a leader cannot grant an objective to a youth of another unit, and nothing is written', async () => {
      const { mine, theirs } = ids;
      const res = await call('post', '/api/v1/yearly-planner/achievements', mine)
        .send({ objective_id: mine.objective, participant_ids: [mine.youth, theirs.youth] });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([expect.objectContaining({ path: 'participant_ids', value: theirs.youth })]);
      expect(await count('objective_achievements WHERE organization_id = $1', [mine.id])).toBe(0);
    });

    test('nor grant another unit\'s objective, nor at another unit\'s meeting', async () => {
      const { mine, theirs } = ids;
      const objective = await call('post', '/api/v1/yearly-planner/achievements', mine)
        .send({ objective_id: theirs.objective, participant_ids: [mine.youth] });
      const meeting = await call('post', '/api/v1/yearly-planner/achievements', mine)
        .send({ objective_id: mine.objective, participant_ids: [mine.youth], meeting_id: theirs.meeting });

      expect(objective.status).toBe(404);
      expect(meeting.status).toBe(404);
      expect(await count('objective_achievements WHERE organization_id = $1', [mine.id])).toBe(0);
    });

    test('the unit\'s own youth is granted it, dated today where the unit is, once however often it is sent', async () => {
      const { mine } = ids;
      const body = { objective_id: mine.objective, participant_ids: [mine.youth, mine.youth] };
      const first = await call('post', '/api/v1/yearly-planner/achievements', mine).send(body);
      const again = await call('post', '/api/v1/yearly-planner/achievements', mine).send(body);

      expect(first.status).toBe(201);
      expect(first.body.data).toHaveLength(1);
      expect(again.body.data).toHaveLength(0);
      expect(await one('SELECT achieved_date = unit_today($1) FROM objective_achievements WHERE organization_id = $1', [mine.id])).toBe(true);
    });

    test('the list of achievements never names a youth or an objective of another unit', async () => {
      const { mine, theirs } = ids;
      // A row recorded before the check existed, pointing across units.
      await pool.query(`INSERT INTO objective_achievements (organization_id, objective_id, participant_id, achieved_date)
        VALUES ($1, $2, $3, CURRENT_DATE)`, [mine.id, theirs.objective, theirs.youth]);

      const res = await call('get', '/api/v1/yearly-planner/achievements', mine);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/Margaret|Hedy/);
    });

    test.each([
      [{ objective_id: 'abc', participant_ids: [1] }],
      [{ objective_id: 1, participant_ids: 'all' }],
      [{ objective_id: 1, participant_ids: [1], achieved_date: '2026-02-30' }],
      [{ objective_id: 1, participant_ids: [1], attribution_source: 'imported' }],
    ])('a malformed grant is a 400, not a 500 (%j)', async (body) => {
      expect((await call('post', '/api/v1/yearly-planner/achievements', ids.mine).send(body)).status).toBe(400);
    });
  });

  describe('library activities', () => {
    test('an activity of another unit\'s library cannot be placed in a meeting, one date or many, nor in a rule', async () => {
      const { mine, theirs } = ids;
      const single = await call('post', `/api/v1/yearly-planner/meetings/${mine.meeting}/activities`, mine)
        .send({ name: 'Jeu', activity_library_id: theirs.library });
      const batch = await call('post', `/api/v1/yearly-planner/plans/${mine.plan}/meetings/batch-activity`, mine)
        .send({ meeting_ids: [mine.meeting], activity: { name: 'Jeu', activity_library_id: theirs.library } });
      const rule = await call('post', `/api/v1/yearly-planner/plans/${mine.plan}/distribution-rules`, mine)
        .send({ activity_name: 'Jeu', activity_library_id: theirs.library, distribution_scope: 'year', placement_rule: 'manual' });

      expect([single.status, batch.status, rule.status]).toEqual([400, 400, 400]);
      expect(await count('year_plan_meeting_activities WHERE organization_id = $1', [mine.id])).toBe(0);
      expect(await count('activity_distribution_rules WHERE organization_id = $1', [mine.id])).toBe(0);
    });

    test('the unit\'s own library activity is placed, with its name', async () => {
      const { mine } = ids;
      const res = await call('post', `/api/v1/yearly-planner/meetings/${mine.meeting}/activities`, mine)
        .send({ name: 'Jeu', activity_library_id: mine.library });
      const meeting = await call('get', `/api/v1/yearly-planner/meetings/${mine.meeting}`, mine);

      expect(res.status).toBe(201);
      expect(meeting.body.data.activities[0].library_name).toBe('Fictional unit Ada secret game');
    });
  });

  describe('budget categories and items', () => {
    test('an expense cannot be filed under another unit\'s category or item, alone or in a batch', async () => {
      const { mine, theirs } = ids;
      const expense = { amount: 12.5, expense_date: '2026-11-01', description: 'Fictional rope' };
      const category = await call('post', '/api/v1/budget/expenses', mine).send({ ...expense, budget_category_id: theirs.category });
      const item = await call('post', '/api/v1/budget/expenses', mine).send({ ...expense, budget_item_id: theirs.item });
      const batch = await call('post', '/api/v1/expenses/bulk', mine)
        .send({ expenses: [{ ...expense, budget_category_id: mine.category }, { ...expense, budget_category_id: theirs.category }] });

      expect(category.status).toBe(400);
      expect(category.body.errors).toEqual([expect.objectContaining({ path: 'budget_category_id', msg: 'budget_category_not_found' })]);
      expect(item.body.errors).toEqual([expect.objectContaining({ path: 'budget_item_id', msg: 'budget_item_not_found' })]);
      expect(batch.status).toBe(400);
      expect(batch.body.errors).toEqual([expect.objectContaining({ path: 'expenses[1].budget_category_id' })]);
      expect(await count('budget_expenses WHERE organization_id = $1', [mine.id])).toBe(0);
    });

    test('an expense cannot be moved to another unit\'s category, nor an item or a plan created under one', async () => {
      const { mine, theirs } = ids;
      const created = await call('post', '/api/v1/budget/expenses', mine)
        .send({ amount: 3, expense_date: '2026-11-02', description: 'Fictional tape', budget_category_id: mine.category, budget_item_id: mine.item });
      const moved = await call('put', `/api/v1/budget/expenses/${created.body.data.id}`, mine).send({ budget_category_id: theirs.category });
      const newItem = await call('post', '/api/v1/budget/items', mine).send({ name: 'Fictional stakes', budget_category_id: theirs.category });
      const plan = await call('post', '/api/v1/budget/plans', mine)
        .send({ budget_item_id: theirs.item, fiscal_year_start: '2026-09-01', fiscal_year_end: '2027-08-31' });

      expect(created.status).toBe(201);
      expect([moved.status, newItem.status, plan.status]).toEqual([400, 400, 400]);
      expect(await one('SELECT budget_category_id FROM budget_expenses WHERE id = $1', [created.body.data.id])).toBe(mine.category);
    });

    test('an item must sit in the category named with it', async () => {
      const { mine } = ids;
      const other = await one("INSERT INTO budget_categories (organization_id, name) VALUES ($1, 'Fictional other category') RETURNING id", [mine.id]);
      const res = await call('post', '/api/v1/budget/expenses', mine)
        .send({ amount: 3, expense_date: '2026-11-02', description: 'Fictional tarp', budget_category_id: other, budget_item_id: mine.item });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([expect.objectContaining({ path: 'budget_item_id', msg: 'budget_item_not_in_category' })]);
    });

    test('an item created without a type, as the budget screen does, is saved and holds both', async () => {
      const { mine } = ids;
      const created = await call('post', '/api/v1/budget/items', mine).send({ name: 'Fictional tents', budget_category_id: mine.category });
      const refused = await call('post', '/api/v1/budget/items', mine).send({ name: 'Fictional pegs', budget_category_id: mine.category, item_type: 'other' });
      const changed = await call('put', `/api/v1/budget/items/${created.body.data.id}`, mine).send({ item_type: 'revenue' });
      const wrong = await call('put', `/api/v1/budget/items/${created.body.data.id}`, mine).send({ item_type: 'gift' });

      expect(created.status).toBe(201);
      expect(created.body.data.item_type).toBe('both');
      expect(refused.status).toBe(400);
      expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'item_type', msg: 'budget_item_type_invalid' })]);
      expect(changed.body.data.item_type).toBe('revenue');
      expect(wrong.status).toBe(400);
      expect(await one("SELECT column_default FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'item_type'"))
        .toMatch(/'both'/);
    });

    test('the expense list never names another unit\'s category or item', async () => {
      const { mine, theirs } = ids;
      // A row recorded before the check existed, pointing across units.
      await pool.query(`INSERT INTO budget_expenses (organization_id, budget_category_id, budget_item_id, amount, expense_date, description)
        VALUES ($1, $2, $3, 1, CURRENT_DATE, 'Fictional old expense')`, [mine.id, theirs.category, theirs.item]);

      const res = await call('get', '/api/v1/budget/expenses', mine);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('Hedy');
    });
  });

  describe('incident reports', () => {
    test('a report cannot name a youth, an adult or an outing of another unit, and nothing is written', async () => {
      const { mine, theirs } = ids;
      const youth = await call('post', '/api/v1/incidents', mine).send({ victim_type: 'participant', victim_participant_id: theirs.youth });
      const adult = await call('post', '/api/v1/incidents', mine).send({ victim_type: 'leader', victim_user_id: theirs.admin });
      const outing = await call('post', '/api/v1/incidents', mine).send({ victim_type: 'other', victim_name: 'Fictional visitor', activity_id: theirs.activity });

      expect([youth.status, adult.status, outing.status]).toEqual([400, 400, 400]);
      expect(youth.body.errors).toEqual([expect.objectContaining({ path: 'victim_participant_id' })]);
      expect(adult.body.errors).toEqual([expect.objectContaining({ path: 'victim_user_id' })]);
      expect(outing.body.errors).toEqual([expect.objectContaining({ path: 'activity_id' })]);
      expect(await count('incident_reports WHERE organization_id = $1', [mine.id])).toBe(0);
      expect(await count('form_submissions WHERE organization_id = $1 AND form_type = $2', [mine.id, 'incident_report'])).toBe(0);
    });

    test('a draft cannot be changed to name another unit\'s youth', async () => {
      const { mine, theirs } = ids;
      const draft = await call('post', '/api/v1/incidents', mine)
        .send({ victim_type: 'participant', victim_participant_id: mine.youth, activity_id: mine.activity });
      const moved = await call('patch', `/api/v1/incidents/${draft.body.data.id}`, mine)
        .send({ victim_type: 'participant', victim_participant_id: theirs.youth });

      expect(draft.status).toBe(201);
      expect(moved.status).toBe(400);
      expect(await one('SELECT victim_participant_id FROM incident_reports WHERE id = $1', [draft.body.data.id])).toBe(mine.youth);
    });

    test('a report recorded before the check never shows another unit\'s names', async () => {
      const { mine, theirs } = ids;
      const id = await one(`INSERT INTO incident_reports (organization_id, status, victim_type, victim_participant_id, victim_user_id, activity_id, created_by)
        VALUES ($1, 'draft', 'participant', $2, $3, $4, $5) RETURNING id`, [mine.id, theirs.youth, theirs.admin, theirs.activity, mine.admin]);

      const detail = await call('get', `/api/v1/incidents/${id}`, mine);
      const list = await call('get', '/api/v1/incidents', mine);

      expect(detail.status).toBe(200);
      expect(JSON.stringify([detail.body, list.body])).not.toMatch(/Margaret|Hedy/);
    });
  });
});
