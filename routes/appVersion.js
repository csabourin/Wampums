/**
 * App version / build identity.
 *
 * The SPA polls this to detect that it is running against a different build
 * than the one its cached assets came from — the situation that leaves users
 * stranded behind a stale service worker after the app moves to a new host.
 * It is deliberately unauthenticated and dependency-free so a client whose
 * bundle is half-broken can still reach it.
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { success } = require('../middleware/response');
const logger = require('../config/logger');

const { version: packageVersion } = require('../package.json');

const BUILD_HASH_LENGTH = 12;

/**
 * Fingerprint the built app shell.
 *
 * `dist/index.html` names every hashed JS/CSS entry the client loads, so its
 * digest changes exactly when the client bundle changes and stays identical
 * across restarts and replicas. That is what makes it safe to reload on: a
 * value derived from process start time would differ between replicas and
 * could bounce a user between them in a reload loop.
 *
 * @returns {string|null} Short digest of the built shell, or null in dev where
 *   no build exists.
 */
function hashBuiltShell() {
  try {
    const indexPath = path.join(process.cwd(), 'dist', 'index.html');
    const contents = fs.readFileSync(indexPath);
    return crypto
      .createHash('sha256')
      .update(contents)
      .digest('hex')
      .slice(0, BUILD_HASH_LENGTH);
  } catch (error) {
    logger.info(`[app-version] No built shell to fingerprint: ${error.code || error.message}`);
    return null;
  }
}

/**
 * Identifier for the currently running build.
 *
 * Resolution order:
 *   1. `FORCE_CLIENT_REFRESH` — operator escape hatch. Setting (or changing)
 *      this env var pushes every client through a cache purge and reload on
 *      their next load, with no code change or redeploy of the SPA needed.
 *   2. A digest of the built app shell.
 *   3. The commit SHA, when the platform exposes one.
 *   4. The package version, so the endpoint always answers with something.
 */
const BUILD_ID =
  process.env.FORCE_CLIENT_REFRESH ||
  hashBuiltShell() ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.BUILD_ID ||
  `dev-${packageVersion}`;

module.exports = () => {
  const router = express.Router();

  router.get('/', (req, res) => {
    // Must never be cached: a cached answer defeats the whole mechanism.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return success(res, {
      version: packageVersion,
      build_id: BUILD_ID,
    });
  });

  return router;
};

module.exports.BUILD_ID = BUILD_ID;
