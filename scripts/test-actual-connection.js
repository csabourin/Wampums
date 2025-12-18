#!/usr/bin/env node
/**
 * Test the actual database loading and socket creation process
 * This simulates what happens when WhatsApp tries to connect
 */

const { Pool } = require('pg');
const { BufferJSON, initAuthCreds, makeWASocket, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const winston = require('winston');
require('dotenv').config();

// Configure logger like the actual service
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() })
  ],
});
logger.trace = (...args) => logger.debug(...args);

async function testActualConnection() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔍 Testing Actual WhatsApp Connection Process\n');
    console.log('='.repeat(60));

    const organizationId = 1; // Assuming org ID 1

    // Step 1: Load from database (exactly as the service does)
    console.log('\n1️⃣ Loading auth state from database...');
    console.log('-'.repeat(60));

    const result = await pool.query(
      `SELECT auth_creds, auth_keys FROM whatsapp_baileys_connections WHERE organization_id = $1`,
      [organizationId]
    );

    if (result.rows.length === 0) {
      console.log('❌ No data found for organization', organizationId);
      return;
    }

    const { auth_creds, auth_keys } = result.rows[0];
    console.log('✅ Data loaded from database');
    console.log('auth_creds type:', typeof auth_creds);
    console.log('auth_keys type:', typeof auth_keys);

    // Step 2: Parse with BufferJSON.reviver (as the service does)
    console.log('\n2️⃣ Parsing credentials with BufferJSON.reviver...');
    console.log('-'.repeat(60));

    const reviveBaileysJson = (value, fallback) => {
      if (!value) return fallback;
      try {
        const serialized = typeof value === "string" ? value : JSON.stringify(value);
        return JSON.parse(serialized, BufferJSON.reviver);
      } catch (error) {
        console.error('Error reviving:', error);
        return fallback;
      }
    };

    const revivedCreds = reviveBaileysJson(auth_creds, initAuthCreds());
    const revivedKeys = reviveBaileysJson(auth_keys, {});

    console.log('✅ Credentials parsed');
    console.log('noiseKey.private is Buffer?', Buffer.isBuffer(revivedCreds?.noiseKey?.private));
    console.log('signedIdentityKey.private is Buffer?', Buffer.isBuffer(revivedCreds?.signedIdentityKey?.private));
    console.log('signedPreKey.keyPair.private is Buffer?', Buffer.isBuffer(revivedCreds?.signedPreKey?.keyPair?.private));

    // Step 3: Validate (with FIXED validation)
    console.log('\n3️⃣ Validating credentials...');
    console.log('-'.repeat(60));

    const baseCreds = initAuthCreds();
    const merged = {
      ...baseCreds,
      ...revivedCreds,
      noiseKey: revivedCreds?.noiseKey || baseCreds.noiseKey,
      signedIdentityKey: revivedCreds?.signedIdentityKey || baseCreds.signedIdentityKey,
      signedPreKey: revivedCreds?.signedPreKey || baseCreds.signedPreKey,
    };

    const hasRequiredKeys = Boolean(
      merged?.noiseKey?.private &&
      merged?.noiseKey?.public &&
      merged?.signedIdentityKey?.private &&
      merged?.signedIdentityKey?.public &&
      merged?.signedPreKey?.keyPair?.private &&
      merged?.signedPreKey?.keyPair?.public &&
      typeof merged?.registrationId === 'number'
    );

    console.log('Validation result:', hasRequiredKeys ? '✅ PASS' : '❌ FAIL');
    console.log('registrationId:', merged.registrationId);

    if (!hasRequiredKeys) {
      console.log('\n⚠️ Validation failed - credentials would be reset');
      console.log('   Testing with fresh credentials instead...');
      const finalCreds = initAuthCreds();
      console.log('   Fresh registrationId:', finalCreds.registrationId);
    }

    const finalCreds = hasRequiredKeys ? merged : initAuthCreds();

    // Step 4: Create key store
    console.log('\n4️⃣ Creating key store...');
    console.log('-'.repeat(60));

    const makeKeyStore = (initialKeys) => {
      let keysCache = initialKeys;
      return {
        get: async (type, ids) => {
          const data = {};
          const keys = keysCache[type] || {};
          for (const id of ids) {
            let value = keys[id];
            if (value !== undefined) {
              if (typeof value === 'string') {
                value = JSON.parse(value, BufferJSON.reviver);
              } else {
                value = JSON.parse(JSON.stringify(value), BufferJSON.reviver);
              }
              data[id] = value;
            }
          }
          return data;
        },
        set: async (data) => {
          for (const type in data) {
            if (!keysCache[type]) {
              keysCache[type] = {};
            }
            for (const id in data[type]) {
              const value = data[type][id];
              if (value === null || value === undefined) {
                delete keysCache[type][id];
              } else {
                keysCache[type][id] = value;
              }
            }
          }
        }
      };
    };

    const keyStore = makeKeyStore(revivedKeys);
    console.log('✅ Key store created');

    // Step 5: Try to create socket
    console.log('\n5️⃣ Attempting to create WhatsApp socket...');
    console.log('-'.repeat(60));

    try {
      const { version } = await fetchLatestBaileysVersion();
      console.log('✅ Fetched Baileys version:', version.join('.'));

      console.log('\nCreating socket with:');
      console.log('  - creds.registrationId:', finalCreds.registrationId);
      console.log('  - creds.noiseKey exists:', !!finalCreds.noiseKey);
      console.log('  - creds.signedIdentityKey exists:', !!finalCreds.signedIdentityKey);
      console.log('  - creds.signedPreKey exists:', !!finalCreds.signedPreKey);

      const sock = makeWASocket({
        version,
        auth: {
          creds: finalCreds,
          keys: makeCacheableSignalKeyStore(keyStore, logger),
        },
        logger: logger,
        browser: ['Wampums', 'Chrome', '10.0'],
        getMessage: async (key) => {
          return { conversation: '' };
        }
      });

      console.log('\n✅ Socket created successfully!');
      console.log('   Waiting for QR code or connection...\n');

      // Listen for connection updates
      let qrReceived = false;
      let connectionEstablished = false;
      let errorOccurred = false;

      sock.ev.on('connection.update', (update) => {
        console.log('\n📡 Connection update:', JSON.stringify(update, null, 2));

        if (update.qr) {
          qrReceived = true;
          console.log('✅ QR code generated!');
          console.log('   Length:', update.qr.length);
        }

        if (update.connection === 'open') {
          connectionEstablished = true;
          console.log('✅ Connection established!');
        }

        if (update.connection === 'close') {
          console.log('❌ Connection closed');
          if (update.lastDisconnect) {
            console.log('   Reason:', JSON.stringify(update.lastDisconnect, null, 2));
          }
          errorOccurred = true;
        }
      });

      sock.ev.on('creds.update', () => {
        console.log('📝 Credentials updated');
      });

      // Wait for events
      await new Promise((resolve) => {
        setTimeout(() => {
          console.log('\n\n📊 RESULTS AFTER 10 SECONDS:');
          console.log('='.repeat(60));
          console.log('QR code received:', qrReceived ? '✅ YES' : '❌ NO');
          console.log('Connection established:', connectionEstablished ? '✅ YES' : '❌ NO');
          console.log('Error occurred:', errorOccurred ? '⚠️ YES' : '✅ NO');

          if (!qrReceived && !connectionEstablished) {
            console.log('\n🔴 PROBLEM: Neither QR nor connection was established');
            console.log('   This suggests an issue with credential format or socket creation');
          } else if (qrReceived && !connectionEstablished) {
            console.log('\n✅ QR code was generated - scanning should work!');
          }

          sock.end();
          resolve();
        }, 10000);
      });

    } catch (socketError) {
      console.log('\n❌ Error creating socket:');
      console.error(socketError);
      console.log('\nStack trace:');
      console.error(socketError.stack);
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

testActualConnection().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
