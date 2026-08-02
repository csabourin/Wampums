#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { applyMigration } = require('./run-migration');

const migrationsDirectory = path.resolve(__dirname, '..', 'migrations');

/** Apply all checked-in database migrations in filename order. */
async function applyBaseMigrations(client, context = {}) {
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

module.exports = { applyBaseMigrations };
