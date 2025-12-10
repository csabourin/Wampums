/**
 * ValidationUtils.js
 *
 * Centralized validation utilities for the Wampums application.
 * Provides common validation functions for forms, inputs, and data.
 *
 * Usage:
 *   import { validateEmail, validateRequired, validateParticipant } from './utils/ValidationUtils.js';
 */

import { isValidDate } from './DateUtils.js';

/**
 * Validate email address
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email
 */
export function validateEmail(email) {
    if (!email || typeof email !== 'string') return false;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
}

/**
 * Validate required field
 * @param {any} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateRequired(value, fieldName = 'Field') {
    const isEmpty = value === null || value === undefined || value === '' ||
                    (typeof value === 'string' && value.trim() === '');

    return {
        valid: !isEmpty,
        error: isEmpty ? `${fieldName} is required` : null
    };
}

/**
 * Validate minimum length
 * @param {string} value - Value to validate
 * @param {number} minLength - Minimum length
 * @param {string} fieldName - Field name for error message
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateMinLength(value, minLength, fieldName = 'Field') {
    if (!value || typeof value !== 'string') {
        return {
            valid: false,
            error: `${fieldName} must be at least ${minLength} characters`
        };
    }

    const isValid = value.trim().length >= minLength;
    return {
        valid: isValid,
        error: isValid ? null : `${fieldName} must be at least ${minLength} characters`
    };
}

/**
 * Validate maximum length
 * @param {string} value - Value to validate
 * @param {number} maxLength - Maximum length
 * @param {string} fieldName - Field name for error message
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateMaxLength(value, maxLength, fieldName = 'Field') {
    if (!value || typeof value !== 'string') {
        return { valid: true, error: null };
    }

    const isValid = value.trim().length <= maxLength;
    return {
        valid: isValid,
        error: isValid ? null : `${fieldName} must be no more than ${maxLength} characters`
    };
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {{valid: boolean, error: string|null, strength: string}} Validation result with strength
 */
export function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return {
            valid: false,
            error: 'Password is required',
            strength: 'none'
        };
    }

    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (password.length < minLength) {
        return {
            valid: false,
            error: `Password must be at least ${minLength} characters`,
            strength: 'weak'
        };
    }

    const criteriaCount = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar].filter(Boolean).length;

    let strength = 'weak';
    if (criteriaCount >= 4) strength = 'strong';
    else if (criteriaCount >= 3) strength = 'medium';

    return {
        valid: true,
        error: null,
        strength: strength
    };
}

/**
 * Validate password confirmation
 * @param {string} password - Original password
 * @param {string} confirmPassword - Confirmation password
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validatePasswordConfirm(password, confirmPassword) {
    const isMatch = password === confirmPassword;
    return {
        valid: isMatch,
        error: isMatch ? null : 'Passwords do not match'
    };
}

/**
 * Validate phone number (flexible format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid phone number
 */
export function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') return false;

    // Remove all non-digit characters
    const digitsOnly = phone.replace(/\D/g, '');

    // Valid if between 10-15 digits (international format)
    return digitsOnly.length >= 10 && digitsOnly.length <= 15;
}

/**
 * Validate date of birth (must be in the past)
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @param {number} minAge - Minimum age (optional)
 * @param {number} maxAge - Maximum age (optional)
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateDateOfBirth(dateString, minAge = null, maxAge = null) {
    if (!isValidDate(dateString)) {
        return {
            valid: false,
            error: 'Invalid date format'
        };
    }

    const birthDate = new Date(dateString);
    const today = new Date();

    if (birthDate >= today) {
        return {
            valid: false,
            error: 'Date of birth must be in the past'
        };
    }

    if (minAge !== null) {
        const minDate = new Date();
        minDate.setFullYear(minDate.getFullYear() - minAge);

        if (birthDate > minDate) {
            return {
                valid: false,
                error: `Must be at least ${minAge} years old`
            };
        }
    }

    if (maxAge !== null) {
        const maxDate = new Date();
        maxDate.setFullYear(maxDate.getFullYear() - maxAge);

        if (birthDate < maxDate) {
            return {
                valid: false,
                error: `Must be no more than ${maxAge} years old`
            };
        }
    }

    return {
        valid: true,
        error: null
    };
}

/**
 * Validate participant data
 * @param {Object} data - Participant data
 * @returns {{valid: boolean, errors: Object}} Validation result with errors by field
 */
export function validateParticipant(data) {
    const errors = {};

    // Validate first name
    const firstNameResult = validateRequired(data.first_name, 'First name');
    if (!firstNameResult.valid) {
        errors.first_name = firstNameResult.error;
    }

    // Validate last name
    const lastNameResult = validateRequired(data.last_name, 'Last name');
    if (!lastNameResult.valid) {
        errors.last_name = lastNameResult.error;
    }

    // Validate date of birth if provided
    if (data.date_of_birth) {
        const dobResult = validateDateOfBirth(data.date_of_birth);
        if (!dobResult.valid) {
            errors.date_of_birth = dobResult.error;
        }
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors: errors
    };
}

/**
 * Validate group data
 * @param {Object} data - Group data
 * @returns {{valid: boolean, errors: Object}} Validation result with errors by field
 */
export function validateGroup(data) {
    const errors = {};

    // Validate name
    const nameResult = validateRequired(data.name, 'Group name');
    if (!nameResult.valid) {
        errors.name = nameResult.error;
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors: errors
    };
}

/**
 * Validate user registration data
 * @param {Object} data - User registration data
 * @returns {{valid: boolean, errors: Object}} Validation result with errors by field
 */
export function validateUserRegistration(data) {
    const errors = {};

    // Validate email
    if (!validateEmail(data.email)) {
        errors.email = 'Invalid email address';
    }

    // Validate password
    const passwordResult = validatePassword(data.password);
    if (!passwordResult.valid) {
        errors.password = passwordResult.error;
    }

    // Validate password confirmation
    if (data.confirm_password) {
        const confirmResult = validatePasswordConfirm(data.password, data.confirm_password);
        if (!confirmResult.valid) {
            errors.confirm_password = confirmResult.error;
        }
    }

    // Validate full name
    const nameResult = validateRequired(data.full_name, 'Full name');
    if (!nameResult.valid) {
        errors.full_name = nameResult.error;
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors: errors
    };
}

/**
 * Validate numeric value
 * @param {any} value - Value to validate
 * @param {number} min - Minimum value (optional)
 * @param {number} max - Maximum value (optional)
 * @param {string} fieldName - Field name for error message
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateNumeric(value, min = null, max = null, fieldName = 'Field') {
    const numValue = Number(value);

    if (isNaN(numValue)) {
        return {
            valid: false,
            error: `${fieldName} must be a number`
        };
    }

    if (min !== null && numValue < min) {
        return {
            valid: false,
            error: `${fieldName} must be at least ${min}`
        };
    }

    if (max !== null && numValue > max) {
        return {
            valid: false,
            error: `${fieldName} must be no more than ${max}`
        };
    }

    return {
        valid: true,
        error: null
    };
}

/**
 * Validate URL
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
export function validateURL(url) {
    if (!url || typeof url !== 'string') return false;

    try {
        new URL(url);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Validate array (not empty)
 * @param {any} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateArray(value, fieldName = 'Field') {
    const isValidArray = Array.isArray(value) && value.length > 0;

    return {
        valid: isValidArray,
        error: isValidArray ? null : `${fieldName} must have at least one item`
    };
}

/**
 * Sanitize HTML string (remove potentially dangerous tags)
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML string
 */
export function sanitizeHTML(html) {
    if (!html || typeof html !== 'string') return '';

    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
}

/**
 * Sanitize input string (trim and remove control characters)
 * @param {string} input - Input string to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeInput(input) {
    if (!input || typeof input !== 'string') return '';

    // Remove control characters and trim
    return input.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

/**
 * Validate form data against schema
 * @param {Object} data - Form data
 * @param {Object} schema - Validation schema
 * @returns {{valid: boolean, errors: Object}} Validation result
 */
export function validateForm(data, schema) {
    const errors = {};

    for (const [field, rules] of Object.entries(schema)) {
        const value = data[field];

        // Check required
        if (rules.required) {
            const requiredResult = validateRequired(value, rules.label || field);
            if (!requiredResult.valid) {
                errors[field] = requiredResult.error;
                continue;
            }
        }

        // Skip other validations if value is empty and not required
        if (!value && !rules.required) continue;

        // Check type-specific validations
        if (rules.type === 'email' && !validateEmail(value)) {
            errors[field] = `${rules.label || field} must be a valid email`;
        } else if (rules.type === 'phone' && !validatePhone(value)) {
            errors[field] = `${rules.label || field} must be a valid phone number`;
        } else if (rules.type === 'url' && !validateURL(value)) {
            errors[field] = `${rules.label || field} must be a valid URL`;
        } else if (rules.type === 'date' && !isValidDate(value)) {
            errors[field] = `${rules.label || field} must be a valid date`;
        } else if (rules.type === 'number') {
            const numResult = validateNumeric(value, rules.min, rules.max, rules.label || field);
            if (!numResult.valid) {
                errors[field] = numResult.error;
            }
        }

        // Check min/max length for strings
        if (rules.minLength) {
            const minResult = validateMinLength(value, rules.minLength, rules.label || field);
            if (!minResult.valid) {
                errors[field] = minResult.error;
            }
        }

        if (rules.maxLength) {
            const maxResult = validateMaxLength(value, rules.maxLength, rules.label || field);
            if (!maxResult.valid) {
                errors[field] = maxResult.error;
            }
        }

        // Custom validation function
        if (rules.validate && typeof rules.validate === 'function') {
            const customResult = rules.validate(value, data);
            if (customResult !== true) {
                errors[field] = typeof customResult === 'string' ? customResult : `${rules.label || field} is invalid`;
            }
        }
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors: errors
    };
}

/**
 * Validate money amount (Financial validation)
 * @param {any} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Object} options - Validation options
 * @returns {{valid: boolean, error: string|null, value: number|null}} Validation result
 */
export function validateMoney(value, fieldName = 'Amount', options = {}) {
    const { min = 0, max = Infinity, required = true } = options;

    if (required && (value === null || value === undefined || value === '')) {
        return {
            valid: false,
            error: `${fieldName} is required`,
            value: null
        };
    }

    if (!required && (value === null || value === undefined || value === '')) {
        return { valid: true, error: null, value: 0 };
    }

    const numeric = parseFloat(value);

    if (Number.isNaN(numeric)) {
        return {
            valid: false,
            error: `${fieldName} must be a valid number`,
            value: null
        };
    }

    if (numeric < min) {
        return {
            valid: false,
            error: `${fieldName} must be at least ${min}`,
            value: null
        };
    }

    if (numeric > max) {
        return {
            valid: false,
            error: `${fieldName} cannot exceed ${max}`,
            value: null
        };
    }

    return { valid: true, error: null, value: numeric };
}

/**
 * Validate date field
 * @param {any} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Object} options - Validation options
 * @returns {{valid: boolean, error: string|null, value: Date|null}} Validation result
 */
export function validateDateField(value, fieldName = 'Date', options = {}) {
    const { required = true, minDate = null, maxDate = null } = options;

    if (required && !value) {
        return {
            valid: false,
            error: `${fieldName} is required`,
            value: null
        };
    }

    if (!required && !value) {
        return { valid: true, error: null, value: null };
    }

    if (!isValidDate(value)) {
        return {
            valid: false,
            error: `${fieldName} must be a valid date`,
            value: null
        };
    }

    const date = new Date(value);

    if (minDate && date < new Date(minDate)) {
        return {
            valid: false,
            error: `${fieldName} cannot be before ${minDate}`,
            value: null
        };
    }

    if (maxDate && date > new Date(maxDate)) {
        return {
            valid: false,
            error: `${fieldName} cannot be after ${maxDate}`,
            value: null
        };
    }

    return { valid: true, error: null, value: date };
}

/**
 * Validate positive integer
 * @param {any} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Object} options - Validation options
 * @returns {{valid: boolean, error: string|null, value: number|null}} Validation result
 */
export function validatePositiveInteger(value, fieldName = 'Number', options = {}) {
    const { required = true, min = 1 } = options;

    if (required && (value === null || value === undefined || value === '')) {
        return {
            valid: false,
            error: `${fieldName} is required`,
            value: null
        };
    }

    if (!required && (value === null || value === undefined || value === '')) {
        return { valid: true, error: null, value: null };
    }

    const numeric = parseInt(value, 10);

    if (!Number.isInteger(numeric) || numeric < min) {
        return {
            valid: false,
            error: `${fieldName} must be a positive integer`,
            value: null
        };
    }

    return { valid: true, error: null, value: numeric };
}

/**
 * Sanitize money input (remove non-numeric characters except decimal)
 * @param {string} value - Input value
 * @returns {string} Sanitized value
 */
export function sanitizeMoneyInput(value) {
    if (!value) return '';
    return String(value).replace(/[^0-9.]/g, '');
}

/**
 * Sanitize text input (basic cleanup)
 * @param {string} value - Input value
 * @param {number} maxLength - Maximum length
 * @returns {string} Sanitized value
 */
export function sanitizeTextInput(value, maxLength = 1000) {
    if (!value) return '';
    return String(value)
        .trim()
        .substring(0, maxLength)
        .replace(/[<>]/g, ''); // Basic tag prevention
}
