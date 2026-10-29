/**
 * Every permission the code checks exists — integration suite
 *
 * A key that a route or screen requires, but that no migration creates,
 * refuses everyone: the district role cannot hold it and no unit can grant
 * it. Incident reports, scout years, unit settings and erasure were in that
 * state until migration 033. This reads each permission key checked in
 * routes/, middleware/, services/ and spa/ and asserts the catalog built from
 * the repository holds it.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and migrations.
 *
 * @module test/permission-catalog.integration
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['routes', 'middleware', 'services', 'spa'];
const PERMISSION_CALL = /\b(?:requirePermission|requireAnyPermission|userHasPermission|hasPermission|hasAnyPermission|hasAllPermissions)\(([^)]*)\)/g;
const PERMISSION_KEY = /'([a-z_]+\.[a-z_]+)'/g;

/**
 * @param {string} dir - Directory to walk
 * @returns {string[]} Every .js file below it
 */
function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : jsFiles(full);
    }
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/** @returns {Map<string, string>} Each permission key checked, with one file that checks it */
function checkedKeys() {
  const keys = new Map();
  for (const file of SOURCE_DIRS.flatMap((dir) => jsFiles(path.join(ROOT, dir)))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, args] of source.matchAll(PERMISSION_CALL)) {
      for (const [, key] of args.matchAll(PERMISSION_KEY)) {
        if (!keys.has(key)) {
          keys.set(key, path.relative(ROOT, file));
        }
      }
    }
  }
  return keys;
}

describe.skipIf(!DATABASE_URL)('The permission catalog', () => {
  let pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('holds every permission a route or screen checks', async () => {
    const { rows } = await pool.query('SELECT permission_key FROM permissions');
    const catalog = new Set(rows.map((row) => row.permission_key));
    const keys = checkedKeys();

    const missing = [...keys].filter(([key]) => !catalog.has(key)).map(([key, file]) => `${key} (${file})`);

    expect(keys.size).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  test('district holds every catalog permission, including those added by later migrations', async () => {
    const district = (await pool.query("SELECT id, grants_all_permissions FROM roles WHERE role_name='district' AND organization_id IS NULL")).rows;
    expect(district).toHaveLength(1);
    expect(district[0].grants_all_permissions).toBe(true);
    const missing = (await pool.query(`SELECT p.permission_key FROM permissions p
      WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=$1 AND rp.permission_id=p.id)
      ORDER BY p.permission_key`, [district[0].id])).rows;
    expect(missing).toEqual([]);
  });

  test('every declared catalog permission and category has a bilingual matrix label', async () => {
    const catalog = (await pool.query('SELECT permission_key, category FROM permissions ORDER BY permission_key')).rows;
    // Other integration suites insert intentionally synthetic permissions into
    // the shared database. Audit shipped declarations, not their test fixtures.
    const sqlFiles = fs.readdirSync(path.join(ROOT, 'migrations')).filter((file) => file.endsWith('.sql'))
      .map((file) => path.join(ROOT, 'migrations', file));
    sqlFiles.push(path.join(ROOT, 'attached_assets/permissions_list.sql'));
    const declared = new Set(sqlFiles.flatMap((file) => [...fs.readFileSync(file, 'utf8')
      .matchAll(/'([a-z_]+\.[a-z_]+)'\s*,\s*'[^']*'\s*,\s*'([a-z_]+)'/g)].map((match) => match[1])));
    expect(catalog.length).toBeGreaterThan(0);
    for (const language of ['en', 'fr']) {
      const labels = JSON.parse(fs.readFileSync(path.join(ROOT, 'lang', `${language}.json`), 'utf8'));
      const missing = catalog.filter((permission) => declared.has(permission.permission_key)).flatMap((permission) => [
        `role_permission_${permission.permission_key.replaceAll('.', '_')}`,
        `role_category_${permission.category}`,
      ]).filter((key) => !labels[key]?.trim());
      expect([...new Set(missing)]).toEqual([]);
    }
  });

  test('a newly inserted permission is immediately granted to district', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const permission = (await client.query(`INSERT INTO permissions (permission_key, permission_name, category)
        VALUES ('catalog_probe.view', 'Catalog regression probe', 'roles') RETURNING id`)).rows[0];
      const grants = (await client.query(`SELECT rp.permission_id FROM role_permissions rp
        JOIN roles r ON r.id=rp.role_id WHERE r.role_name='district' AND r.organization_id IS NULL
        AND rp.permission_id=$1`, [permission.id])).rows;
      expect(grants).toEqual([{ permission_id: permission.id }]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

});
