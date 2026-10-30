/**
 * Application Constants
 * 
 * Centralized configuration for application-wide constants to avoid magic numbers.
 * These values can be overridden via environment variables where appropriate.
 * 
 * @module config/constants
 */

/**
 * Safely parse integer from environment variable with fallback to default
 * @param {string} envValue - Environment variable value
 * @param {number} defaultValue - Default value if parsing fails
 * @returns {number} Parsed integer or default value
 */
function parseEnvInt(envValue, defaultValue) {
  if (!envValue) {return defaultValue;}
  const trimmed = String(envValue).trim();
  const parsed = parseInt(trimmed, 10);
  // Ensure the entire string is a valid integer (no trailing non-numeric characters)
  return isNaN(parsed) || !/^-?\d+$/.test(trimmed) ? defaultValue : parsed;
}

/**
 * Rate Limiting Configuration
 */
const RATE_LIMITS = {
  // General API rate limiting
  GENERAL_WINDOW_MS: parseEnvInt(process.env.RATE_LIMIT_GENERAL_WINDOW_MS, 15 * 60 * 1000),  // 15 minutes
  GENERAL_MAX_REQUESTS: parseEnvInt(process.env.RATE_LIMIT_GENERAL_MAX_REQUESTS, 1000),          // Max requests per window
  
  // Authentication rate limiting
  AUTH_WINDOW_MS: parseEnvInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),      // 15 minutes
  AUTH_MAX_ATTEMPTS: parseEnvInt(process.env.RATE_LIMIT_AUTH_MAX_ATTEMPTS, 20),                // Max login attempts per window
  
  // Password reset rate limiting
  PASSWORD_RESET_WINDOW_MS: parseEnvInt(process.env.RATE_LIMIT_PASSWORD_RESET_WINDOW_MS, 60 * 60 * 1000), // 1 hour
  PASSWORD_RESET_MAX_REQUESTS: parseEnvInt(process.env.RATE_LIMIT_PASSWORD_RESET_MAX_REQUESTS, 5),            // Max reset requests per hour

  // Blog index refresh (re-reads every article and starts an IndexNow sync)
  BLOG_REFRESH_WINDOW_MS: parseEnvInt(process.env.RATE_LIMIT_BLOG_REFRESH_WINDOW_MS, 15 * 60 * 1000), // 15 minutes
  BLOG_REFRESH_MAX_REQUESTS: parseEnvInt(process.env.RATE_LIMIT_BLOG_REFRESH_MAX_REQUESTS, 10),            // Max refreshes per window
  
  // User profile updates
  PROFILE_UPDATE_WINDOW_MS: parseEnvInt(process.env.RATE_LIMIT_PROFILE_UPDATE_WINDOW_MS, 15 * 60 * 1000),  // 15 minutes
  PROFILE_UPDATE_MAX_PROD: parseEnvInt(process.env.RATE_LIMIT_PROFILE_UPDATE_MAX_PROD, 5),                 // Production limit
  PROFILE_UPDATE_MAX_DEV: parseEnvInt(process.env.RATE_LIMIT_PROFILE_UPDATE_MAX_DEV, 100),                // Development limit
  
  // Email changes
  EMAIL_CHANGE_WINDOW_MS: parseEnvInt(process.env.RATE_LIMIT_EMAIL_CHANGE_WINDOW_MS, 15 * 60 * 1000),    // 15 minutes
  EMAIL_CHANGE_MAX_PROD: parseEnvInt(process.env.RATE_LIMIT_EMAIL_CHANGE_MAX_PROD, 10),                  // Production limit
  EMAIL_CHANGE_MAX_DEV: parseEnvInt(process.env.RATE_LIMIT_EMAIL_CHANGE_MAX_DEV, 100),                  // Development limit
};

/** Limits for one synchronous SISC import, including its header row. */
const SISC_IMPORT_LIMITS = Object.freeze({
  MAX_BYTES: 5 * 1024 * 1024,
  MAX_DATA_ROWS: 1000,
  MAX_LINE_LENGTH: 64 * 1024,
  MAX_FIELD_LENGTH: 16 * 1024,
  MAX_COLUMNS: 128,
});

/**
 * File Upload Limits
 */
const FILE_LIMITS = {
  // AI service file upload limit
  AI_MAX_FILE_SIZE: parseEnvInt(process.env.FILE_LIMIT_AI_MAX_FILE_SIZE, 10 * 1024 * 1024),  // 10MB in bytes
  
  // General file upload limit (can be added when needed)
  // MAX_FILE_SIZE: 50 * 1024 * 1024,  // 50MB
};

/**
 * AI request limits. These cap prompt size and collection cardinality before
 * untrusted request data reaches an external model.
 */
const AI_LIMITS = {
  MAX_TEXT_LENGTH: parseEnvInt(process.env.AI_MAX_TEXT_LENGTH, 10_000),
  MAX_FOCUS_LENGTH: parseEnvInt(process.env.AI_MAX_FOCUS_LENGTH, 2_000),
  MAX_SHORT_TEXT_LENGTH: parseEnvInt(process.env.AI_MAX_SHORT_TEXT_LENGTH, 300),
  MAX_VOCABULARY_TERMS: parseEnvInt(process.env.AI_MAX_VOCABULARY_TERMS, 30),
  MAX_ACTIVITY_TEMPLATES: parseEnvInt(process.env.AI_MAX_ACTIVITY_TEMPLATES, 30),
  MIN_DURATION_MINUTES: parseEnvInt(process.env.AI_MIN_DURATION_MINUTES, 15),
  MAX_DURATION_MINUTES: parseEnvInt(process.env.AI_MAX_DURATION_MINUTES, 720),
  MAX_PARTICIPANTS: parseEnvInt(process.env.AI_MAX_PARTICIPANTS, 500),
};

/**
 * Date Range Limits
 */
const DATE_LIMITS = {
  // Offline sync date range limit
  OFFLINE_MAX_DAYS: parseEnvInt(process.env.DATE_LIMIT_OFFLINE_MAX_DAYS, 14),  // Maximum days for offline data sync
};

/**
 * Pagination Defaults
 */
const PAGINATION = {
  DEFAULT_PAGE: parseEnvInt(process.env.PAGINATION_DEFAULT_PAGE, 1),
  DEFAULT_LIMIT: parseEnvInt(process.env.PAGINATION_DEFAULT_LIMIT, 30),
  MAX_LIMIT: parseEnvInt(process.env.PAGINATION_MAX_LIMIT, 100),
};

/**
 * Session and Token Configuration
 */
const SESSION = {
  // JWT token expiration
  JWT_EXPIRATION: process.env.SESSION_JWT_EXPIRATION || '24h',
  
  // Refresh token expiration
  REFRESH_TOKEN_EXPIRATION: process.env.SESSION_REFRESH_TOKEN_EXPIRATION || '7d',
};

/**
 * Cache Configuration
 */
const CACHE = {
  // Default cache TTL in seconds
  DEFAULT_TTL: parseEnvInt(process.env.CACHE_DEFAULT_TTL, 300),  // 5 minutes
  
  // Cache cleanup interval
  CLEANUP_INTERVAL_MS: parseEnvInt(process.env.CACHE_CLEANUP_INTERVAL_MS, 5 * 60 * 1000),  // 5 minutes
};

/**
 * Permissions over the unit's money as a whole.
 *
 * The finance and budget routes answer for every family in the unit; none of
 * them filter by child. A role limited to its members' own children
 * (data_scope 'linked') therefore cannot hold these: it would read every
 * family's fees. A guardian's own statement and payments need none of them.
 * Migration 010 removed them from such roles; role management refuses to add
 * them back.
 */
const UNIT_FINANCE_PERMISSIONS = Object.freeze([
  'finance.view',
  'finance.manage',
  'finance.approve',
  'budget.view',
  'budget.manage',
]);

/**
 * IndexNow submissions for the wampums.app marketing site (services/indexNow.js).
 *
 * The key is public by design: search engines verify it by fetching
 * `landing/<KEY>.txt`, whose content must equal it.
 */
const INDEXNOW = Object.freeze({
  ENDPOINT: 'https://api.indexnow.org/indexnow',
  KEY: '16bc5aa95cae4d73b2c325ef6dc31f8b',
  // A page submitted less than this long ago waits before it is sent again.
  DEBOUNCE_MS: parseEnvInt(process.env.INDEXNOW_DEBOUNCE_MS, 5 * 60 * 1000),          // 5 minutes
  // After a deploy, wait until the new release is the one answering before announcing it.
  STARTUP_DELAY_MS: parseEnvInt(process.env.INDEXNOW_STARTUP_DELAY_MS, 2 * 60 * 1000), // 2 minutes
  REQUEST_TIMEOUT_MS: 15 * 1000,
  MAX_URLS_PER_REQUEST: 10000,   // protocol limit
  MAX_RETRIES: 3,                // after a rate limit or a network failure
  ADVISORY_LOCK_KEY: 7246630,    // one instance submits at a time
  // Another sync holds the lock for at most one request: try again after it, with the newer content.
  LOCK_RETRY_MS: 30 * 1000,
  ACCEPTED_STATUSES: Object.freeze([200, 202]), // 202: accepted, key check pending
  RATE_LIMITED_STATUS: 429,
});

/** Volunteer shifts (#1251), shared with the SPA; the database checks the same bounds (migration 069). */
const volunteerShiftLimits = require('./volunteer_shifts.json');
const VOLUNTEER_SHIFTS = Object.freeze({
  TITLE_MAX_LENGTH: volunteerShiftLimits.title_max_length,
  NOTES_MAX_LENGTH: volunteerShiftLimits.notes_max_length,
  MAX_SLOTS: volunteerShiftLimits.max_slots,
});

module.exports = {
  VOLUNTEER_SHIFTS,
  RATE_LIMITS,
  FILE_LIMITS,
  SISC_IMPORT_LIMITS,
  AI_LIMITS,
  DATE_LIMITS,
  PAGINATION,
  SESSION,
  CACHE,
  UNIT_FINANCE_PERMISSIONS,
  INDEXNOW,
};
