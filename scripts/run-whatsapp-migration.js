#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config();

/**
 * Run the WhatsApp auth migration using the standard migration pipeline.
 * Leverages the project's own SQL/JS migration runner (scripts/run-base-migrations.js),
 * the same one used for deploys, rather than node-pg-migrate (not used in this repo).
 * @returns {Promise<void>}
 */
async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL || process.env.PGDATABASE || process.env.POSTGRES_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL (or PGDATABASE/POSTGRES_URL) must be set before running migrations.');
    process.exit(1);
  }

  console.log('🔄 Running WhatsApp database migration...\n');

  await new Promise((resolve, reject) => {
    const migrateProcess = spawn(
      'npm',
      ['run', 'db:migrate:base'],
      {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl
        }
      }
    );

    migrateProcess.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Migration completed successfully!');
        console.log('You can now restart your server and try connecting WhatsApp again.');
        resolve();
        return;
      }

      reject(new Error(`Migration process exited with code ${code}`));
    });

    migrateProcess.on('error', reject);
  }).catch((error) => {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Please try running `npm run db:migrate:base` manually.');
    process.exit(1);
  });
}

runMigration();
