/**
 * Pages linked from the app shell must ship with the build.
 *
 * The privacy policy sat at the repository root, which Vite does not copy:
 * production served the app shell for its URL, and the link opened an empty
 * page. Only `index.html` and Vite's `publicDir` reach `dist/`.
 *
 * @module test/static-pages
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = 'assets';

test('every root-relative .html link in the app shell is a file the build publishes', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const config = fs.readFileSync(path.join(ROOT, 'vite.config.mjs'), 'utf8');
  expect(config).toMatch(new RegExp(`publicDir:\\s*["']${PUBLIC_DIR}["']`));

  const links = [...shell.matchAll(/href="\/([^"?#]+\.html)"/g)].map((match) => match[1]);
  expect(links).toContain('politique-de-confidentialite.html');
  links.forEach((link) => {
    expect(fs.existsSync(path.join(ROOT, PUBLIC_DIR, link))).toBe(true);
  });
});
