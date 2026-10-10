/**
 * Cache-Control for files served by express.static.
 *
 * Only a URL whose content can never change may be cached for good: Vite's
 * content-hashed build output, and a translation bundle requested with the
 * version of the file being served. Everything else that the app's code
 * depends on -- the service worker script, unhashed stylesheets, translation
 * bundles without a matching version -- must be revalidated, or a deploy
 * leaves browsers running new code against old files (or the reverse).
 */
const path = require('path');
const { fileVersion } = require('./asset-version');

const ONE_YEAR_SECONDS = 31536000;
const THIRTY_DAYS_SECONDS = 2592000;

const IMMUTABLE = `public, max-age=${ONE_YEAR_SECONDS}, immutable`;
const REVALIDATE = 'no-cache';
const DEVELOPMENT_NO_STORE = 'no-cache, no-store, must-revalidate';

/** Vite build output: `assets/<name>-<8-char hash>.<ext>` */
const HASHED_BUILD_ASSET = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;
const TRANSLATION_BUNDLE = /[\\/]lang[\\/][^\\/]+\.json$/;
const LONG_LIVED_MEDIA = /\.(png|jpe?g|webp|gif|svg|ico|woff2?)$/i;
const CODE_OR_STYLE = /\.(m?js|css)$/i;

/**
 * Pick the Cache-Control header for a static file.
 *
 * @param {Object} options
 * @param {string} options.filePath - Absolute path of the file being served
 * @param {string} options.staticRoot - Directory express.static serves
 * @param {boolean} options.isProduction - Serving the built `dist/`
 * @param {string|undefined} options.requestedVersion - The request's `v` query value
 * @param {import("fs").Stats} [options.stat] - File stats from express.static
 * @returns {string|null} Header value, or null to keep express.static's default
 */
function staticCacheControl({ filePath, staticRoot, isProduction, requestedVersion, stat }) {
  if (!isProduction) {
    return CODE_OR_STYLE.test(filePath) ? DEVELOPMENT_NO_STORE : null;
  }

  // Match against the path inside the served directory, so the server's own
  // location (e.g. a checkout under ".../my-app-1/") cannot look like a hash.
  const relativePath = `${path.sep}${path.relative(staticRoot, filePath)}`;

  if (HASHED_BUILD_ASSET.test(relativePath)) {
    return IMMUTABLE;
  }

  if (TRANSLATION_BUNDLE.test(relativePath)) {
    const matchesFile = typeof requestedVersion === 'string'
      && requestedVersion.length > 0
      && requestedVersion === fileVersion(filePath, stat);
    return matchesFile ? IMMUTABLE : REVALIDATE;
  }

  if (LONG_LIVED_MEDIA.test(relativePath)) {
    return `public, max-age=${THIRTY_DAYS_SECONDS}`;
  }

  return REVALIDATE;
}

module.exports = { staticCacheControl };
