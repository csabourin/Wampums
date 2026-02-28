const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const migrationPath = process.argv[2];
  if (!migrationPath) {
    console.error('Usage: node run-migration.js <path-to-migration.sql>');
    process.exit(1);
  }

  try {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    console.log('Running migration:', migrationPath);
    await pool.query(sql);
    console.log('✓ Migration completed successfully');
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
