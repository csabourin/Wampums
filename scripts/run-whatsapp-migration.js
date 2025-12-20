#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config();

/**
 * Run the WhatsApp auth migration using the standard migration pipeline.
 * Leverages npm scripts so we stay aligned with node-pg-migrate conventions.
 * @returns {Promise<void>}
 */
async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL || process.env.PGDATABASE || process.env.POSTGRES_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL (or PGDATABASE/POSTGRES_URL) must be set before running migrations.');
    process.exit(1);
  }

  console.log('🔄 Running WhatsApp database migration via node-pg-migrate...\n');

  await new Promise((resolve, reject) => {
    const migrateProcess = spawn(
      'npm',
      ['run', 'migrate', '--', 'up'],
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
    console.error('Please ensure node-pg-migrate is installed and try running `npm run migrate -- up` manually.');
    process.exit(1);
  });
}

runMigration();
