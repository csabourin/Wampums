/**
 * Shared test helper utilities
 * 
 * This module provides common utilities for test setup and teardown
 * to reduce code duplication across test files.
 */

/**
 * Check if the current environment is a test environment
 * Used to skip initialization of background services, listeners, and other
 * resources that would prevent Jest from exiting cleanly
 * 
 * @returns {boolean} True if running in test environment
 * 
 * @example
 * ```javascript
 * if (isTestEnvironment()) {
 *   console.log('Skipping service initialization in tests');
 *   return;
 * }
 * ```
 */
function isTestEnvironment() {
  return process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
}

/**
 * Close server and socket.io resources after tests complete
 * Prevents Jest from hanging by ensuring all async operations are terminated
 * 
 * @param {Object} app - The Express app instance with server and io properties
 * @param {Function} done - Jest done callback
 * 
 * @example
 * ```javascript
 * afterAll((done) => {
 *   closeServerResources(app, done);
 * });
 * ```
 */
function closeServerResources(app, done) {
  // Close server and socket.io to prevent hanging
  if (app && app.server) {
    app.server.close(() => {
      if (app.io) {
        app.io.close();
      }
      done();
    });
  } else {
    done();
  }
}

module.exports = {
  isTestEnvironment,
  closeServerResources
};
