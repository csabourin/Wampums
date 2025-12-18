#!/usr/bin/env node
/**
 * Test if credentials are being saved during pairing
 * Monitors the creds.update event
 */

const { Pool } = require('pg');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  BufferJSON,
  initAuthCreds
} = require('@whiskeysockets/baileys');
const winston = require('winston');
require('dotenv').config();

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [new winston.transports.Console({ format: winston.format.simple() })]
});
logger.trace = (...args) => logger.debug(...args);

async function testCredentialSaving() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔍 Testing Credential Saving During Pairing\n');
    console.log('='.repeat(60));

    const organizationId = 1;

    // Clear existing data first
    console.log('\n1️⃣ Clearing existing credentials...');
    await pool.query(
      `UPDATE whatsapp_baileys_connections
       SET auth_creds = '{}', auth_keys = '{}', is_connected = FALSE
       WHERE organization_id = $1`,
      [organizationId]
    );
    console.log('✅ Cleared');

    // Create fresh credentials
    console.log('\n2️⃣ Creating fresh credentials...');
    const freshCreds = initAuthCreds();
    console.log('✅ Fresh credentials created');
    console.log('   registrationId:', freshCreds.registrationId);

    // Save fresh creds to database
    const serializedCreds = JSON.stringify(freshCreds, BufferJSON.replacer);
    await pool.query(
      `INSERT INTO whatsapp_baileys_connections (organization_id, auth_creds, auth_keys, updated_at)
       VALUES ($1, $2, '{}', NOW())
       ON CONFLICT (organization_id)
       DO UPDATE SET auth_creds = $2, auth_keys = '{}', updated_at = NOW()`,
      [organizationId, serializedCreds]
    );
    console.log('✅ Saved to database');

    // Create saveCreds function with logging
    let credsUpdateCount = 0;
    const saveCreds = async (creds) => {
      credsUpdateCount++;
      console.log(`\n📝 CREDS UPDATE #${credsUpdateCount}`);
      console.log('   Time:', new Date().toISOString());
      console.log('   Keys in creds:', Object.keys(creds).join(', '));

      if (creds.me) {
        console.log('   ✅ ME FIELD PRESENT:', creds.me);
      }
      if (creds.account) {
        console.log('   ✅ ACCOUNT FIELD PRESENT');
      }

      try {
        const serialized = JSON.stringify(creds, BufferJSON.replacer);
        await pool.query(
          `INSERT INTO whatsapp_baileys_connections (organization_id, auth_creds, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (organization_id)
           DO UPDATE SET auth_creds = $2, updated_at = NOW()`,
          [organizationId, serialized]
        );
        console.log('   ✅ Saved to database successfully');
      } catch (error) {
        console.log('   ❌ ERROR SAVING:', error.message);
      }
    };

    // Create key store with logging
    const keyStore = {
      get: async (type, ids) => {
        console.log(`   🔑 Key GET: ${type}, ids: ${ids.length}`);
        return {};
      },
      set: async (data) => {
        const types = Object.keys(data);
        console.log(`\n🔑 KEY UPDATE: ${types.join(', ')}`);

        for (const type of types) {
          const count = Object.keys(data[type]).length;
          console.log(`   - ${type}: ${count} keys`);
        }

        try {
          // Load existing keys
          const result = await pool.query(
            `SELECT auth_keys FROM whatsapp_baileys_connections WHERE organization_id = $1`,
            [organizationId]
          );

          let existingKeys = {};
          if (result.rows.length > 0 && result.rows[0].auth_keys) {
            const parsed = typeof result.rows[0].auth_keys === 'string'
              ? JSON.parse(result.rows[0].auth_keys, BufferJSON.reviver)
              : result.rows[0].auth_keys;
            existingKeys = parsed || {};
          }

          // Merge with new keys
          for (const type in data) {
            if (!existingKeys[type]) {
              existingKeys[type] = {};
            }
            for (const id in data[type]) {
              const value = data[type][id];
              if (value === null || value === undefined) {
                delete existingKeys[type][id];
              } else {
                existingKeys[type][id] = value;
              }
            }
          }

          const serialized = JSON.stringify(existingKeys, BufferJSON.replacer);
          await pool.query(
            `INSERT INTO whatsapp_baileys_connections (organization_id, auth_keys, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (organization_id)
             DO UPDATE SET auth_keys = $2, updated_at = NOW()`,
            [organizationId, serialized]
          );
          console.log('   ✅ Keys saved to database');
        } catch (error) {
          console.log('   ❌ ERROR SAVING KEYS:', error.message);
        }
      }
    };

    // Create socket
    console.log('\n3️⃣ Creating WhatsApp socket...');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: freshCreds,
        keys: makeCacheableSignalKeyStore(keyStore, logger),
      },
      logger: logger,
      browser: ['Wampums Test', 'Chrome', '10.0'],
      getMessage: async (key) => {
        return { conversation: '' };
      }
    });

    console.log('✅ Socket created');

    // Monitor events
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      console.log('\n📡 CONNECTION UPDATE');
      console.log('   Time:', new Date().toISOString());
      console.log('   Connection:', update.connection);
      console.log('   QR:', update.qr ? 'PRESENT' : 'none');

      if (update.lastDisconnect) {
        console.log('   LastDisconnect:', JSON.stringify(update.lastDisconnect, null, 2));
      }
    });

    console.log('\n⏳ Waiting 30 seconds for QR scan and pairing...');
    console.log('   Please scan the QR code when it appears\n');

    await new Promise((resolve) => {
      setTimeout(async () => {
        console.log('\n\n📊 FINAL RESULTS');
        console.log('='.repeat(60));
        console.log('Credentials updates received:', credsUpdateCount);

        // Check what was saved
        const result = await pool.query(
          `SELECT auth_creds, auth_keys FROM whatsapp_baileys_connections WHERE organization_id = $1`,
          [organizationId]
        );

        if (result.rows.length > 0) {
          const { auth_creds, auth_keys } = result.rows[0];
          const creds = typeof auth_creds === 'string'
            ? JSON.parse(auth_creds, BufferJSON.reviver)
            : auth_creds;

          console.log('\nSaved credentials contain:');
          console.log('   - me:', creds.me ? `✅ ${creds.me.id}` : '❌ MISSING');
          console.log('   - account:', creds.account ? '✅ Present' : '❌ MISSING');
          console.log('   - registered:', creds.registered);
          console.log('   - registrationId:', creds.registrationId);

          const keys = typeof auth_keys === 'string'
            ? JSON.parse(auth_keys, BufferJSON.reviver)
            : auth_keys;

          console.log('\nSaved keys contain:');
          for (const type in keys) {
            const count = Object.keys(keys[type]).length;
            console.log(`   - ${type}: ${count} keys`);
          }
        }

        sock.end();
        resolve();
      }, 30000);
    });

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

testCredentialSaving().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
