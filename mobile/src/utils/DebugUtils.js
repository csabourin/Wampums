/**
 * Debug Utilities for Wampums React Native App
 *
 * Provides gated logging helpers that respect CONFIG.FEATURES.DEBUG_LOGGING.
 */

import CONFIG from '../config';

/**
 * Log debug information when debug logging is enabled.
 * @param {...any} args - Values to log.
 */
export const debugLog = (...args) => {
  if (CONFIG.FEATURES.DEBUG_LOGGING) {
    // eslint-disable-next-line no-console
    console.log('[Debug]', ...args);
  }
};

/**
 * Log debug warnings when debug logging is enabled.
 * @param {...any} args - Values to log.
 */
export const debugWarn = (...args) => {
  if (CONFIG.FEATURES.DEBUG_LOGGING) {
    // eslint-disable-next-line no-console
    console.warn('[Debug]', ...args);
  }
};

/**
 * Log debug errors when debug logging is enabled.
 * @param {...any} args - Values to log.
 */
export const debugError = (...args) => {
  if (CONFIG.FEATURES.DEBUG_LOGGING) {
    // eslint-disable-next-line no-console
    console.error('[Debug]', ...args);
  }
};

/**
 * Log debug info when debug logging is enabled.
 * @param {...any} args - Values to log.
 */
export const debugInfo = (...args) => {
  if (CONFIG.FEATURES.DEBUG_LOGGING) {
    // eslint-disable-next-line no-console
    console.info('[Debug]', ...args);
  }
};

export default {
  debugLog,
  debugWarn,
  debugError,
  debugInfo,
};
