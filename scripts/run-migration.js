#!/usr/bin/env node
/**
 * Database migration runner for checked-in SQL and JavaScript migrations.
 * Usage: node scripts/run-migration.js <migration-file.sql|migration-file.js>
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

function resolveMigrationPath(migrationFile) {
  if (!migrationFile || path.basename(migrationFile) !== migrationFile) {
    throw new Error('Migration must be a filename inside migrations/');
  }
  return path.join(__dirname, '..', 'migrations', migrationFile);
}

/** Apply one migration using an existing transaction/client. */
async function applyMigration(client, migrationFile, context = {}) {
  const migrationPath = resolveMigrationPath(migrationFile);
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       migration_name text PRIMARY KEY,
       description text,
       applied_at timestamptz NOT NULL DEFAULT NOW()
     )`,
  );

  const applied = await client.query(
    'SELECT 1 FROM schema_migrations WHERE migration_name = $1',
    [migrationFile],
  );
  if (applied.rows.length > 0) return false;

  let description = null;
  if (path.extname(migrationPath) === '.sql') {
    await client.query(fs.readFileSync(migrationPath, 'utf8'));
  } else if (path.extname(migrationPath) === '.js') {
    delete require.cache[require.resolve(migrationPath)];
    const migration = require(migrationPath);
    if (typeof migration.up !== 'function') {
      throw new Error(`${migrationFile} must export an up(client, context) function`);
    }
    description = migration.description || null;
    await migration.up(client, context);
  } else {
    throw new Error('Only .sql and .js migration files are supported');
  }

  await client.query(
    `INSERT INTO schema_migrations (migration_name, description)
     VALUES ($1, $2)`,
    [migrationFile, description],
  );
  return true;
}

async function runMigration(migrationFile) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL must be configured');
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });
  const client = await pool.connect();

  try {
    console.log(`Running migration: ${migrationFile}`);
    await client.query('BEGIN');
    const changed = await applyMigration(client, migrationFile);
    await client.query('COMMIT');
    console.log(changed ? '✅ Migration completed successfully' : 'Migration already applied; skipped');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const migrationFile = process.argv[2];
if (require.main === module) {
  if (!migrationFile) {
    console.error('Usage: node scripts/run-migration.js <migration-file.sql|migration-file.js>');
    process.exit(1);
  }
  runMigration(migrationFile);
}

module.exports = { applyMigration, runMigration };
