/**
 * Starter activities in a unit's library — integration suite
 *
 * The reviewed catalogue (config/activity_library_starter.json) reaches a
 * unit's activity_library through services/activityLibraryStarter.js, from
 * the yearly planner, unit creation and demo seeding alike. A unit never sees
 * the same starter activity twice, its own edits stay its own, and another
 * unit is never touched.
 *
 * Skipped unless TEST_DATABASE_URL points at a disposable database built from
 * the schema baseline, the permission catalog and every migration.
 *
 * @module test/activity-library-starter.integration
 */

const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'starter-activities-integration-secret';

const mockContext = { userId: null, organizationId: null };

// Only authentication is faked; membership, permissions and demo status come from the database.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req, _res, next) => {
      req.user = { id: mockContext.userId, organizationId: mockContext.organizationId };
      next();
    },
  };
});

const catalogue = require('../config/activity_library_starter.json');
const {
  StarterSelectionError,
  describeStarterCatalogue,
  importStarterActivities,
  installDefaultStarterActivities,
  selectDefaultStarterKeys,
} = require('../services/activityLibraryStarter');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const entry = (key) => catalogue.activities.find((activity) => activity.key === key);
const CONCURRENT_IMPORTS = 6;

describe.skipIf(!DATABASE_URL)('Starter activities in a unit\'s library', () => {
  let pool;
  let app;
  const suffix = Date.now();
  const ids = {};

  /**
   * @param {string} sql - Query returning one row and one column
   * @param {Array} params - Parameters
   * @returns {Promise<*>} The value
   */
  async function one(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  }

  /**
   * A unit with its program section, created as the code requires (one transaction).
   *
   * @param {string} name - Unit name
   * @param {Object} [options]
   * @param {string} [options.section='general'] - Program section
   * @param {string} [options.language='fr'] - default_language
   * @returns {Promise<number>} Unit ID
   */
  async function unit(name, { section = 'general', language = 'fr' } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const unitId = (await client.query(
        'INSERT INTO organizations (name, program_section, default_language) VALUES ($1, $2, $3) RETURNING id',
        [`${name} ${suffix}`, section, language]
      )).rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, $2, $2)`,
        [unitId, section]
      );
      await client.query('COMMIT');
      return unitId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * A role with the given permissions.
   *
   * @param {string} name - Role name prefix
   * @param {string[]} permissionKeys - Permissions
   * @returns {Promise<number>} Role ID
   */
  async function role(name, permissionKeys) {
    const roleId = await one(
      "INSERT INTO roles (role_name, display_name, data_scope) VALUES ($1, $1, 'organization') RETURNING id",
      [`${name}_${suffix}`]
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE permission_key = ANY($2::text[])`,
      [roleId, permissionKeys]
    );
    return roleId;
  }

  /**
   * An active member of a unit.
   *
   * @param {number} unitId - Unit
   * @param {number} roleId - Role
   * @returns {Promise<string>} User ID
   */
  async function member(unitId, roleId) {
    const userId = await one(
      `INSERT INTO users (email, password, full_name)
       VALUES ('starter-' || gen_random_uuid() || '@example.test', 'x', 'Ada Lovelace') RETURNING id`
    );
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [userId, unitId, JSON.stringify([roleId])]
    );
    return userId;
  }

  /**
   * An activity the unit wrote by hand, as the units copied them before the catalogue.
   *
   * @param {number} unitId - Unit
   * @param {string} name - Name
   * @param {Object} [fields] - description, is_active, material
   * @returns {Promise<number>} Library ID
   */
  function handMade(unitId, name, fields = {}) {
    return one(
      `INSERT INTO activity_library (organization_id, name, description, material, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [unitId, name, fields.description ?? null, fields.material ?? null, fields.is_active ?? true, ids.leader]
    );
  }

  /**
   * @param {number} unitId - Unit
   * @param {string} key - Starter key
   * @returns {Promise<Object[]>} The unit's rows carrying that key
   */
  async function copiesOf(unitId, key) {
    const result = await pool.query(
      `SELECT * FROM activity_library WHERE organization_id = $1 AND metadata ->> 'starter_key' = $2`,
      [unitId, key]
    );
    return result.rows;
  }

  /**
   * Act as a member of a unit.
   *
   * @param {string} userId - Acting user
   * @param {number} unitId - Their unit
   * @returns {Object} Supertest agent
   */
  function as(userId, unitId) {
    mockContext.userId = userId;
    mockContext.organizationId = unitId;
    return request(app);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    ids.unit = await unit('Starter unit');
    ids.other = await unit('Other unit');
    ids.managerRole = await role('starter_manager', ['meetings.view', 'meetings.manage']);
    ids.viewerRole = await role('starter_viewer', ['meetings.view']);
    ids.leader = await member(ids.unit, ids.managerRole);
    ids.viewer = await member(ids.unit, ids.viewerRole);
    ids.otherLeader = await member(ids.other, ids.managerRole);

    app = express();
    app.use(express.json());
    app.locals.pool = pool;
    app.use('/api/v1/yearly-planner', require('../routes/yearlyPlanner')(pool, silentLogger));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('importing the same activity again, or many times at once, leaves one copy', async () => {
    await importStarterActivities(pool, ids.unit, ids.leader, ['game_sardines']);
    const again = await importStarterActivities(pool, ids.unit, ids.leader, ['game_sardines', 'game_sardines']);
    const concurrent = await Promise.all(Array.from({ length: CONCURRENT_IMPORTS }, () =>
      importStarterActivities(pool, ids.unit, ids.leader, ['technique_knots'])));

    expect(again.created).toEqual([]);
    expect(again.already_present.map((item) => item.key)).toEqual(['game_sardines']);
    expect(concurrent.flatMap((outcome) => outcome.created)).toHaveLength(1);
    expect(await copiesOf(ids.unit, 'game_sardines')).toHaveLength(1);
    expect(await copiesOf(ids.unit, 'technique_knots')).toHaveLength(1);
  });

  test('the database itself refuses a second copy of a starter activity in one unit', async () => {
    await expect(pool.query(
      `INSERT INTO activity_library (organization_id, name, metadata, created_by)
       VALUES ($1, 'Duplicate', '{"starter_key": "game_sardines"}', $2)`,
      [ids.unit, ids.leader]
    )).rejects.toMatchObject({ code: '23505' });
  });

  test('a copy carries the instructions, precautions and material, in the unit\'s language', async () => {
    const [copy] = await copiesOf(ids.unit, 'game_sardines');
    const source = entry('game_sardines');

    expect(copy).toMatchObject({
      name: source.fr.name,
      description: source.fr.summary,
      category: source.category,
      estimated_duration_min: source.duration.min,
      estimated_duration_max: source.duration.max,
      created_by: ids.leader,
    });
    expect(copy.metadata).toMatchObject({
      starter_key: 'game_sardines',
      starter_version: catalogue.version,
      starter_language: 'fr',
      steps: source.fr.steps,
      safety: source.fr.safety,
      variants: source.fr.variants,
      supervision: source.supervision,
    });
  });

  test('an older copy found by its legacy name is adopted with the unit\'s own text', async () => {
    const legacy = entry('block_water_break');
    const libraryId = await handMade(ids.unit, legacy.legacy_names[0], {
      description: 'Notre version : gourdes au local',
      material: 'Gourdes',
    });

    const outcome = await importStarterActivities(pool, ids.unit, ids.leader, ['block_water_break']);

    expect(outcome.reconciled).toEqual([expect.objectContaining({ key: 'block_water_break', library_id: libraryId })]);
    expect(outcome.created).toEqual([]);
    const [copy] = await copiesOf(ids.unit, 'block_water_break');
    expect(copy).toMatchObject({
      id: libraryId,
      name: legacy.legacy_names[0],
      description: 'Notre version : gourdes au local',
      material: 'Gourdes',
    });
  });

  test('two older copies with the same legacy name are reported, and neither is changed', async () => {
    const legacyName = entry('block_inspection').legacy_names[0];
    const first = await handMade(ids.unit, legacyName);
    const second = await handMade(ids.unit, legacyName);

    const outcome = await importStarterActivities(pool, ids.unit, ids.leader, ['block_inspection']);

    expect(outcome.ambiguous).toEqual([expect.objectContaining({
      key: 'block_inspection',
      candidates: [expect.objectContaining({ library_id: first }), expect.objectContaining({ library_id: second })],
    })]);
    expect(await copiesOf(ids.unit, 'block_inspection')).toEqual([]);

    // Deleting the extra copy settles it: the one still in use is adopted.
    await pool.query('UPDATE activity_library SET is_active = FALSE WHERE id = $1', [second]);
    const settled = await importStarterActivities(pool, ids.unit, ids.leader, ['block_inspection']);
    expect(settled.reconciled).toEqual([expect.objectContaining({ library_id: first })]);
  });

  test('a hidden copy is never duplicated: installation leaves it hidden, an explicit import restores it', async () => {
    const key = selectDefaultStarterKeys(null).find((candidate) => candidate.startsWith('game_'));
    await importStarterActivities(pool, ids.unit, ids.leader, [key]);
    const [copy] = await copiesOf(ids.unit, key);
    await as(ids.leader, ids.unit).delete(`/api/v1/yearly-planner/activity-library/${copy.id}`).expect(200);

    const client = await pool.connect();
    let install;
    try {
      await client.query('BEGIN');
      install = await installDefaultStarterActivities(client, ids.unit, ids.leader);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(install.hidden.map((item) => item.key)).toContain(key);
    expect(await copiesOf(ids.unit, key)).toEqual([expect.objectContaining({ id: copy.id, is_active: false })]);

    const restored = await importStarterActivities(pool, ids.unit, ids.leader, [key]);
    expect(restored.restored).toEqual([expect.objectContaining({ key, library_id: copy.id })]);
    expect(await copiesOf(ids.unit, key)).toEqual([expect.objectContaining({ id: copy.id, is_active: true })]);
  });

  test('a withdrawn, unknown or malformed selection is refused before anything is written', async () => {
    const before = await one('SELECT COUNT(*)::int FROM activity_library WHERE organization_id = $1', [ids.unit]);

    for (const keys of [['game_den_ball'], ['not_a_starter'], ['Robert\'); DROP TABLE'], [], 'game_sardines']) {
      // eslint-disable-next-line no-await-in-loop -- each refusal checked on its own
      await expect(importStarterActivities(pool, ids.unit, ids.leader, keys)).rejects.toBeInstanceOf(StarterSelectionError);
    }
    await expect(importStarterActivities(pool, ids.unit, ids.leader, ['game_sardines', 'game_den_ball']))
      .rejects.toMatchObject({ errors: [expect.objectContaining({ code: 'starter_activity_retired', key: 'game_den_ball' })] });

    expect(await one('SELECT COUNT(*)::int FROM activity_library WHERE organization_id = $1', [ids.unit])).toBe(before);
  });

  test('a unit\'s copy of the withdrawn game is left alone and never matched to another game', async () => {
    const retiredName = catalogue.retired_activities[0].legacy_names[0];
    const kept = await handMade(ids.unit, retiredName);

    const view = await describeStarterCatalogue(pool, ids.unit);

    expect(view.activities.map((activity) => activity.key)).not.toContain('game_den_ball');
    expect(view.activities.some((activity) => activity.library_id === kept)).toBe(false);
    expect(await one('SELECT metadata FROM activity_library WHERE id = $1', [kept])).toEqual({});
  });

  test('editing a copy changes neither the catalogue nor another unit\'s copy, and keeps its source', async () => {
    await importStarterActivities(pool, ids.other, ids.otherLeader, ['game_sardines']);
    const [mine] = await copiesOf(ids.unit, 'game_sardines');

    await as(ids.leader, ids.unit)
      .patch(`/api/v1/yearly-planner/activity-library/${mine.id}`)
      .send({ name: 'Sardines du local', metadata: { starter_key: 'game_steal_the_bacon', note: 'à notre façon' } })
      .expect(200);

    const [edited] = await copiesOf(ids.unit, 'game_sardines');
    expect(edited).toMatchObject({ id: mine.id, name: 'Sardines du local' });
    expect(edited.metadata).toEqual({ starter_key: 'game_sardines', note: 'à notre façon' });
    const [theirs] = await copiesOf(ids.other, 'game_sardines');
    expect(theirs.name).toBe(entry('game_sardines').fr.name);
    expect(require('../config/activity_library_starter.json')).toBe(catalogue);

    const again = await importStarterActivities(pool, ids.unit, ids.leader, ['game_sardines']);
    expect(again.already_present).toEqual([expect.objectContaining({ library_id: mine.id })]);
  });

  test('a hand-made activity cannot claim to be a starter copy', async () => {
    const response = await as(ids.leader, ids.unit)
      .post('/api/v1/yearly-planner/activity-library')
      .send({ name: 'Ballon chasseur maison', metadata: { starter_key: 'game_dodgeball', origin: 'local' } })
      .expect(201);

    expect(response.body.data.metadata).toEqual({ origin: 'local' });
  });

  test('another unit\'s import never adopts, restores or counts this unit\'s rows', async () => {
    const legacyName = entry('block_how_it_works').legacy_names[0];
    const mine = await handMade(ids.unit, legacyName);

    const outcome = await importStarterActivities(pool, ids.other, ids.otherLeader, ['block_how_it_works']);

    expect(outcome.created).toHaveLength(1);
    expect(await one('SELECT metadata FROM activity_library WHERE id = $1', [mine])).toEqual({});
  });

  test('English units get English text; an optional language uses the unit\'s fallback', async () => {
    const english = await unit('English unit', { language: 'en' });
    const ukrainianFr = await unit('Ukrainian unit', { language: 'uk' });
    await pool.query(
      `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
       VALUES ($1, 'interface_languages', '{"enabled": ["uk"], "fallback": "fr"}')`,
      [ukrainianFr]
    );
    const ukrainianDefault = await unit('Ukrainian default unit', { language: 'uk' });
    const leaderEn = await member(english, ids.managerRole);

    await importStarterActivities(pool, english, leaderEn, ['game_sardines']);
    await importStarterActivities(pool, ukrainianFr, leaderEn, ['game_sardines']);
    await importStarterActivities(pool, ukrainianDefault, leaderEn, ['game_sardines']);

    expect((await copiesOf(english, 'game_sardines'))[0].name).toBe(entry('game_sardines').en.name);
    expect((await copiesOf(ukrainianFr, 'game_sardines'))[0].name).toBe(entry('game_sardines').fr.name);
    // No fallback configured: the interface's default fallback, English.
    expect((await copiesOf(ukrainianDefault, 'game_sardines'))[0].name).toBe(entry('game_sardines').en.name);
  });

  test('a new cub unit receives its branch\'s standard activities once, without close supervision', async () => {
    const cubs = await unit('Cub unit', { section: 'cubs' });
    const cubLeader = await member(cubs, ids.managerRole);
    const install = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const outcome = await installDefaultStarterActivities(client, cubs, cubLeader);
        await client.query('COMMIT');
        return outcome;
      } finally {
        client.release();
      }
    };

    const first = await install();
    const second = await install();

    const expected = catalogue.activities
      .filter((activity) => activity.branches.includes('cubs') && activity.supervision === 'standard')
      .map((activity) => activity.key);
    expect(first.created.map((item) => item.key)).toEqual(expected);
    expect(expected).not.toContain('technique_knives');
    expect(expected).toEqual(expect.arrayContaining(['block_arrival', 'block_closing']));
    expect(second.created).toEqual([]);
    expect(await one('SELECT COUNT(*)::int FROM activity_library WHERE organization_id = $1', [cubs]))
      .toBe(expected.length);
  });

  test('browsing shows what the unit holds; only meetings.manage may browse or import', async () => {
    const response = await as(ids.leader, ids.unit).get('/api/v1/yearly-planner/starter-activities').expect(200);
    const byKey = Object.fromEntries(response.body.data.activities.map((activity) => [activity.key, activity]));

    expect(response.body.data).toMatchObject({ language: 'fr', version: catalogue.version });
    expect(byKey.game_sardines).toMatchObject({ status: 'present', library_id: expect.any(Number) });
    expect(byKey.game_sardines.steps).toEqual(entry('game_sardines').fr.steps);
    expect(byKey.technique_knives.status).toBe('available');

    const refused = await as(ids.viewer, ids.unit).get('/api/v1/yearly-planner/starter-activities').expect(403);
    expect(refused.body).toMatchObject({ required: ['meetings.manage'], missing: ['meetings.manage'] });
    await as(ids.viewer, ids.unit)
      .post('/api/v1/yearly-planner/starter-activities/import')
      .send({ keys: ['technique_knives'] })
      .expect(403);

    const imported = await as(ids.leader, ids.unit)
      .post('/api/v1/yearly-planner/starter-activities/import')
      .send({ keys: ['technique_knives'], organization_id: ids.other })
      .expect(200);
    expect(imported.body.data.created).toEqual([expect.objectContaining({ key: 'technique_knives' })]);
    expect(await copiesOf(ids.other, 'technique_knives')).toEqual([]);
  });
});
