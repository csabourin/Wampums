/**
 * DebugUtils.js
 *
 * Centralized debug logging utilities for the Wampums application.
 * Consolidates debug functions scattered across multiple files.
 *
 * Usage:
 *   import { debugLog, debugError, debugWarn, isDebugMode } from './utils/DebugUtils.js';
 *   debugLog('This is a debug message');
 *   debugError('This is an error', errorObject);
 */

/**
 * Determines if debug mode is enabled
 * @returns {boolean} True if debug mode is active
 */
export function isDebugMode() {
    return (
        import.meta.env?.VITE_DEBUG_MODE === 'true' ||
        import.meta.env?.DEV ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "wampums-1.test" ||
        window.location.hostname.includes("replit.dev")
    );
}

/**
 * Log a debug message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
export function debugLog(...args) {
    if (isDebugMode()) {
        console.log('[DEBUG]', ...args);
    }
}

/**
 * Log an error message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
export function debugError(...args) {
    if (isDebugMode()) {
        console.error('[ERROR]', ...args);
    }
}

/**
 * Log a warning message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
export function debugWarn(...args) {
    if (isDebugMode()) {
        console.warn('[WARN]', ...args);
    }
}

/**
 * Log an info message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
export function debugInfo(...args) {
    if (isDebugMode()) {
        console.info('[INFO]', ...args);
    }
}

/**
 * Log a table (only if debug mode is enabled)
 * Useful for displaying arrays of objects
 * @param {any} data - Data to display as table
 * @param {string[]} columns - Optional columns to display
 */
export function debugTable(data, columns) {
    if (isDebugMode()) {
        console.log('[DEBUG TABLE]');
        if (columns) {
            console.table(data, columns);
        } else {
            console.table(data);
        }
    }
}

/**
 * Start a performance timer (only if debug mode is enabled)
 * @param {string} label - Label for the timer
 */
export function debugTimeStart(label) {
    if (isDebugMode()) {
        console.time(`[TIMER] ${label}`);
    }
}

/**
 * End a performance timer (only if debug mode is enabled)
 * @param {string} label - Label for the timer
 */
export function debugTimeEnd(label) {
    if (isDebugMode()) {
        console.timeEnd(`[TIMER] ${label}`);
    }
}

/**
 * Group related log messages (only if debug mode is enabled)
 * @param {string} label - Label for the group
 * @param {Function} callback - Function containing the grouped logs
 */
export function debugGroup(label, callback) {
    if (isDebugMode()) {
        console.group(`[GROUP] ${label}`);
        callback();
        console.groupEnd();
    }
}

/**
 * Legacy support: Export a CONFIG-like object
 * This allows existing code using CONFIG.debugMode to continue working
 */
export const DEBUG_CONFIG = {
    get debugMode() {
        return isDebugMode();
    }
};
