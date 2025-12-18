#!/usr/bin/env node
/**
 * Fix WhatsApp Buffer Serialization in Database
 *
 * This script fixes the issue where Buffers were stored using regular JSON.stringify()
 * instead of BufferJSON.replacer, causing authentication handshake failures.
 *
 * The problem: Regular JSON.stringify() converts Buffers to {"type":"Buffer","data":[...]}
 * The solution: Re-serialize using BufferJSON.replacer to preserve proper Buffer objects
 *
 * Usage: node scripts/fix-whatsapp-buffer-serialization.js
 */

const { Pool } = require('pg');
const { BufferJSON } = require('@whiskeysockets/baileys');
require('dotenv').config();

async function fixBufferSerialization() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔧 Starting WhatsApp Buffer serialization fix...\n');

    // Get all WhatsApp connections
    const result = await pool.query(
      `SELECT organization_id, auth_creds, auth_keys
       FROM whatsapp_baileys_connections`
    );

    if (result.rows.length === 0) {
      console.log('ℹ️  No WhatsApp connections found in database.');
      return;
    }

    console.log(`Found ${result.rows.length} WhatsApp connection(s) to fix.\n`);

    let fixedCount = 0;
    let errorCount = 0;

    for (const row of result.rows) {
      const organizationId = row.organization_id;

      try {
        console.log(`📂 Processing organization ${organizationId}...`);

        // Parse the existing data (this will convert {"type":"Buffer","data":[...]} to Buffers)
        let creds = row.auth_creds;
        let keys = row.auth_keys;

        // If they're stored as strings, parse them first
        if (typeof creds === 'string') {
          creds = JSON.parse(creds, BufferJSON.reviver);
        } else if (creds && typeof creds === 'object') {
          // Re-parse with BufferJSON.reviver to properly restore Buffers
          creds = JSON.parse(JSON.stringify(creds), BufferJSON.reviver);
        }

        if (typeof keys === 'string') {
          keys = JSON.parse(keys, BufferJSON.reviver);
        } else if (keys && typeof keys === 'object') {
          // Re-parse with BufferJSON.reviver to properly restore Buffers
          keys = JSON.parse(JSON.stringify(keys), BufferJSON.reviver);
        }

        // Validate that we now have proper Buffers
        const hasValidCreds = creds &&
          Buffer.isBuffer(creds?.noiseKey?.private) &&
          Buffer.isBuffer(creds?.noiseKey?.public) &&
          Buffer.isBuffer(creds?.identityKey?.private) &&
          Buffer.isBuffer(creds?.identityKey?.public) &&
          Buffer.isBuffer(creds?.signedIdentityKey?.private) &&
          Buffer.isBuffer(creds?.signedIdentityKey?.public) &&
          Buffer.isBuffer(creds?.signedPreKey?.keyPair?.private) &&
          Buffer.isBuffer(creds?.signedPreKey?.keyPair?.public) &&
          typeof creds?.registrationId === 'number';

        if (!hasValidCreds) {
          console.log(`   ⚠️  Warning: Credentials still incomplete after parsing. Clearing auth state.`);
          console.log(`      This will force a fresh QR code generation on next connection attempt.`);

          // Clear the auth state completely to allow fresh QR generation
          await pool.query(
            `UPDATE whatsapp_baileys_connections
             SET auth_creds = '{}',
                 auth_keys = '{}',
                 is_connected = FALSE,
                 last_disconnected_at = NOW(),
                 updated_at = NOW()
             WHERE organization_id = $1`,
            [organizationId]
          );

          console.log(`   ✅ Cleared auth state for organization ${organizationId}`);
          console.log(`      User should now be able to scan a fresh QR code.\n`);
          fixedCount++;
          continue;
        }

        // Now re-serialize properly using BufferJSON.replacer
        const serializedCreds = JSON.stringify(creds, BufferJSON.replacer);
        const serializedKeys = JSON.stringify(keys, BufferJSON.replacer);

        // Update the database with properly serialized data
        await pool.query(
          `UPDATE whatsapp_baileys_connections
           SET auth_creds = $2,
               auth_keys = $3,
               updated_at = NOW()
           WHERE organization_id = $1`,
          [organizationId, serializedCreds, serializedKeys]
        );

        console.log(`   ✅ Fixed Buffer serialization for organization ${organizationId}`);
        console.log(`      - noiseKey: ${Buffer.isBuffer(creds.noiseKey.private) ? '✓' : '✗'}`);
        console.log(`      - identityKey: ${Buffer.isBuffer(creds.identityKey.private) ? '✓' : '✗'}`);
        console.log(`      - signedIdentityKey: ${Buffer.isBuffer(creds.signedIdentityKey.private) ? '✓' : '✗'}`);
        console.log(`      - signedPreKey: ${Buffer.isBuffer(creds.signedPreKey.keyPair.private) ? '✓' : '✗'}`);
        console.log(`      - registrationId: ${typeof creds.registrationId === 'number' ? creds.registrationId : '✗'}\n`);

        fixedCount++;

      } catch (error) {
        console.error(`   ❌ Error fixing organization ${organizationId}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📊 Fix Summary:');
    console.log(`   ✅ Successfully fixed: ${fixedCount} organization(s)`);
    console.log(`   ❌ Errors: ${errorCount} organization(s)`);

    if (fixedCount > 0) {
      console.log('\n✨ Fix complete!');
      console.log('🔄 Please try connecting your WhatsApp account again.');
      console.log('   The authentication should now work properly.');
    }

  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run fix
fixBufferSerialization().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
