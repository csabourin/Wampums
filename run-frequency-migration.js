#!/usr/bin/env node

/**
 * Run the frequency preset columns migration
 * This script adds the necessary columns to store structured frequency data
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Create database pool with the same configuration as the API
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : false
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('🔄 Running frequency preset columns migration...');

    // Read the first migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', 'add_frequency_preset_columns.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    await client.query(sql);

    console.log('✅ Frequency columns migration completed!');
    console.log('');

    // Now run the timezone fix migration
    console.log('🔄 Running timezone fix migration...');
    const timezonePath = path.join(__dirname, 'migrations', 'fix_medication_time_timezone.sql');
    const timezoneSql = fs.readFileSync(timezonePath, 'utf8');
    await client.query(timezoneSql);

    console.log('✅ Timezone fix migration completed!');
    console.log('');
    console.log('Migrations completed:');
    console.log('  ✓ frequency_preset_type (VARCHAR(30))');
    console.log('  ✓ frequency_times (JSONB)');
    console.log('  ✓ frequency_slots (JSONB)');
    console.log('  ✓ frequency_interval_hours (INTEGER)');
    console.log('  ✓ frequency_interval_start (VARCHAR(5)) - fixed timezone issue');
    console.log('');
    console.log('✨ The medication frequency preset UI should now work correctly!');
    console.log('🕐 Times will stay in your local timezone (no UTC conversion)');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('');
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
