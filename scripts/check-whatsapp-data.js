#!/usr/bin/env node
/**
 * Check WhatsApp data in database
 */

const { Pool } = require('pg');
require('dotenv').config();

async function checkData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });

  try {
    const result = await pool.query(
      `SELECT
        organization_id,
        is_connected,
        connected_phone_number,
        jsonb_typeof(auth_creds) as creds_type,
        jsonb_typeof(auth_keys) as keys_type,
        (auth_creds->>'registrationId') as registration_id,
        (auth_creds->'noiseKey'->>'private') is not null as has_noise_key_private,
        (auth_creds->'identityKey'->>'private') is not null as has_identity_key_private,
        (auth_creds->'signedIdentityKey'->>'private') is not null as has_signed_identity_key_private,
        (auth_creds->'signedPreKey'->'keyPair'->>'private') is not null as has_signed_prekey_private,
        last_connected_at,
        last_disconnected_at
      FROM whatsapp_baileys_connections
      ORDER BY organization_id
      LIMIT 10`
    );

    console.log('WhatsApp Connections:');
    console.log('=====================\n');

    for (const row of result.rows) {
      console.log(`Organization ID: ${row.organization_id}`);
      console.log(`Connected: ${row.is_connected}`);
      console.log(`Phone: ${row.connected_phone_number || 'N/A'}`);
      console.log(`Creds Type: ${row.creds_type}`);
      console.log(`Keys Type: ${row.keys_type}`);
      console.log(`Registration ID: ${row.registration_id || 'MISSING'}`);
      console.log(`Has Noise Key Private: ${row.has_noise_key_private}`);
      console.log(`Has Identity Key Private: ${row.has_identity_key_private}`);
      console.log(`Has Signed Identity Key Private: ${row.has_signed_identity_key_private}`);
      console.log(`Has Signed PreKey Private: ${row.has_signed_prekey_private}`);
      console.log(`Last Connected: ${row.last_connected_at || 'Never'}`);
      console.log(`Last Disconnected: ${row.last_disconnected_at || 'Never'}`);
      console.log('---\n');
    }

    // Get a sample of the actual data structure
    const sampleResult = await pool.query(
      `SELECT auth_creds FROM whatsapp_baileys_connections ORDER BY organization_id LIMIT 1`
    );

    if (sampleResult.rows.length > 0) {
      console.log('\nSample auth_creds structure:');
      console.log('============================');
      const creds = sampleResult.rows[0].auth_creds;

      // Check if noiseKey exists and what format it's in
      if (creds.noiseKey) {
        console.log('\nnoiseKey.private sample:', JSON.stringify(creds.noiseKey.private).substring(0, 200));
      } else {
        console.log('\nnoiseKey: MISSING');
      }

      if (creds.registrationId !== undefined) {
        console.log(`registrationId: ${creds.registrationId} (type: ${typeof creds.registrationId})`);
      } else {
        console.log('registrationId: MISSING');
      }
    }

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

checkData().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
