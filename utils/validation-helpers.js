/**
 * Shared validation helpers for API routes
 */

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
 * Validate and parse monetary value
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {Object} - { valid: boolean, message?: string, value?: number }
 */
function validateMoney(value, fieldName) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { valid: false, message: `${fieldName} must be a non-negative number` };
  }
  return { valid: true, value: Math.round(numeric * 100) / 100 };
}

/**
 * Validate date string
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {Object} - { valid: boolean, message?: string }
 */
function validateDate(value, fieldName) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { valid: false, message: `${fieldName} must be a valid date` };
  }
  return { valid: true };
}

/**
 * Validate positive integer
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {Object} - { valid: boolean, message?: string, value?: number }
 */
function validatePositiveInteger(value, fieldName) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return { valid: false, message: `${fieldName} must be a positive integer` };
  }
  return { valid: true, value: numeric };
}

module.exports = {
  toNumeric,
  validateMoney,
  validateDate,
  validatePositiveInteger
};
