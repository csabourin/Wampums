// Quick script to apply the view fix using the app's database connection
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const poolConfig = {
  connectionString: process.env.SB_URL || process.env.DATABASE_URL
};

if (process.env.DATABASE_URL || process.env.SB_URL) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

async function applyFix() {
  try {
    console.log('Connecting to database...');
    const sql = fs.readFileSync('./migrations/fix_budget_views_column_names.sql', 'utf8');

    console.log('Applying view fixes...');
    await pool.query(sql);

    console.log('✅ Views fixed successfully!');
    console.log('\nVerifying views exist:');

    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_name IN ('v_budget_revenue', 'v_budget_summary_by_category')
      ORDER BY table_name;
    `);

    console.log('Found views:', result.rows.map(r => r.table_name));

  } catch (error) {
    console.error('❌ Error applying fix:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyFix();
