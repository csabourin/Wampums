/**
 * Jest Conditional Test Helpers
 *
 * Enables environment-based test execution:
 * - Skip tests when required env variables aren't set
 * - Run integration tests only in CI or local env with database
 *
 * Usage:
 *   describe.skipIf(!process.env.DATABASE_URL)('Integration tests', () => {
 *     test('needs database', () => { });
 *   });
 *
 * @module test/jest-conditional-helpers
 */

/**
 * Setup Jest helpers when globals become available.
 * Safe to run multiple times.
 *
 * @returns {void}
 */
function setupConditionalHelpers() {
  if (typeof describe !== 'undefined' && !describe.skipIf) {
    /**
     * Conditionally skip describe blocks.
     * Supports both call styles:
     *   describe.skipIf(condition, name, fn)
     *   describe.skipIf(condition)(name, fn)
     */
    describe.skipIf = function(condition, name, fn) {
      if (typeof name === 'undefined' && typeof fn === 'undefined') {
        return (suiteName, suiteFn) => {
          if (condition) {
            describe.skip(suiteName, suiteFn);
          } else {
            describe(suiteName, suiteFn);
          }
        };
      }

      if (condition) {
        // Skip this describe block
        describe.skip(name, fn);
      } else {
        // Run normally
        describe(name, fn);
      }
    };
  }

/**
 * Helper to conditionally skip test cases
 *
 * @example
 * test.skipIf(!HAS_DATABASE)('uses database', () => {});
 */
  if (typeof test !== 'undefined' && !test.skipIf) {
    test.skipIf = function(condition, name, fn) {
      if (condition) {
        test.skip(name, fn);
      } else {
        test(name, fn);
      }
    };
  }

/**
 * Helper to conditionally run test cases
 * Opposite of skipIf - only runs if condition is TRUE
 *
 * @example
 * test.onlyIf(HAS_DATABASE)('uses database', () => {});
 */
  if (typeof test !== 'undefined' && !test.onlyIf) {
    test.onlyIf = function(condition, name, fn) {
      if (condition) {
        test(name, fn);
      } else {
        test.skip(name, fn);
      }
    };
  }

/**
 * Helper for beforeEach conditional setup
 *
 * @example
 * beforeEach.skipIf(!HAS_DATABASE)(async () => {
 *   // Only runs if HAS_DATABASE is false
 * });
 *
 * @example
 * beforeEach.onlyIf(HAS_DATABASE)(async () => {
 *   // Only runs if HAS_DATABASE is true
 * });
 */
  if (typeof beforeEach !== 'undefined' && !beforeEach.skipIf) {
    beforeEach.skipIf = function(condition) {
      return condition ? () => {} : beforeEach;
    };
  }

  if (typeof beforeEach !== 'undefined' && !beforeEach.onlyIf) {
    beforeEach.onlyIf = function(condition) {
      return condition ? beforeEach : () => {};
    };
  }

/**
 * Similar helpers for afterEach
 */
  if (typeof afterEach !== 'undefined' && !afterEach.skipIf) {
    afterEach.skipIf = function(condition) {
      return condition ? () => {} : afterEach;
    };
  }

  if (typeof afterEach !== 'undefined' && !afterEach.onlyIf) {
    afterEach.onlyIf = function(condition) {
      return condition ? afterEach : () => {};
    };
  }
}

setupConditionalHelpers();

/**
 * Environment variable check helpers
 */
const HAS_DATABASE = !!process.env.DATABASE_URL;
const HAS_AUTH_SECRET = !!process.env.JWT_SECRET_KEY;
const HAS_STRIPE = !!process.env.STRIPE_SECRET_KEY;
const IS_CI = !!process.env.CI;

module.exports = {
  setupConditionalHelpers,
  HAS_DATABASE,
  HAS_AUTH_SECRET,
  HAS_STRIPE,
  IS_CI
};
