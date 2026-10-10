/**
 * Cache-Control for static files: only content-addressed URLs are immutable.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { staticCacheControl } = require('../utils/static-cache');
const { contentVersion } = require('../utils/asset-version');

const IMMUTABLE = 'public, max-age=31536000, immutable';

describe('staticCacheControl (production)', () => {
  // A served directory whose own path contains dashes, like a deploy checkout:
  // the old rule made every .js/.css under such a path immutable.
  let staticRoot;
  let frenchBundle;

  beforeAll(() => {
    staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wampums-app-1-'));
    fs.mkdirSync(path.join(staticRoot, 'lang'));
    frenchBundle = path.join(staticRoot, 'lang', 'fr.json');
    fs.writeFileSync(frenchBundle, '{"hello":"bonjour"}');
  });

  afterAll(() => {
    fs.rmSync(staticRoot, { recursive: true, force: true });
  });

  const header = (relativePath, requestedVersion) => staticCacheControl({
    filePath: path.join(staticRoot, relativePath),
    staticRoot,
    isProduction: true,
    requestedVersion,
  });

  test('hashed build output is immutable', () => {
    expect(header('assets/core-ByHUaX1_.js')).toBe(IMMUTABLE);
    expect(header('assets/main-qclXTD5P.css')).toBe(IMMUTABLE);
    expect(header('assets/fa-solid-900-Iz_TytpP.woff2')).toBe(IMMUTABLE);
  });

  test('unhashed scripts and stylesheets are revalidated, even with a dash in the name', () => {
    expect(header('src-sw.js')).toBe('no-cache');
    expect(header('registerSW.js')).toBe('no-cache');
    expect(header('css/dashboard-v2.css')).toBe('no-cache');
    expect(header('manifest.webmanifest')).toBe('no-cache');
  });

  test('a translation bundle is immutable only for the version of the file served', () => {
    const version = contentVersion(fs.readFileSync(frenchBundle));
    expect(header('lang/fr.json', version)).toBe(IMMUTABLE);
    expect(header('lang/fr.json', 'stale0000000')).toBe('no-cache');
    expect(header('lang/fr.json', undefined)).toBe('no-cache');
    expect(header('lang/fr.json', ['a', 'b'])).toBe('no-cache');
  });

  test('a changed translation bundle stops matching its old version', () => {
    const before = contentVersion(fs.readFileSync(frenchBundle));
    const later = new Date(Date.now() + 60000);
    fs.writeFileSync(frenchBundle, '{"hello":"salut"}');
    fs.utimesSync(frenchBundle, later, later);
    expect(header('lang/fr.json', before)).toBe('no-cache');
  });

  test('images and fonts outside the build output are cached for 30 days', () => {
    expect(header('images/icon-192x192.png')).toBe('public, max-age=2592000');
  });
});

describe('staticCacheControl (development)', () => {
  test('scripts and stylesheets are never stored', () => {
    expect(staticCacheControl({
      filePath: '/repo/spa/app.js', staticRoot: '/repo', isProduction: false,
    })).toBe('no-cache, no-store, must-revalidate');
  });

  test('other files keep the default header', () => {
    expect(staticCacheControl({
      filePath: '/repo/lang/fr.json', staticRoot: '/repo', isProduction: false,
    })).toBeNull();
  });
});
