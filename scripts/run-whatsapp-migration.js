#!/usr/bin/env node
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.PGDATABASE || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔄 Running WhatsApp database migration...\n');

    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', 'migrate_whatsapp_auth_to_database.sql'),
      'utf8'
    );

    await pool.query(sql);
    console.log('✅ Migration completed successfully!\n');
    console.log('You can now restart your server and try connecting WhatsApp again.');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nPlease run the SQL manually in your database GUI.');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
