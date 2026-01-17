
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.SB_URL,
});

async function checkDomains() {
    try {
        const res = await pool.query('SELECT * FROM organization_domains');
        console.log('Domains in DB:');
        console.table(res.rows);
    } catch (err) {
        console.error('Error querying DB:', err);
    } finally {
        await pool.end();
    }
}

checkDomains();
