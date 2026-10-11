/**
 * Optional interface languages (uk, it, id) may be partial, but what they do
 * translate must work: the same {placeholders} as English, so the code that
 * fills them finds them, and no double-encoded text ("UnitÃ " for "Unità").
 */

const fs = require('fs');
const path = require('path');
const config = require('../config/interface_languages.json');

const read = (code) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lang', `${code}.json`), 'utf8'));
const placeholders = (text) => (String(text).match(/\{\{?[^{}\s]+\}?\}/g) || []).sort();
const en = read('en');

describe.each(config.optional)('lang/%s.json', (code) => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'lang', `${code}.json`), 'utf8');
  const bundle = read(code);

  it('has no byte-order mark', () => {
    expect(raw.charCodeAt(0)).not.toBe(0xFEFF);
  });

  it('keeps every placeholder of the English text', () => {
    const mismatched = Object.keys(bundle)
      .filter((key) => key in en)
      .filter((key) => placeholders(en[key]).join('|') !== placeholders(bundle[key]).join('|'));
    expect(mismatched).toEqual([]);
  });

  it('has no double-encoded text', () => {
    const garbled = Object.entries(bundle)
      .filter(([, value]) => /Ã|â€|Â|�/.test(String(value)))
      .map(([key]) => key);
    expect(garbled).toEqual([]);
  });
});
