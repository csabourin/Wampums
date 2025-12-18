#!/usr/bin/env node
/**
 * Diagnose WhatsApp Authentication Data
 *
 * Tests if the stored auth data can be properly loaded and used by Baileys
 */

const { Pool } = require('pg');
const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');
require('dotenv').config();

async function diagnoseAuth() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔍 Diagnosing WhatsApp Authentication Data\n');
    console.log('='.repeat(60));

    // Load the data
    const result = await pool.query(
      `SELECT organization_id, auth_creds FROM whatsapp_baileys_connections ORDER BY organization_id LIMIT 1`
    );

    if (result.rows.length === 0) {
      console.log('❌ No WhatsApp connections found in database');
      return;
    }

    const { organization_id, auth_creds } = result.rows[0];
    console.log(`\n📂 Organization ID: ${organization_id}`);
    console.log('='.repeat(60));

    // Show raw data structure
    console.log('\n1️⃣ RAW DATA STRUCTURE:');
    console.log('-'.repeat(60));
    console.log('Top-level fields:', Object.keys(auth_creds).join(', '));

    if (auth_creds.noiseKey) {
      console.log('\nnoiseKey structure:');
      console.log('  - private:', typeof auth_creds.noiseKey.private, auth_creds.noiseKey.private);
      console.log('  - public:', typeof auth_creds.noiseKey.public, auth_creds.noiseKey.public);
    }

    if (auth_creds.identityKey) {
      console.log('\n✅ identityKey: PRESENT');
      console.log('  - private:', typeof auth_creds.identityKey.private);
      console.log('  - public:', typeof auth_creds.identityKey.public);
    } else {
      console.log('\n❌ identityKey: MISSING (This is required!)');
    }

    if (auth_creds.signedIdentityKey) {
      console.log('\n✅ signedIdentityKey: PRESENT');
    }

    console.log('\nregistrationId:', auth_creds.registrationId, `(type: ${typeof auth_creds.registrationId})`);

    // Test BufferJSON revival
    console.log('\n\n2️⃣ TESTING BUFFERJSON REVIVAL:');
    console.log('-'.repeat(60));

    const serialized = JSON.stringify(auth_creds);
    let revived;
    try {
      revived = JSON.parse(serialized, BufferJSON.reviver);
      console.log('✅ BufferJSON.reviver succeeded');

      // Check if we got real Buffers
      if (revived.noiseKey) {
        const isPrivateBuffer = Buffer.isBuffer(revived.noiseKey.private);
        const isPublicBuffer = Buffer.isBuffer(revived.noiseKey.public);
        console.log(`\nnoiseKey.private is Buffer: ${isPrivateBuffer ? '✅' : '❌'}`);
        console.log(`noiseKey.public is Buffer: ${isPublicBuffer ? '✅' : '❌'}`);

        if (!isPrivateBuffer) {
          console.log('  Actual type:', typeof revived.noiseKey.private);
          console.log('  Actual value:', revived.noiseKey.private);
        }
      }
    } catch (error) {
      console.log('❌ BufferJSON.reviver failed:', error.message);
    }

    // Test validation
    console.log('\n\n3️⃣ TESTING CREDENTIAL VALIDATION:');
    console.log('-'.repeat(60));

    const baseCreds = initAuthCreds();
    console.log('Generated fresh credentials for comparison');
    console.log('Fresh creds has identityKey:', !!baseCreds.identityKey);

    const merged = {
      ...baseCreds,
      ...auth_creds,
      noiseKey: auth_creds?.noiseKey || baseCreds.noiseKey,
      identityKey: auth_creds?.identityKey || baseCreds.identityKey,
      signedIdentityKey: auth_creds?.signedIdentityKey || baseCreds.signedIdentityKey,
      signedPreKey: auth_creds?.signedPreKey || baseCreds.signedPreKey,
      account: auth_creds?.account || baseCreds.account,
    };

    console.log('\n✅ Merged with fresh creds');
    console.log('Merged has identityKey:', !!merged.identityKey);

    const hasRequiredKeys = Boolean(
      merged?.noiseKey?.private &&
      merged?.noiseKey?.public &&
      merged?.signedIdentityKey?.private &&
      merged?.signedIdentityKey?.public &&
      merged?.signedPreKey?.keyPair?.private &&
      merged?.signedPreKey?.keyPair?.public &&
      merged?.identityKey?.private &&
      merged?.identityKey?.public &&
      typeof merged?.registrationId === 'number'
    );

    console.log('\nValidation checks:');
    console.log('  - noiseKey.private:', !!merged?.noiseKey?.private);
    console.log('  - noiseKey.public:', !!merged?.noiseKey?.public);
    console.log('  - identityKey.private:', !!merged?.identityKey?.private);
    console.log('  - identityKey.public:', !!merged?.identityKey?.public);
    console.log('  - signedIdentityKey.private:', !!merged?.signedIdentityKey?.private);
    console.log('  - signedIdentityKey.public:', !!merged?.signedIdentityKey?.public);
    console.log('  - signedPreKey.keyPair.private:', !!merged?.signedPreKey?.keyPair?.private);
    console.log('  - signedPreKey.keyPair.public:', !!merged?.signedPreKey?.keyPair?.public);
    console.log('  - registrationId is number:', typeof merged?.registrationId === 'number');

    console.log(`\n${hasRequiredKeys ? '✅' : '❌'} Overall validation: ${hasRequiredKeys ? 'PASS' : 'FAIL'}`);

    if (!hasRequiredKeys) {
      console.log('\n⚠️  RECOMMENDATION: Credentials should be refreshed');
      console.log('   The ensureValidCreds function will auto-regenerate these.');
    }

    // Test proper serialization
    console.log('\n\n4️⃣ TESTING PROPER SERIALIZATION:');
    console.log('-'.repeat(60));

    const properSerialized = JSON.stringify(baseCreds, BufferJSON.replacer);
    console.log('✅ Serialized fresh creds with BufferJSON.replacer');

    const properRevived = JSON.parse(properSerialized, BufferJSON.reviver);
    console.log('✅ Revived with BufferJSON.reviver');

    const isBuffer = Buffer.isBuffer(properRevived.noiseKey.private);
    console.log(`\nnoiseKey.private is Buffer after proper serialization: ${isBuffer ? '✅' : '❌'}`);

    if (isBuffer) {
      console.log('\n✅ PROPER SERIALIZATION FORMAT WORKS CORRECTLY');
      console.log('\n💡 SOLUTION: Update database with properly serialized credentials');

      // Show what proper format looks like
      const sample = JSON.parse(properSerialized);
      console.log('\nProper Buffer format sample:');
      console.log(JSON.stringify(sample.noiseKey.private, null, 2));
    }

    console.log('\n\n5️⃣ FINAL DIAGNOSIS:');
    console.log('='.repeat(60));

    const issues = [];
    if (!auth_creds.identityKey) {
      issues.push('❌ Missing identityKey field (critical!)');
    }
    if (auth_creds.noiseKey && !Buffer.isBuffer(revived?.noiseKey?.private)) {
      issues.push('❌ Buffers stored in wrong format');
    }
    if (!auth_creds.account) {
      issues.push('⚠️  Missing account field');
    }

    if (issues.length > 0) {
      console.log('\n🔴 ISSUES FOUND:');
      issues.forEach(issue => console.log('  ' + issue));

      console.log('\n🔧 RECOMMENDED FIX:');
      console.log('  1. Clear current auth data from database');
      console.log('  2. Let the system generate fresh credentials');
      console.log('  3. Scan a new QR code');
      console.log('\n  Run this command:');
      console.log(`  UPDATE whatsapp_baileys_connections SET auth_creds = '{}', auth_keys = '{}' WHERE organization_id = ${organization_id};`);
    } else {
      console.log('\n✅ No issues found - credentials should work!');
    }

  } catch (error) {
    console.error('\n❌ Diagnosis failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

diagnoseAuth().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
