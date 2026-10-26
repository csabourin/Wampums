/**
 * The equipment catalogue's fixed lists: the database constraints of
 * migration 054 accept exactly the categories and units the server validates
 * and the SPA offers (config/equipment_categories.json, config/equipment_units.json).
 *
 * @module test/equipment-catalog-config
 */
const fs = require('fs');
const path = require('path');
const { categories } = require('../config/equipment_categories.json');
const { units } = require('../config/equipment_units.json');

const MIGRATION = fs.readFileSync(path.join(__dirname, '../migrations/054_equipment_catalog.sql'), 'utf8');

/**
 * @param {string} column
 * @returns {string[]} The values its CHECK constraint lists
 */
function checkedValues(column) {
  const list = MIGRATION.match(new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`))[1];
  return [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

test('the catalogue accepts in the database exactly the categories offered', () => {
  expect(checkedValues('category')).toEqual(categories);
});

test('the catalogue accepts in the database exactly the units of measure offered', () => {
  expect(checkedValues('unit_of_measure')).toEqual(units);
});
