/** A real SISC reimport never replaces a family's health declaration with CSV identity data. */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { ensureActiveScoutYear } = require('../services/scoutYear');
require('./jest-conditional-helpers');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET_KEY ||= 'fictional-sisc-health-preservation';
const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!DATABASE_URL)('SISC health preservation', () => {
  let pool; let app; let unit; let manager; let year;
  const participants = [];
  const one = async (sql, params = []) => Object.values((await pool.query(sql, params)).rows[0])[0];

  async function youth(firstName) {
    const id = await one("INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, 'Fiction', '2016-05-03') RETURNING id", [firstName]);
    participants.push(id);
    await pool.query("INSERT INTO participant_enrollments (organization_id, participant_id, scout_year_id, status) VALUES ($1, $2, $3, 'active')", [unit, id, year]);
    return id;
  }
  const healthRows = async (participantId) => (await pool.query(
    "SELECT * FROM form_submissions WHERE organization_id = $1 AND participant_id = $2 AND form_type = 'fiche_sante' ORDER BY id",
    [unit, participantId]
  )).rows;
  const importYouth = (firstName) => request(app).post('/api/v1/import/sisc')
    .set('Authorization', `Bearer ${jwt.sign({ user_id: manager, organizationId: unit }, process.env.JWT_SECRET_KEY)}`)
    .send({ csvContent: `nom;prenom;naissance;adresse;photos;quitter\nFiction;${firstName};20160503;Fictional address;O;N` });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      unit = (await db.query("INSERT INTO organizations (name) VALUES ('Fictional SISC Health Unit') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO organization_program_sections (organization_id, section_key, display_name) VALUES ($1, 'general', 'General')", [unit]);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    } finally { db.release(); }
    manager = await one("INSERT INTO users (email, password, full_name) VALUES ('sisc-health-' || gen_random_uuid() || '@example.test', 'x', 'Fictional Import Manager') RETURNING id");
    await pool.query(`INSERT INTO user_organizations (organization_id, user_id, role_ids, status)
      SELECT $1, $2, jsonb_build_array(id), 'active' FROM roles WHERE role_name = 'district' AND organization_id IS NULL`, [unit, manager]);
    year = (await ensureActiveScoutYear(pool, unit)).id;
    await pool.query(`INSERT INTO organization_form_formats (organization_id, form_type, form_structure)
      SELECT $1, form_type, '{}'::jsonb FROM UNNEST($2::text[]) AS form_type`, [unit, ['fiche_sante', 'inscription', 'autorisations']]);
    app = express(); app.locals.pool = pool; app.use(express.json());
    app.use('/api/v1/import', require('../routes/import')(pool, logger));
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: 'internal_server_error' }));
  });

  afterAll(async () => {
    if (!pool) { return; }
    await pool.query('DELETE FROM form_submissions WHERE organization_id = $1', [unit]);
    await pool.query('DELETE FROM participant_enrollments WHERE organization_id = $1', [unit]);
    await pool.query('DELETE FROM participants WHERE id = ANY($1::int[])', [participants]);
    await pool.query('DELETE FROM scout_years WHERE organization_id = $1', [unit]);
    await pool.query('DELETE FROM organizations WHERE id = $1', [unit]);
    await pool.query('DELETE FROM users WHERE id = $1', [manager]);
    await pool.end();
  });

  test('reimport preserves every health answer, date and review field while refreshing supported forms', async () => {
    const id = await youth('Ada');
    const answers = { allergie: 'Fictional allergy', medicament: 'Fictional medication', consignes: 'Family instructions', notes: 'Private health note' };
    await pool.query(`INSERT INTO form_submissions
      (organization_id, participant_id, form_type, submission_data, updated_at, reviewed_by, reviewed_at, review_notes, submitted_at)
      VALUES ($1, $2, 'fiche_sante', $3, '2025-01-02 12:00:00', $4, '2025-01-03 12:00:00', 'Reviewed by fictional staff', '2025-01-01 12:00:00')`,
    [unit, id, JSON.stringify(answers), manager]);
    await pool.query(`INSERT INTO form_submissions (organization_id, participant_id, form_type, submission_data)
      VALUES ($1, $2, 'inscription', '{"adresse":"Old fictional address"}')`, [unit, id]);
    const before = await healthRows(id);
    const response = await importYouth('Ada');
    expect(response.status).toBe(200);
    expect(response.body.stats.errors).toEqual([]);
    expect(response.body.stats.participantsUpdated).toBe(1);
    expect(await healthRows(id)).toEqual(before);
    const forms = (await pool.query('SELECT form_type, submission_data FROM form_submissions WHERE organization_id = $1 AND participant_id = $2', [unit, id])).rows;
    expect(forms.find((form) => form.form_type === 'inscription').submission_data.adresse).toBe('Fictional address');
    expect(forms.find((form) => form.form_type === 'autorisations').submission_data).toMatchObject({ autorisation_photo: 'yes', peut_quitter_seul: 'no' });
  });

  test('an existing youth without a health declaration is still missing it after import', async () => {
    const id = await youth('Grace');
    expect((await importYouth('Grace')).body.stats.errors).toEqual([]);
    expect(await healthRows(id)).toEqual([]);
    expect(await one("SELECT COUNT(*)::int FROM form_submissions WHERE organization_id = $1 AND participant_id = $2 AND form_type = 'inscription'", [unit, id])).toBe(1);
  });

  test('a first import creates a youth and supported forms without fabricating a health declaration', async () => {
    const response = await importYouth('Emmy');
    expect(response.status).toBe(200);
    expect(response.body.stats.errors).toEqual([]);
    expect(response.body.stats.participantsCreated).toBe(1);
    const id = await one("SELECT p.id FROM participants p JOIN participant_organizations po ON po.participant_id = p.id WHERE po.organization_id = $1 AND p.first_name = 'Emmy' AND p.last_name = 'Fiction'", [unit]);
    participants.push(id);
    expect(await healthRows(id)).toEqual([]);
    expect(await one('SELECT COUNT(*)::int FROM form_submissions WHERE organization_id = $1 AND participant_id = $2', [unit, id])).toBe(2);
  });
});
