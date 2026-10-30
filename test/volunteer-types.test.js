/**
 * Volunteer types and requirements are listed once, in config/volunteer_shifts.json, which the
 * server and the SPA read; the database checks the same keys, and both languages name them.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config/volunteer_shifts.json');
const en = require('../lang/en.json');
const fr = require('../lang/fr.json');

const migration = fs.readFileSync(path.join(__dirname, '../migrations/069_volunteer_shifts.sql'), 'utf8');
/** @returns {Array<string>} The keys a CHECK (column IN (...)) lists in the migration */
const checked = (column) => {
  const match = migration.match(new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`));
  return match[1].split(',').map((item) => item.trim().replace(/'/g, ''));
};

test('the database accepts exactly the volunteer types the configuration lists', () => {
  expect(checked('volunteer_type').sort()).toEqual(config.types.map((type) => type.key).sort());
});

test('the database accepts exactly the requirements the configuration lists', () => {
  expect(checked('requirement_key').sort()).toEqual([...config.requirements].sort());
});

test('every type requires only listed requirements, and "other" exists for anything else', () => {
  config.types.forEach((type) => type.requirements.forEach((key) => expect(config.requirements).toContain(key)));
  expect(config.types.map((type) => type.key)).toContain('other');
});

test('a camp aide is not confirmed without a background check; a cook needs nothing to verify', () => {
  const requirementsOf = (key) => config.types.find((type) => type.key === key).requirements;
  expect(requirementsOf('camp_aide')).toContain('background_check');
  expect(requirementsOf('cook')).toEqual([]);
});

test.each([['en', en], ['fr', fr]])('every type and requirement has a %s name', (_lang, messages) => {
  const keys = [
    ...config.types.map((type) => `volunteer_type_${type.key}`),
    ...config.requirements.map((key) => `volunteer_requirement_${key}`),
  ];
  expect(keys.filter((key) => !messages[key]?.trim())).toEqual([]);
});
