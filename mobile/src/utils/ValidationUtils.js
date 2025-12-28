/**
 * Validation Utilities for Wampums React Native App
 *
 * Provides validation functions for forms and user input
 */

import { translate as t } from '../i18n';

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {string|null} Error message if invalid, null if valid
 */
export const validatePassword = (password) => {
  if (!password) {
    return t('password_required');
  }

  if (password.length < 8) {
    return t('password_min_length');
  }

  if (!/[A-Z]/.test(password)) {
    return t('password_needs_uppercase');
  }

  if (!/[a-z]/.test(password)) {
    return t('password_needs_lowercase');
  }

  if (!/[0-9]/.test(password)) {
    return t('password_needs_number');
  }

  return null;
};

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email
 */
export const validateEmail = (email) => {
  if (!email) return false;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number (Canadian format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid phone number
 */
export const validatePhoneNumber = (phone) => {
  if (!phone) return false;

  // Remove all non-numeric characters
  const cleaned = phone.replace(/\D/g, '');

  // Check if it's a valid 10-digit number
  return cleaned.length === 10;
};

/**
 * Validate required field
 * @param {any} value - Value to validate
 * @returns {boolean} True if value is not empty
 */
export const validateRequired = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

/**
 * Validate number range
 * @param {number|string} value - Value to validate
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @returns {boolean} True if value is within range
 */
export const validateNumberRange = (value, min, max) => {
  const num = Number(value);
  if (isNaN(num)) return false;
  return num >= min && num <= max;
};

/**
 * Validate date format (YYYY-MM-DD)
 * @param {string} dateString - Date string to validate
 * @returns {boolean} True if valid date format
 */
export const validateDateFormat = (dateString) => {
  if (!dateString) return false;

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) return false;

  // Check if it's a valid date
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

/**
 * Validate postal code (Canadian format)
 * @param {string} postalCode - Postal code to validate
 * @returns {boolean} True if valid Canadian postal code
 */
export const validatePostalCode = (postalCode) => {
  if (!postalCode) return false;

  // Canadian postal code format: A1A 1A1
  const postalCodeRegex = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
  return postalCodeRegex.test(postalCode);
};

export default {
  validatePassword,
  validateEmail,
  validatePhoneNumber,
  validateRequired,
  validateNumberRange,
  validateDateFormat,
  validatePostalCode,
};
