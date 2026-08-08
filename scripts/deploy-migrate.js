#!/usr/bin/env node
/**
 * Deployment migration step.
 *
 * Runs before the server starts so a deploy can never serve traffic against a
 * schema older than the code that was just shipped. That mismatch is not
 * hypothetical: shipping code that referenced new columns before the migration
 * had run took the fundraising campaigns screen down entirely.
 *
 * Designed for the autoscale deployment target, where the start command runs on
 * every instance and several can boot simultaneously:
 *
 *   * migrations are serialised by a transaction-scoped advisory lock, so
 *     concurrent instances queue rather than race;
 *   * the whole run is one transaction — a failing migration rolls back and
 *     leaves the schema untouched;
 *   * a failure exits non-zero, so the instance does not start against a
 *     half-migrated database. A loud failed deploy beats a quiet broken app.
 *
 * Usage: node scripts/deploy-migrate.js
 */

'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { applyBaseMigrations } = require('./run-base-migrations');

/**
 * Apply every checked-in migration, then report what changed.
 *
 * @returns {Promise<void>} Resolves once migrations are committed
 */
async function migrateForDeploy() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be configured to run deployment migrations');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  const startedAt = Date.now();

  try {
    await client.query('BEGIN');
    const results = await applyBaseMigrations(client);
    await client.query('COMMIT');

    const applied = results.filter((result) => result.changed);
    const elapsedMs = Date.now() - startedAt;

    if (applied.length === 0) {
      console.log(`[deploy-migrate] Schema already up to date (${results.length} migrations checked, ${elapsedMs}ms)`);
      return;
    }

    console.log(`[deploy-migrate] Applied ${applied.length} migration(s) in ${elapsedMs}ms:`);
    applied.forEach((result) => console.log(`[deploy-migrate]   + ${result.migrationFile}`));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrateForDeploy().catch((error) => {
    // Fail the deploy rather than booting against an unmigrated schema.
    console.error(`[deploy-migrate] FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { migrateForDeploy };
