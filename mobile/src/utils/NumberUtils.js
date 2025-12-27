/**
 * Number Utilities for Wampums React Native App
 *
 * Provides locale-aware number and currency formatting
 * Mirrors number formatting behavior from web app
 */

import { getCurrentLanguage } from '../i18n';
import { debugError } from './DebugUtils.js';

/**
 * Format number according to locale
 * @param {number} value - Number to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @param {string} locale - Locale override (optional, uses current language)
 */
export const formatNumber = (value, decimals = 2, locale = null) => {
  if (value === null || value === undefined || isNaN(value)) {
    return '';
  }

  const lang = locale || getCurrentLanguage();
  const localeStr = lang === 'fr' ? 'fr-CA' : 'en-CA';

  try {
    return new Intl.NumberFormat(localeStr, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch (error) {
    debugError('Error formatting number:', error);
    return value.toFixed(decimals);
  }
};

/**
 * Format currency according to locale
 * @param {number} value - Amount to format
 * @param {string} currency - Currency code (default: CAD)
 * @param {string} locale - Locale override (optional, uses current language)
 */
export const formatCurrency = (value, currency = 'CAD', locale = null) => {
  if (value === null || value === undefined || isNaN(value)) {
    return '';
  }

  const lang = locale || getCurrentLanguage();
  const localeStr = lang === 'fr' ? 'fr-CA' : 'en-CA';

  try {
    return new Intl.NumberFormat(localeStr, {
      style: 'currency',
      currency: currency,
    }).format(value);
  } catch (error) {
    debugError('Error formatting currency:', error);
    return `$${value.toFixed(2)}`;
  }
};

/**
 * Format percentage according to locale
 * @param {number} value - Percentage value (e.g., 0.15 for 15%)
 * @param {number} decimals - Number of decimal places (default: 0)
 * @param {string} locale - Locale override (optional, uses current language)
 */
export const formatPercentage = (value, decimals = 0, locale = null) => {
  if (value === null || value === undefined || isNaN(value)) {
    return '';
  }

  const lang = locale || getCurrentLanguage();
  const localeStr = lang === 'fr' ? 'fr-CA' : 'en-CA';

  try {
    return new Intl.NumberFormat(localeStr, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch (error) {
    debugError('Error formatting percentage:', error);
    return `${(value * 100).toFixed(decimals)}%`;
  }
};

/**
 * Parse number from localized string
 * @param {string} str - Localized number string
 * @param {string} locale - Locale override (optional, uses current language)
 */
export const parseNumber = (str, locale = null) => {
  if (!str || typeof str !== 'string') {
    return NaN;
  }

  const lang = locale || getCurrentLanguage();

  // Remove currency symbols and spaces
  let cleaned = str.replace(/[$\s]/g, '');

  // Handle locale-specific decimal separators
  if (lang === 'fr') {
    // French uses comma as decimal separator and space as thousands separator
    cleaned = cleaned.replace(/\s/g, '').replace(',', '.');
  } else {
    // English uses period as decimal separator and comma as thousands separator
    cleaned = cleaned.replace(/,/g, '');
  }

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? NaN : parsed;
};

/**
 * Round number to specified decimal places
 */
export const roundNumber = (value, decimals = 2) => {
  if (value === null || value === undefined || isNaN(value)) {
    return 0;
  }

  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
};

/**
 * Clamp number between min and max
 */
export const clampNumber = (value, min, max) => {
  if (value === null || value === undefined || isNaN(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
};

/**
 * Check if value is a valid number
 */
export const isValidNumber = (value) => {
  return value !== null && value !== undefined && !isNaN(value) && isFinite(value);
};

/**
 * Format file size in human-readable format
 */
export const formatFileSize = (bytes, decimals = 2, locale = null) => {
  if (bytes === 0) return '0 Bytes';
  if (!bytes || isNaN(bytes)) return '';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const value = bytes / Math.pow(k, i);
  return `${formatNumber(value, decimals, locale)} ${sizes[i]}`;
};

/**
 * Format large numbers with abbreviations (e.g., 1.2K, 3.4M)
 */
export const formatCompactNumber = (value, locale = null) => {
  if (value === null || value === undefined || isNaN(value)) {
    return '';
  }

  const lang = locale || getCurrentLanguage();
  const localeStr = lang === 'fr' ? 'fr-CA' : 'en-CA';

  try {
    return new Intl.NumberFormat(localeStr, {
      notation: 'compact',
      compactDisplay: 'short',
    }).format(value);
  } catch (error) {
    debugError('Error formatting compact number:', error);

    // Fallback formatting
    const absValue = Math.abs(value);
    if (absValue >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    if (absValue >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
  }
};

/**
 * Calculate percentage
 */
export const calculatePercentage = (value, total) => {
  if (!isValidNumber(value) || !isValidNumber(total) || total === 0) {
    return 0;
  }

  return (value / total) * 100;
};

/**
 * Format ordinal number (1st, 2nd, 3rd, etc.)
 */
export const formatOrdinal = (value, locale = null) => {
  if (!isValidNumber(value)) {
    return '';
  }

  const lang = locale || getCurrentLanguage();
  const num = Math.floor(value);

  if (lang === 'fr') {
    // French ordinals
    if (num === 1) return '1er';
    return `${num}e`;
  } else {
    // English ordinals
    const suffix = ['th', 'st', 'nd', 'rd'];
    const v = num % 100;
    return num + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
  }
};

/**
 * Sum array of numbers
 */
export const sumNumbers = (numbers) => {
  if (!Array.isArray(numbers)) {
    return 0;
  }

  return numbers.reduce((sum, num) => {
    return sum + (isValidNumber(num) ? num : 0);
  }, 0);
};

/**
 * Average array of numbers
 */
export const averageNumbers = (numbers) => {
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return 0;
  }

  const validNumbers = numbers.filter(isValidNumber);
  if (validNumbers.length === 0) {
    return 0;
  }

  return sumNumbers(validNumbers) / validNumbers.length;
};

/**
 * Format points/score
 */
export const formatPoints = (points, locale = null) => {
  if (!isValidNumber(points)) {
    return '0';
  }

  return formatNumber(points, 0, locale);
};

/**
 * Format decimal to fraction (e.g., 0.5 -> "1/2")
 */
export const formatFraction = (decimal) => {
  if (!isValidNumber(decimal)) {
    return '';
  }

  // Common fractions
  const fractions = {
    0.25: '1/4',
    0.33: '1/3',
    0.5: '1/2',
    0.66: '2/3',
    0.75: '3/4',
  };

  const rounded = roundNumber(decimal, 2);
  return fractions[rounded] || formatNumber(decimal, 2);
};

export default {
  formatNumber,
  formatCurrency,
  formatPercentage,
  parseNumber,
  roundNumber,
  clampNumber,
  isValidNumber,
  formatFileSize,
  formatCompactNumber,
  calculatePercentage,
  formatOrdinal,
  sumNumbers,
  averageNumbers,
  formatPoints,
  formatFraction,
};
