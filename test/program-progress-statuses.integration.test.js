/**
 * Every status a progress record can hold has a label — integration suite
 *
 * The programme progress stream shows each record's status through
 * `program_progress_status_<status>`; a value missing from the screen's list
 * would show as "other". This reads the statuses each source table allows
 * (its CHECK constraint) and asserts the screen labels them all.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and migrations.
 *
 * @module test/program-progress-statuses.integration
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
const ROOT = path.join(__dirname, '..');

/** @returns {string[]} The tables the stream reads, from routes/programProgress.js */
function streamTables() {
  const source = fs.readFileSync(path.join(ROOT, 'routes/programProgress.js'), 'utf8');
  return [...source.matchAll(/table: '([a-z_]+)'/g)].map((match) => match[1]);
}

/** @returns {Set<string>} The statuses ProgramProgressDashboard labels */
function labelledStatuses() {
  const source = fs.readFileSync(path.join(ROOT, 'spa/modules/program-progress/ProgramProgressDashboard.js'), 'utf8');
  const list = source.match(/PROGRAM_PROGRESS_STATUSES = \[([^\]]*)\]/)[1];
  return new Set([...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]));
}

describe.skipIf(!DATABASE_URL)('Programme progress statuses', () => {
  let pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('the screen labels every status a source table allows', async () => {
    const tables = streamTables();
    const { rows } = await pool.query(
      `SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE contype = 'c'
          AND conrelid::regclass::text = ANY($1::text[])
          AND pg_get_constraintdef(oid) ~ '\\m(status|decision|outcome|review_type)\\M'`,
      [tables],
    );
    const labelled = labelledStatuses();

    const allowed = rows.flatMap((row) => [...row.definition.matchAll(/'([a-z_]+)'::/g)]
      .map((match) => `${row.table_name}: ${match[1]}`));
    const unlabelled = allowed.filter((entry) => !labelled.has(entry.split(': ')[1]));

    expect(tables.length).toBeGreaterThan(5);
    expect(allowed.length).toBeGreaterThan(10);
    expect(unlabelled).toEqual([]);
  });
});
