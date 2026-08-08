#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { applyMigration } = require('./run-migration');

const migrationsDirectory = path.resolve(__dirname, '..', 'migrations');

/**
 * Advisory lock key serialising migration runs across processes.
 *
 * The deployment target is autoscale, so the start command runs on every
 * instance and several can boot at once. Without this lock, concurrent runners
 * each see a migration as unapplied and race to apply it: observed failures
 * include `duplicate key value violates unique constraint
 * "pg_type_typname_nsp_index"` from two transactions creating the same object,
 * which would leave those instances unable to start.
 *
 * The lock is transaction scoped, so PostgreSQL releases it on COMMIT or
 * ROLLBACK even if the process dies mid-migration. Latecomers block until the
 * winner commits, then read the updated schema_migrations and no-op.
 */
const MIGRATION_ADVISORY_LOCK_KEY = 8264117;

/**
 * Apply all checked-in database migrations in filename order.
 *
 * Must be called inside a transaction; the caller owns BEGIN/COMMIT.
 *
 * @param {Object} client - Connected pg client already inside a transaction
 * @param {Object} [context] - Extra context passed to JavaScript migrations
 * @returns {Promise<Array<{migrationFile: string, changed: boolean}>>} Per-migration outcome
 */
async function applyBaseMigrations(client, context = {}) {
  // Serialise concurrent runners before reading migration state, so the
  // "has this been applied?" check and the apply cannot interleave.
  await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);

  const migrationFiles = fs.readdirSync(migrationsDirectory)
    .filter((fileName) => /\.(?:js|sql)$/.test(fileName))
    .sort();
  const results = [];
  for (const migrationFile of migrationFiles) {
    const changed = await applyMigration(client, migrationFile, context);
    results.push({ migrationFile, changed });
  }
  return results;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL must be configured');
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = await applyBaseMigrations(client);
    await client.query('COMMIT');
    for (const result of results) {
      console.log(`${result.changed ? 'Applied' : 'Skipped'} ${result.migrationFile}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Base migrations failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { applyBaseMigrations, MIGRATION_ADVISORY_LOCK_KEY };
