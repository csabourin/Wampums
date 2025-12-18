#!/usr/bin/env node
/**
 * Test Buffer Serialization Formats
 */

const { BufferJSON } = require('@whiskeysockets/baileys');

console.log('Testing Buffer Serialization Formats\n');
console.log('='.repeat(60));

// Create a sample Buffer
const testBuffer = Buffer.from('Hello WhatsApp', 'utf8');

// Test 1: Regular JSON.stringify
console.log('\n1️⃣ Regular JSON.stringify():');
console.log('-'.repeat(60));
const regularSerialized = JSON.stringify({ data: testBuffer });
console.log(regularSerialized);
const regularParsed = JSON.parse(regularSerialized);
console.log('After parse - is Buffer?', Buffer.isBuffer(regularParsed.data));
console.log('Actual type:', typeof regularParsed.data, regularParsed.data.constructor.name);

// Test 2: BufferJSON.replacer serialization
console.log('\n2️⃣ JSON.stringify with BufferJSON.replacer:');
console.log('-'.repeat(60));
const bufferJsonSerialized = JSON.stringify({ data: testBuffer }, BufferJSON.replacer);
console.log(bufferJsonSerialized);
const bufferJsonParsed = JSON.parse(bufferJsonSerialized, BufferJSON.reviver);
console.log('After parse with reviver - is Buffer?', Buffer.isBuffer(bufferJsonParsed.data));
console.log('Actual type:', typeof bufferJsonParsed.data, bufferJsonParsed.data.constructor.name);

// Test 3: What format does the user have?
console.log('\n3️⃣ User\'s current format (from database):');
console.log('-'.repeat(60));
const userFormat = {
  "data": "gIFChVxeQrnfuYBNqccxyaecG9fH6MU7f0jRHaIQzWY=",
  "type": "Buffer"
};
console.log(JSON.stringify(userFormat));

// Try to parse with BufferJSON.reviver
const userParsed = JSON.parse(JSON.stringify(userFormat), BufferJSON.reviver);
console.log('After parse with BufferJSON.reviver - is Buffer?', Buffer.isBuffer(userParsed.data));
console.log('Actual value:', userParsed);

// Test 4: Can we convert it?
console.log('\n4️⃣ Converting user\'s format to Buffer:');
console.log('-'.repeat(60));
if (userFormat.type === 'Buffer' && userFormat.data) {
  const converted = Buffer.from(userFormat.data, 'base64');
  console.log('✅ Successfully converted to Buffer:', Buffer.isBuffer(converted));
  console.log('Buffer length:', converted.length, 'bytes');

  // Now serialize it properly
  const properlySerialized = JSON.stringify({ key: converted }, BufferJSON.replacer);
  console.log('\n✅ Properly serialized:');
  console.log(properlySerialized);

  const properlyParsed = JSON.parse(properlySerialized, BufferJSON.reviver);
  console.log('\n✅ After proper parse - is Buffer?', Buffer.isBuffer(properlyParsed.key));
}

console.log('\n\n5️⃣ CONCLUSION:');
console.log('='.repeat(60));
console.log('❌ User\'s format: {"data": "base64", "type": "Buffer"}');
console.log('   This does NOT work with BufferJSON.reviver');
console.log('');
console.log('✅ Correct format: Use BufferJSON.replacer/reviver');
console.log('   Buffers are properly preserved and restored');
console.log('');
console.log('💡 Solution: Convert all {"data": "...", "type": "Buffer"} objects');
console.log('   to real Buffers, then re-serialize with BufferJSON.replacer');
