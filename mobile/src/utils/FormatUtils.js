/**
 * Format Utilities for Wampums React Native App
 *
 * Provides formatting functions for currency, numbers, etc.
 */

import CONFIG from '../config';

/**
 * Format currency amount
 * @param {number|string} amount - Amount to format
 * @param {string} currency - Currency code (default: CAD from CONFIG)
 * @param {string} locale - Locale for formatting (default: en-CA)
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount, currency = null, locale = 'en-CA') => {
  const value = Number(amount) || 0;
  const currencyCode = currency || CONFIG.CURRENCY.DEFAULT;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (error) {
    // Fallback if Intl.NumberFormat fails
    return `$${value.toFixed(2)}`;
  }
};

/**
 * Format number with thousands separator
 * @param {number|string} number - Number to format
 * @param {number} decimals - Number of decimal places (default: 0)
 * @param {string} locale - Locale for formatting (default: en-CA)
 * @returns {string} Formatted number string
 */
export const formatNumber = (number, decimals = 0, locale = 'en-CA') => {
  const value = Number(number) || 0;

  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch (error) {
    return value.toFixed(decimals);
  }
};

/**
 * Format percentage
 * @param {number|string} value - Value to format as percentage
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted percentage string
 */
export const formatPercentage = (value, decimals = 1) => {
  const num = Number(value) || 0;
  return `${num.toFixed(decimals)}%`;
};

/**
 * Format phone number
 * @param {string} phone - Phone number to format
 * @returns {string} Formatted phone number
 */
export const formatPhoneNumber = (phone) => {
  if (!phone) return '';

  // Remove all non-numeric characters
  const cleaned = phone.replace(/\D/g, '');

  // Format as (XXX) XXX-XXXX for 10-digit numbers
  if (cleaned.length === 10) {
    return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
  }

  // Return as-is if not 10 digits
  return phone;
};

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length before truncation
 * @returns {string} Truncated text
 */
export const truncateText = (text, maxLength = 50) => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
};

export default {
  formatCurrency,
  formatNumber,
  formatPercentage,
  formatPhoneNumber,
  truncateText,
};
