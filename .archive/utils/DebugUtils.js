/**
 * DebugUtils.js (Backend/Node.js version)
 *
 * Centralized debug logging utilities for the Wampums Node.js backend.
 * CommonJS module compatible with Node.js require().
 *
 * Usage:
 *   const { debugLog, debugError, debugWarn, isDebugMode } = require('./utils/DebugUtils');
 *   debugLog('This is a debug message');
 *   debugError('This is an error', errorObject);
 */

/**
 * Determines if debug mode is enabled (non-production)
 * @returns {boolean} True if debug mode is active
 */
function isDebugMode() {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Log a debug message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
function debugLog(...args) {
  if (isDebugMode()) {
    console.log('[DEBUG]', ...args);
  }
}

/**
 * Log an error message (ALWAYS shown, even in production)
 * @param {...any} args - Arguments to log
 */
function debugError(...args) {
  console.error('[ERROR]', ...args);
}

/**
 * Log a warning message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
function debugWarn(...args) {
  if (isDebugMode()) {
    console.warn('[WARN]', ...args);
  }
}

/**
 * Log an info message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
function debugInfo(...args) {
  if (isDebugMode()) {
    console.info('[INFO]', ...args);
  }
}

module.exports = {
  isDebugMode,
  debugLog,
  debugError,
  debugWarn,
  debugInfo
};
