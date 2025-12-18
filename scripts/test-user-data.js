#!/usr/bin/env node
/**
 * Test User's Actual Data Format
 */

const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');

console.log('Testing User\'s Actual WhatsApp Data\n');
console.log('='.repeat(60));

// User's actual data structure (simplified)
const userData = {
  "noiseKey": {
    "public": {"data": "Ki8SIe4gWXCHMrK/XyjrL7geYLKzewMqzDthyOvZlXs=", "type": "Buffer"},
    "private": {"data": "gIFChVxeQrnfuYBNqccxyaecG9fH6MU7f0jRHaIQzWY=", "type": "Buffer"}
  },
  "signedIdentityKey": {
    "public": {"data": "JG5rHqK6vxJbxKsHoygMedBOolXy3qC322IelwdGIx4=", "type": "Buffer"},
    "private": {"data": "EMrQ7bYBfUcH1d+0YOhCsj/0dUot6UPYH8tC2GYWc0Y=", "type": "Buffer"}
  },
  "signedPreKey": {
    "keyPair": {
      "public": {"data": "bRPdiI9fxFEB0ZP3L1SAVImFbqrTv2pPYWSWIxKQ6Xo=", "type": "Buffer"},
      "private": {"data": "cMf/u0sztiK+4sl0/ygmd2gPgI5uGUEKeEclXFdlOEY=", "type": "Buffer"}
    },
    "signature": {"data": "PG1OSkJy6DdgINAg4B2r427nz1bdVhEP+N49/DeIwlScf/DRYaPLxNCvhGsbNMrI+lrHt5ubAGFfzyLTjwzBBQ==", "type": "Buffer"}
  },
  "registrationId": 113
};

console.log('\n1️⃣ Testing BufferJSON.reviver on user data:');
console.log('-'.repeat(60));

const serialized = JSON.stringify(userData);
const parsed = JSON.parse(serialized, BufferJSON.reviver);

console.log('noiseKey.private type:', typeof parsed.noiseKey.private);
console.log('noiseKey.private is Buffer?', Buffer.isBuffer(parsed.noiseKey.private));
console.log('noiseKey.private value:', parsed.noiseKey.private);

console.log('\n2️⃣ Checking if identityKey is missing:');
console.log('-'.repeat(60));
console.log('Has identityKey?', !!parsed.identityKey);
console.log('Has signedIdentityKey?', !!parsed.signedIdentityKey);

console.log('\n3️⃣ Generating fresh credentials for comparison:');
console.log('-'.repeat(60));
const freshCreds = initAuthCreds();
console.log('Fresh creds has identityKey?', !!freshCreds.identityKey);
console.log('Fresh identityKey.private is Buffer?', Buffer.isBuffer(freshCreds.identityKey?.private));
console.log('Fresh noiseKey.private is Buffer?', Buffer.isBuffer(freshCreds.noiseKey?.private));

console.log('\n4️⃣ Testing fresh creds serialization:');
console.log('-'.repeat(60));
const freshSerialized = JSON.stringify(freshCreds, BufferJSON.replacer);
const freshParsed = JSON.parse(freshSerialized, BufferJSON.reviver);
console.log('After serialization - noiseKey.private is Buffer?', Buffer.isBuffer(freshParsed.noiseKey.private));
console.log('After serialization - identityKey.private is Buffer?', Buffer.isBuffer(freshParsed.identityKey.private));

// Show format difference
console.log('\n5️⃣ Format comparison:');
console.log('-'.repeat(60));
console.log('User format (noiseKey.private):');
console.log(JSON.stringify(userData.noiseKey.private, null, 2));

const freshSerializedObj = JSON.parse(freshSerialized);
console.log('\nCorrect format (noiseKey.private):');
console.log(JSON.stringify(freshSerializedObj.noiseKey.private, null, 2));

console.log('\n6️⃣ Manual conversion test:');
console.log('-'.repeat(60));

// Manually convert user data to Buffers
function convertToBuffers(obj) {
  if (obj && typeof obj === 'object') {
    // Check if this is a Buffer placeholder
    if (obj.type === 'Buffer' && typeof obj.data === 'string') {
      return Buffer.from(obj.data, 'base64');
    }

    // Recursively convert nested objects
    const result = Array.isArray(obj) ? [] : {};
    for (const key in obj) {
      result[key] = convertToBuffers(obj[key]);
    }
    return result;
  }
  return obj;
}

const converted = convertToBuffers(userData);
console.log('After manual conversion - noiseKey.private is Buffer?', Buffer.isBuffer(converted.noiseKey.private));
console.log('After manual conversion - signedIdentityKey.private is Buffer?', Buffer.isBuffer(converted.signedIdentityKey.private));

// Add missing identityKey
converted.identityKey = freshCreds.identityKey;
converted.account = freshCreds.account;

console.log('\n7️⃣ Re-serialize with proper format:');
console.log('-'.repeat(60));
const correctedSerialized = JSON.stringify(converted, BufferJSON.replacer);
const correctedParsed = JSON.parse(correctedSerialized, BufferJSON.reviver);

console.log('After correction - noiseKey.private is Buffer?', Buffer.isBuffer(correctedParsed.noiseKey.private));
console.log('After correction - identityKey.private is Buffer?', Buffer.isBuffer(correctedParsed.identityKey.private));
console.log('Has all required fields?',
  !!correctedParsed.noiseKey &&
  !!correctedParsed.identityKey &&
  !!correctedParsed.signedIdentityKey &&
  !!correctedParsed.signedPreKey &&
  typeof correctedParsed.registrationId === 'number'
);

console.log('\n\n📋 DIAGNOSIS SUMMARY:');
console.log('='.repeat(60));
console.log('Issues found:');
console.log('  1. ❌ Missing identityKey field (CRITICAL)');
console.log('  2. ❌ Missing account field');
console.log('  3. ⚠️  Buffers in non-standard format (may or may not work)');
console.log('');
console.log('Recommendation:');
console.log('  Clear the database and let the system generate fresh credentials');
console.log('  OR');
console.log('  Run the fix script to add missing fields and re-serialize properly');
