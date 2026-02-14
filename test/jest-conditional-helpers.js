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
 * Setup Jest helpers when globals become available
 * This is called from setupJest.js AFTER Jest globals are loaded
 */
function setupConditionalHelpers() {
  // Helper to conditionally skip describe blocks
  // Usage: describe.skipIf(condition)('test name', () => {...})
  if (typeof global.describe !== 'undefined' && !global.describe.skipIf) {
    global.describe.skipIf = function(condition) {
      return function(name, fn) {
        if (condition) {
          // Skip this describe block
          global.describe.skip(name, fn);
        } else {
          // Run normally
          global.describe(name, fn);
        }
      };
    };
  }

  // Helper to conditionally skip test cases
  // Usage: test.skipIf(condition)('test name', () => {...})
  if (typeof global.test !== 'undefined' && !global.test.skipIf) {
    global.test.skipIf = function(condition) {
      return function(name, fn) {
        if (condition) {
          global.test.skip(name, fn);
        } else {
          global.test(name, fn);
        }
      };
    };
  }

  // Helper to conditionally run test cases
  // Opposite of skipIf - only runs if condition is TRUE
  // Usage: test.onlyIf(condition)('test name', () => {...})
  if (typeof global.test !== 'undefined' && !global.test.onlyIf) {
    global.test.onlyIf = function(condition) {
      return function(name, fn) {
        if (condition) {
          global.test(name, fn);
        } else {
          global.test.skip(name, fn);
        }
      };
    };
  }

  // Helper for beforeEach conditional setup
  if (typeof global.beforeEach !== 'undefined' && !global.beforeEach.skipIf) {
    global.beforeEach.skipIf = function(condition) {
      return condition ? () => {} : global.beforeEach;
    };
  }

  if (typeof global.beforeEach !== 'undefined' && !global.beforeEach.onlyIf) {
    global.beforeEach.onlyIf = function(condition) {
      return condition ? global.beforeEach : () => {};
    };
  }

  // Similar helpers for afterEach
  if (typeof global.afterEach !== 'undefined' && !global.afterEach.skipIf) {
    global.afterEach.skipIf = function(condition) {
      return condition ? () => {} : global.afterEach;
    };
  }

  if (typeof global.afterEach !== 'undefined' && !global.afterEach.onlyIf) {
    global.afterEach.onlyIf = function(condition) {
      return condition ? global.afterEach : () => {};
    };
  }
}

// Auto-initialize if Jest globals are already available
// This handles the case where this module is loaded after Jest setup
if (typeof global.describe !== 'undefined') {
  setupConditionalHelpers();
}

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
