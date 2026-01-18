require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.SB_URL || process.env.DATABASE_URL,
    max: 1 // Single connection is enough for migration
});

async function runMigration() {
    try {
        const migrationPath = path.join(__dirname, '../migrations/fix_ai_usage_log_user_id.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log('Running migration...');
        console.log(sql);

        await pool.query(sql);

        console.log('✅ Migration completed successfully.');
    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        await pool.end();
    }
}

runMigration();
