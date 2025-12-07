/**
 * Validation Middleware
 *
 * Common validation chains using express-validator
 * Provides reusable validators for consistent input validation across routes
 */

const { check, param, query, validationResult } = require('express-validator');

/**
 * Middleware to check validation results and return errors
 *
 * @example
 * router.post('/login', validateEmail, validatePassword, checkValidation, async (req, res) => {
 *   // Only executes if validation passed
 * });
 */
const checkValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// ============================================
// EMAIL VALIDATIONS
// ============================================

/**
 * Validate email format and length
 * Normalizes email to lowercase without altering provider-specific formatting
 */
const validateEmail = check('email')
  .trim()
  .isEmail()
  .normalizeEmail({
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
    outlookdotcom_remove_subaddress: false,
    yahoo_remove_subaddress: false,
    icloud_remove_subaddress: false,
    gmail_convert_googlemaildotcom: false,
  })
  .withMessage('Valid email is required')
  .isLength({ max: 255 })
  .withMessage('Email too long');

/**
 * Optional email validation (for updates)
 */
const validateEmailOptional = check('email')
  .optional()
  .trim()
  .isEmail()
  .normalizeEmail({
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
    outlookdotcom_remove_subaddress: false,
    yahoo_remove_subaddress: false,
    icloud_remove_subaddress: false,
    gmail_convert_googlemaildotcom: false,
  })
  .withMessage('Valid email is required')
  .isLength({ max: 255 })
  .withMessage('Email too long');

/**
 * Canonicalize email without removing dots or subaddresses
 * @param {string} email - Raw email input
 * @returns {string} Trimmed, lowercase email preserving user formatting
 */
const normalizeEmailInput = (email = '') => email.toString().trim().toLowerCase();

// ============================================
// PASSWORD VALIDATIONS
// ============================================

/**
 * Validate password strength for registration/reset
 * Requires 8+ chars, uppercase, lowercase, number
 */
const validateStrongPassword = check('password')
  .trim()
  .isLength({ min: 8, max: 255 })
  .withMessage('Password must be between 8 and 255 characters')
  .matches(/[A-Z]/)
  .withMessage('Password must contain at least one uppercase letter')
  .matches(/[a-z]/)
  .withMessage('Password must contain at least one lowercase letter')
  .matches(/[0-9]/)
  .withMessage('Password must contain at least one number');

/**
 * Validate password for login (basic check)
 */
const validatePassword = check('password')
  .trim()
  .notEmpty()
  .withMessage('Password is required')
  .isLength({ min: 1, max: 255 })
  .withMessage('Password must be between 1 and 255 characters');

/**
 * Validate new password (for password reset)
 */
const validateNewPassword = check('new_password')
  .trim()
  .isLength({ min: 8, max: 255 })
  .withMessage('Password must be between 8 and 255 characters')
  .matches(/[A-Z]/)
  .withMessage('Password must contain at least one uppercase letter')
  .matches(/[a-z]/)
  .withMessage('Password must contain at least one lowercase letter')
  .matches(/[0-9]/)
  .withMessage('Password must contain at least one number');

// ============================================
// ID VALIDATIONS
// ============================================

/**
 * Validate numeric ID in URL parameter
 */
const validateIdParam = (paramName = 'id') =>
  param(paramName)
    .isInt({ min: 1 })
    .withMessage(`${paramName} must be a positive integer`);

/**
 * Validate numeric ID in request body
 */
const validateIdBody = (fieldName = 'id') =>
  check(fieldName)
    .isInt({ min: 1 })
    .withMessage(`${fieldName} must be a positive integer`);

/**
 * Validate optional numeric ID in request body
 */
const validateIdBodyOptional = (fieldName = 'id') =>
  check(fieldName)
    .optional()
    .isInt({ min: 1 })
    .withMessage(`${fieldName} must be a positive integer`);

/**
 * Validate numeric ID in query parameter
 */
const validateIdQuery = (fieldName = 'id') =>
  query(fieldName)
    .optional()
    .isInt({ min: 1 })
    .withMessage(`${fieldName} must be a positive integer`);

// ============================================
// DATE VALIDATIONS
// ============================================

/**
 * Validate ISO date format
 */
const validateDate = (fieldName = 'date') =>
  check(fieldName)
    .isISO8601()
    .withMessage(`${fieldName} must be a valid date (ISO 8601 format)`);

/**
 * Validate optional ISO date
 */
const validateDateOptional = (fieldName = 'date') =>
  check(fieldName)
    .optional()
    .isISO8601()
    .withMessage(`${fieldName} must be a valid date (ISO 8601 format)`);

/**
 * Validate date range (start_date and end_date)
 */
const validateDateRange = [
  check('start_date')
    .isISO8601()
    .withMessage('start_date must be a valid date'),
  check('end_date')
    .isISO8601()
    .withMessage('end_date must be a valid date')
    .custom((endDate, { req }) => {
      if (new Date(endDate) < new Date(req.body.start_date)) {
        throw new Error('end_date must be after start_date');
      }
      return true;
    })
];

// ============================================
// NAME VALIDATIONS
// ============================================

/**
 * Validate first name
 */
const validateFirstName = check('first_name')
  .trim()
  .notEmpty()
  .withMessage('First name is required')
  .isLength({ min: 1, max: 100 })
  .withMessage('First name must be between 1 and 100 characters');

/**
 * Validate last name
 */
const validateLastName = check('last_name')
  .trim()
  .notEmpty()
  .withMessage('Last name is required')
  .isLength({ min: 1, max: 100 })
  .withMessage('Last name must be between 1 and 100 characters');

/**
 * Validate full name (combined)
 */
const validateFullName = check('full_name')
  .trim()
  .notEmpty()
  .withMessage('Full name is required')
  .isLength({ min: 1, max: 200 })
  .withMessage('Full name must be between 1 and 200 characters');

// ============================================
// PAGINATION VALIDATIONS
// ============================================

/**
 * Validate pagination parameters (page, limit)
 */
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
];

// ============================================
// ROLE VALIDATIONS
// ============================================

/**
 * Validate user role
 */
const validateRole = check('role')
  .isIn(['admin', 'animation', 'parent'])
  .withMessage('Role must be one of: admin, animation, parent');

/**
 * Validate optional user role
 */
const validateRoleOptional = check('role')
  .optional()
  .isIn(['admin', 'animation', 'parent'])
  .withMessage('Role must be one of: admin, animation, parent');

// ============================================
// TOKEN VALIDATIONS
// ============================================

/**
 * Validate JWT token in body
 */
const validateToken = check('token')
  .trim()
  .notEmpty()
  .withMessage('Token is required');

// ============================================
// ATTENDANCE VALIDATIONS
// ============================================

/**
 * Validate attendance status
 */
const validateAttendanceStatus = check('status')
  .isIn(['present', 'absent', 'late', 'excused'])
  .withMessage('Status must be one of: present, absent, late, excused');

// ============================================
// EXPORT ALL VALIDATORS
// ============================================

module.exports = {
  // Middleware
  checkValidation,

  // Email
  validateEmail,
  validateEmailOptional,

  // Password
  validatePassword,
  validateStrongPassword,
  validateNewPassword,

  // IDs
  validateIdParam,
  validateIdBody,
  validateIdBodyOptional,
  validateIdQuery,

  // Dates
  validateDate,
  validateDateOptional,
  validateDateRange,

  // Names
  validateFirstName,
  validateLastName,
  validateFullName,

  // Pagination
  validatePagination,

  // Role
  validateRole,
  validateRoleOptional,

  // Token
  validateToken,

  // Attendance
  validateAttendanceStatus,

  // Helpers
  normalizeEmailInput
};
