/**
 * Loading text is translated.
 *
 * A screen written in one language shows "Loading..." in English to every
 * French reader (CLAUDE.md §1). Loading states use translate('loading') or a
 * more precise key; no SPA markup spells the words out.
 */

const fs = require('fs');
const path = require('path');

const SPA_DIR = path.join(__dirname, '..', '..', 'spa');
// Markup text that starts with the words themselves, as in ">Loading permissions...<".
const HARDCODED = />\s*(Loading|Chargement)\b[^<{$]*</;

/**
 * @param {string} dir - Directory to walk
 * @returns {string[]} Every .js file below it
 */
function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return jsFiles(full);
    }
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('no SPA markup spells out loading text instead of translating it', () => {
  const offenders = jsFiles(SPA_DIR).flatMap((file) => fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((line, index) => ({ where: `${path.relative(SPA_DIR, file)}:${index + 1}`, line }))
    .filter(({ line }) => HARDCODED.test(line))
    .map(({ where }) => where));

  expect(offenders).toEqual([]);
});
