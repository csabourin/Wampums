/** New SQL catalog declarations must be recognisable in the roles matrix, even without PostgreSQL. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'migrations')).filter((file) => file.endsWith('.sql'))
  .map((file) => path.join(root, 'migrations', file));
files.push(path.join(root, 'attached_assets/permissions_list.sql'));
const declarations = files.flatMap((file) => [...fs.readFileSync(file, 'utf8')
  .matchAll(/'([a-z_]+\.[a-z_]+)'\s*,\s*'[^']*'\s*,\s*'([a-z_]+)'/g)]
  .map((match) => ({ key: match[1], category: match[2] })));

test.each(['en', 'fr'])('SQL permission declarations have permission and category labels in %s', (language) => {
  const labels = JSON.parse(fs.readFileSync(path.join(root, 'lang', `${language}.json`), 'utf8'));
  expect(declarations.length).toBeGreaterThan(0);
  const missing = declarations.flatMap(({ key, category }) => [
    `role_permission_${key.replaceAll('.', '_')}`, `role_category_${category}`,
  ]).filter((key) => !labels[key]?.trim());
  expect([...new Set(missing)]).toEqual([]);
});
