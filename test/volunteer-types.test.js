/**
 * Volunteer types and requirements are listed once, in config/volunteer_shifts.json, which the
 * server and the SPA read; the database checks the same keys, and both languages name them.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config/volunteer_shifts.json');
const en = require('../lang/en.json');
const fr = require('../lang/fr.json');

// Later migrations replace a check; the last one listing a column's keys is the one in force.
const migrations = ['069_volunteer_shifts.sql', '073_member_certifications.sql']
  .map((file) => fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
/** @returns {Array<string>} The keys the latest CHECK (column IN (...)) lists */
const checked = (column) => {
  const pattern = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`);
  const match = migrations.map((sql) => sql.match(pattern)).filter(Boolean).pop();
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

test('every volunteer, whatever the type, needs a background check; a cook needs nothing more', () => {
  config.types.forEach((type) => expect(type.requirements).toContain('background_check'));
  expect(config.types.find((type) => type.key === 'cook').requirements).toEqual(['background_check']);
});

test('a background check lasts three years', () => {
  expect(config.validity_years).toEqual({ background_check: 3 });
});

test.each([['en', en], ['fr', fr]])('every type and requirement has a %s name', (_lang, messages) => {
  const keys = [
    ...config.types.map((type) => `volunteer_type_${type.key}`),
    ...config.requirements.map((key) => `volunteer_requirement_${key}`),
  ];
  expect(keys.filter((key) => !messages[key]?.trim())).toEqual([]);
});
