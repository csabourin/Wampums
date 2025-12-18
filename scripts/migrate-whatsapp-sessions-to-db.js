#!/usr/bin/env node
/**
 * Migrate WhatsApp Session Files to Database
 *
 * This script migrates existing file-based WhatsApp session data
 * (from whatsapp-sessions/ directory) to the database.
 *
 * Usage: node scripts/migrate-whatsapp-sessions-to-db.js
 */

const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const { BufferJSON } = require('@whiskeysockets/baileys');
require('dotenv').config();

const SESSIONS_DIR = path.join(__dirname, '..', 'whatsapp-sessions');

async function migrateSessionsToDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔄 Starting migration of WhatsApp sessions to database...\n');

    // Check if sessions directory exists
    try {
      await fs.access(SESSIONS_DIR);
    } catch {
      console.log('ℹ️  No whatsapp-sessions directory found. Nothing to migrate.');
      return;
    }

    // Get all organization directories
    const orgDirs = await fs.readdir(SESSIONS_DIR);
    let migratedCount = 0;
    let errorCount = 0;

    for (const orgDir of orgDirs) {
      // Extract organization ID from directory name (e.g., "org-1" -> 1)
      const match = orgDir.match(/^org-(\d+)$/);
      if (!match) {
        console.log(`⏭️  Skipping non-organization directory: ${orgDir}`);
        continue;
      }

      const organizationId = parseInt(match[1], 10);
      const orgPath = path.join(SESSIONS_DIR, orgDir);

      try {
        console.log(`📂 Processing organization ${organizationId}...`);

        // Read creds.json
        const credsPath = path.join(orgPath, 'creds.json');
        let creds = {};
        try {
          const credsData = await fs.readFile(credsPath, 'utf8');
          creds = JSON.parse(credsData);
          console.log(`   ✓ Loaded credentials`);
        } catch (error) {
          console.log(`   ⚠️  No credentials found (file may not exist yet)`);
        }

        // Read all key files
        const keys = {
          'pre-key': {},
          'session': {},
          'sender-key': {},
          'app-state-sync-key': {}
        };

        const files = await fs.readdir(orgPath);
        let keyCount = 0;

        for (const file of files) {
          if (file === 'creds.json') continue;

          const filePath = path.join(orgPath, file);
          const fileContent = await fs.readFile(filePath, 'utf8');
          const keyData = JSON.parse(fileContent);

          // Determine key type from filename
          if (file.startsWith('pre-key-')) {
            const keyId = file.replace('pre-key-', '').replace('.json', '');
            keys['pre-key'][keyId] = keyData;
            keyCount++;
          } else if (file.startsWith('session-')) {
            const keyId = file.replace('session-', '').replace('.json', '');
            keys['session'][keyId] = keyData;
            keyCount++;
          } else if (file.startsWith('sender-key-')) {
            const keyId = file.replace('sender-key-', '').replace('.json', '');
            keys['sender-key'][keyId] = keyData;
            keyCount++;
          } else if (file.startsWith('app-state-sync-key-')) {
            const keyId = file.replace('app-state-sync-key-', '').replace('.json', '');
            keys['app-state-sync-key'][keyId] = keyData;
            keyCount++;
          }
        }

        console.log(`   ✓ Loaded ${keyCount} keys`);

        // Save to database with proper Buffer serialization
        // IMPORTANT: Must use BufferJSON.replacer to preserve Buffer objects for encryption keys
        const serializedCreds = JSON.stringify(creds, BufferJSON.replacer);
        const serializedKeys = JSON.stringify(keys, BufferJSON.replacer);

        await pool.query(
          `INSERT INTO whatsapp_baileys_connections (organization_id, auth_creds, auth_keys, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (organization_id)
           DO UPDATE SET
             auth_creds = $2,
             auth_keys = $3,
             updated_at = NOW()`,
          [organizationId, serializedCreds, serializedKeys]
        );

        console.log(`   ✅ Migrated organization ${organizationId} to database\n`);
        migratedCount++;

      } catch (error) {
        console.error(`   ❌ Error migrating organization ${organizationId}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Successfully migrated: ${migratedCount} organization(s)`);
    console.log(`   ❌ Errors: ${errorCount} organization(s)`);

    if (migratedCount > 0) {
      console.log('\n✨ Migration complete!');
      console.log('💡 You can now safely delete the whatsapp-sessions/ directory');
      console.log('   (it\'s already in .gitignore so it won\'t be committed)');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration
migrateSessionsToDatabase().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
