/**
 * check-i18n-parity.js
 *
 * Ensures lang/en.json and lang/fr.json have exactly the same set of keys.
 * Used in CI / npm scripts to catch drift before merge.
 */

const fs = require('fs');
const path = require('path');

function loadKeys(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(data) || typeof data !== 'object' || data === null) {
    throw new Error(`Expected flat object in ${file}`);
  }
  return new Set(Object.keys(data));
}

function check() {
  const en = loadKeys(path.join(__dirname, '../../lang/en.json'));
  const fr = loadKeys(path.join(__dirname, '../../lang/fr.json'));

  const onlyEn = [...en].filter((k) => !fr.has(k)).sort();
  const onlyFr = [...fr].filter((k) => !en.has(k)).sort();

  if (onlyEn.length === 0 && onlyFr.length === 0) {
    console.log(`i18n parity OK — ${en.size} keys in each.`);
    return 0;
  }

  if (onlyEn.length > 0) {
    console.error(`Missing in fr.json (${onlyEn.length} keys):`);
    for (const k of onlyEn) console.error(`  - ${k}`);
  }
  if (onlyFr.length > 0) {
    console.error(`Missing in en.json (${onlyFr.length} keys):`);
    for (const k of onlyFr) console.error(`  - ${k}`);
  }
  return 1;
}

process.exit(check());
