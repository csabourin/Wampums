#!/usr/bin/env node
/**
 * Check what initAuthCreds actually creates
 */

const { initAuthCreds } = require('@whiskeysockets/baileys');

console.log('Checking Baileys initAuthCreds() output\n');
console.log('='.repeat(60));

const creds = initAuthCreds();

console.log('\nTop-level fields:');
console.log(Object.keys(creds).sort());

console.log('\n\nDetailed structure:');
console.log('-'.repeat(60));

for (const key of Object.keys(creds).sort()) {
  const value = creds[key];
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    console.log(`\n${key}:`);
    console.log('  Type: object');
    console.log('  Keys:', Object.keys(value).join(', '));
  } else if (Buffer.isBuffer(value)) {
    console.log(`\n${key}:`);
    console.log('  Type: Buffer');
    console.log('  Length:', value.length);
  } else {
    console.log(`\n${key}:`, value, `(${typeof value})`);
  }
}

console.log('\n\n' + '='.repeat(60));
console.log('KEY FINDINGS:');
console.log('='.repeat(60));
console.log('Has noiseKey?', !!creds.noiseKey);
console.log('Has identityKey?', !!creds.identityKey);
console.log('Has signedIdentityKey?', !!creds.signedIdentityKey);
console.log('Has signedPreKey?', !!creds.signedPreKey);
console.log('Has account?', !!creds.account);
console.log('Has registrationId?', !!creds.registrationId);

console.log('\n💡 Conclusion:');
if (!creds.identityKey && creds.signedIdentityKey) {
  console.log('   Baileys does NOT create "identityKey" - only "signedIdentityKey"!');
  console.log('   The validation code checking for identityKey is WRONG.');
} else if (creds.identityKey) {
  console.log('   Baileys DOES create "identityKey"');
}
