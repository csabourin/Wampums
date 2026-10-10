/**
 * Content versions for static files whose URLs carry no build hash
 * (translation bundles under /lang/).
 *
 * The build stamps each bundle's version into the SPA, which requests
 * `/lang/<code>.json?v=<version>`. The server answers a request whose version
 * matches the file on disk as immutable, so a returning visitor reads the
 * translations from cache instead of waiting a round trip, and a new build,
 * whose bundles have new versions, can never be paired with old keys.
 *
 * Shared by vite.config.mjs (build time) and middleware/global.js (serving),
 * so both compute the same value.
 */
const crypto = require('crypto');
const fs = require('fs');

const VERSION_LENGTH = 12;

/**
 * Version of some content: the start of its SHA-256 digest.
 *
 * @param {Buffer|string} content - File content
 * @returns {string} Hex version string
 */
function contentVersion(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, VERSION_LENGTH);
}

const fileVersionCache = new Map();

/**
 * Version of a file on disk, recomputed only when its size or mtime changes.
 *
 * @param {string} filePath - Absolute path
 * @param {import("fs").Stats} [stat] - Stats already read by the caller
 * @returns {string|null} Version, or null when the file cannot be read
 */
function fileVersion(filePath, stat) {
  try {
    const stats = stat || fs.statSync(filePath);
    const stamp = `${stats.size}:${stats.mtimeMs}`;
    const cached = fileVersionCache.get(filePath);
    if (cached && cached.stamp === stamp) {
      return cached.version;
    }
    const version = contentVersion(fs.readFileSync(filePath));
    fileVersionCache.set(filePath, { stamp, version });
    return version;
  } catch {
    return null;
  }
}

module.exports = { contentVersion, fileVersion };
