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
 * Production is identified by domains ending in .app
 * @returns {boolean} True if debug mode is active
 */
export function isDebugMode() {
    // Production domains end with .app - never show debug logs in production
    const isProduction = window.location.hostname.endsWith('.app');

    return (
        !isProduction && (
            import.meta.env?.VITE_DEBUG_MODE === 'true' ||
            import.meta.env?.DEV ||
            window.location.hostname === "localhost" ||
            window.location.hostname === "wampums-1.test" ||
            window.location.hostname.includes("replit.dev")
        )
    );
}

function redactString(value) {
    return String(value)
        .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
        .replace(/("(?:password|token|authorization|body)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
        .slice(0, 1000);
}

function summarizeDebugValue(value) {
    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactString(value.message),
            status: value.status,
        };
    }
    if (Array.isArray(value)) {
        return `[Array(${value.length})]`;
    }
    if (value && typeof value === 'object') {
        const summary = { keys: Object.keys(value).slice(0, 30) };
        for (const key of ['success', 'status', 'queued', 'count', 'method', 'url']) {
            if (['string', 'number', 'boolean'].includes(typeof value[key])) {
                summary[key] = key === 'url' ? redactString(value[key]) : value[key];
            }
        }
        return summary;
    }
    return typeof value === 'string' ? redactString(value) : value;
}

function prepareDebugArgs(args) {
    return args.map(summarizeDebugValue);
}

/**
 * Log a debug message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
export function debugLog(...args) {
    if (isDebugMode()) {
        console.log('[DEBUG]', ...prepareDebugArgs(args));
    }
}

/**
 * Log an error message (ALWAYS shown, even in production)
 * Errors are critical and should never be suppressed
 * @param {...any} args - Arguments to log
 */
export function debugError(...args) {
    console.error('[ERROR]', ...prepareDebugArgs(args));
}

/**
 * Log a warning message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
export function debugWarn(...args) {
    if (isDebugMode()) {
        console.warn('[WARN]', ...prepareDebugArgs(args));
    }
}

/**
 * Log an info message (only if debug mode is enabled)
 * @param {...any} args - Arguments to log
 */
export function debugInfo(...args) {
    if (isDebugMode()) {
        console.info('[INFO]', ...prepareDebugArgs(args));
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
        console.log('[DEBUG TABLE]', summarizeDebugValue(data), columns || []);
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
