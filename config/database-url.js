'use strict';

/**
 * Resolve the PostgreSQL URL while deployments transition away from SB_URL.
 * DATABASE_URL is canonical; SB_URL remains a compatibility fallback and can
 * be removed only after deployed environments have migrated.
 *
 * @param {NodeJS.ProcessEnv|Object} [environment=process.env] - Environment variables
 * @returns {string|undefined} Configured PostgreSQL connection URL
 */
function resolveDatabaseConnectionString(environment = process.env) {
  return environment.DATABASE_URL || environment.SB_URL || undefined;
}

module.exports = { resolveDatabaseConnectionString };
