/**
 * Shared validation helpers for API routes.
 *
 * Each helper reads the whole value: '12CAD' is not 12, '7abc' is not 7 and
 * '2026-02-30' is not March 2 (CLAUDE.md §9).
 */
const { isCalendarDate } = require('./calendar-date');

/** Largest value a PostgreSQL `integer` id column holds. */
const MAX_INTEGER_ID = 2147483647;

/** A non-negative amount with at most two decimals: 12, 12.5, 12.50. */
const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;

/** A positive whole number written in decimal digits only. */
const DIGITS_PATTERN = /^\d+$/;

/**
 * A UTC timestamp whose date is the value meant. A date column read back
 * through node-postgres serializes this way, and the mobile app sends it back
 * unchanged when it edits a record.
 */
const UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/;

/** Cents per currency unit, to round amounts to the cent. */
const CENTS = 100;

/**
 * Convert database numeric to JavaScript number
 * @param {*} value - Value to convert
 * @returns {number} - Numeric value or 0 if invalid
 */
function toNumeric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * Validate and parse a monetary value. The interface sends a JSON number
 * (parsed from an amount input); a string is accepted when it is the same
 * plain decimal. Currency codes, separators, signs and exponents are refused.
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {Object} - { valid: boolean, message?: string, value?: number }
 */
function validateMoney(value, fieldName) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !MONEY_PATTERN.test(text)) {
    return { valid: false, message: `${fieldName} must be a non-negative amount with at most two decimals` };
  }
  return { valid: true, value: Math.round(Number(text) * CENTS) / CENTS };
}

/**
 * Validate a date-only value (`YYYY-MM-DD`, a real calendar day). A UTC
 * timestamp is read as its date, since that is how a date column comes back
 * from this API.
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {Object} - { valid: boolean, message?: string, value?: string }
 */
function validateDate(value, fieldName) {
  const timestamp = typeof value === 'string' ? UTC_TIMESTAMP_PATTERN.exec(value) : null;
  const date = timestamp ? timestamp[1] : value;
  if (!isCalendarDate(date)) {
    return { valid: false, message: `${fieldName} must be a valid date (YYYY-MM-DD)` };
  }
  return { valid: true, value: date };
}

/**
 * Validate a positive integer that fits a PostgreSQL `integer` (1 to 2147483647),
 * given as a JSON integer or a string of digits.
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {Object} - { valid: boolean, message?: string, value?: number }
 */
function validatePositiveInteger(value, fieldName) {
  const isDigits = typeof value === 'string' && DIGITS_PATTERN.test(value);
  const numeric = typeof value === 'number' || isDigits ? Number(value) : NaN;
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > MAX_INTEGER_ID) {
    return { valid: false, message: `${fieldName} must be a positive integer` };
  }
  return { valid: true, value: numeric };
}

module.exports = {
  MAX_INTEGER_ID,
  toNumeric,
  validateMoney,
  validateDate,
  validatePositiveInteger
};
