/**
 * Date Utilities for Wampums React Native App
 *
 * Provides locale-aware date and time formatting
 * Mirrors date formatting behavior from web app
 */

import { getCurrentLanguage } from '../i18n';
import CONFIG from '../config';
import { debugError } from './DebugUtils.js';

/**
 * Format date according to locale
 * @param {Date|string|number} date - Date to format
 * @param {string} format - Format string (optional, uses default from config)
 * @param {string} locale - Locale override (optional, uses current language)
 */
export const formatDate = (date, format = null, locale = null) => {
  if (!date) return '';

  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return '';

  const lang = locale || getCurrentLanguage();
  const formatStr = format || CONFIG.LOCALE.DATE_FORMAT;

  try {
    // For simple format strings, use custom formatting
    if (formatStr === 'YYYY-MM-DD') {
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // For localized formats, use Intl.DateTimeFormat
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    };

    return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', options).format(dateObj);
  } catch (error) {
    debugError('Error formatting date:', error);
    return dateObj.toLocaleDateString();
  }
};

/**
 * Format time according to locale
 * @param {Date|string|number} time - Time to format
 * @param {string} format - Format string (optional, uses default from config)
 * @param {string} locale - Locale override (optional, uses current language)
 */
export const formatTime = (time, format = null, locale = null) => {
  if (!time) return '';

  const dateObj = time instanceof Date ? time : new Date(time);
  if (isNaN(dateObj.getTime())) return '';

  const lang = locale || getCurrentLanguage();
  const formatStr = format || CONFIG.LOCALE.TIME_FORMAT;

  try {
    // For HH:mm format
    if (formatStr === 'HH:mm') {
      const hours = String(dateObj.getHours()).padStart(2, '0');
      const minutes = String(dateObj.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }

    // For localized formats, use Intl.DateTimeFormat
    const options = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: lang === 'en', // 12-hour for English, 24-hour for French
    };

    return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', options).format(dateObj);
  } catch (error) {
    debugError('Error formatting time:', error);
    return dateObj.toLocaleTimeString();
  }
};

/**
 * Format datetime according to locale
 * @param {Date|string|number} datetime - DateTime to format
 * @param {string} format - Format string (optional, uses default from config)
 * @param {string} locale - Locale override (optional, uses current language)
 */
export const formatDateTime = (datetime, format = null, locale = null) => {
  if (!datetime) return '';

  const dateObj = datetime instanceof Date ? datetime : new Date(datetime);
  if (isNaN(dateObj.getTime())) return '';

  const lang = locale || getCurrentLanguage();
  const formatStr = format || CONFIG.LOCALE.DATETIME_FORMAT;

  try {
    // For YYYY-MM-DD HH:mm format
    if (formatStr === 'YYYY-MM-DD HH:mm') {
      return `${formatDate(dateObj)} ${formatTime(dateObj)}`;
    }

    // For localized formats, use Intl.DateTimeFormat
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: lang === 'en',
    };

    return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', options).format(dateObj);
  } catch (error) {
    debugError('Error formatting datetime:', error);
    return dateObj.toLocaleString();
  }
};

/**
 * Format date in relative format (e.g., "2 days ago", "in 3 hours")
 */
export const formatRelativeDate = (date, locale = null) => {
  if (!date) return '';

  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return '';

  const lang = locale || getCurrentLanguage();
  const now = new Date();
  const diffMs = dateObj.getTime() - now.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  const rtf = new Intl.RelativeTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    numeric: 'auto',
  });

  try {
    if (Math.abs(diffDays) >= 1) {
      return rtf.format(diffDays, 'day');
    }
    if (Math.abs(diffHours) >= 1) {
      return rtf.format(diffHours, 'hour');
    }
    if (Math.abs(diffMins) >= 1) {
      return rtf.format(diffMins, 'minute');
    }
    return rtf.format(diffSecs, 'second');
  } catch (error) {
    debugError('Error formatting relative date:', error);
    return formatDateTime(dateObj);
  }
};

/**
 * Get day of week name
 */
export const getDayName = (date, short = false, locale = null) => {
  if (!date) return '';

  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return '';

  const lang = locale || getCurrentLanguage();

  const options = {
    weekday: short ? 'short' : 'long',
  };

  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', options).format(dateObj);
};

/**
 * Get month name
 */
export const getMonthName = (date, short = false, locale = null) => {
  if (!date) return '';

  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return '';

  const lang = locale || getCurrentLanguage();

  const options = {
    month: short ? 'short' : 'long',
  };

  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', options).format(dateObj);
};

/**
 * Parse date from string
 */
export const parseDate = (dateString) => {
  if (!dateString) return null;

  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Check if date is today
 */
export const isToday = (date) => {
  if (!date) return false;

  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return false;

  const today = new Date();
  return (
    dateObj.getDate() === today.getDate() &&
    dateObj.getMonth() === today.getMonth() &&
    dateObj.getFullYear() === today.getFullYear()
  );
};

/**
 * Check if date is in the past
 */
export const isPast = (date) => {
  if (!date) return false;

  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return false;

  return dateObj.getTime() < Date.now();
};

/**
 * Check if date is in the future
 */
export const isFuture = (date) => {
  if (!date) return false;

  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return false;

  return dateObj.getTime() > Date.now();
};

/**
 * Add days to date
 */
export const addDays = (date, days) => {
  const dateObj = date instanceof Date ? new Date(date) : new Date(date);
  dateObj.setDate(dateObj.getDate() + days);
  return dateObj;
};

/**
 * Calculate age from birthdate
 */
export const calculateAge = (birthdate) => {
  if (!birthdate) return null;

  const birthdateObj = birthdate instanceof Date ? birthdate : new Date(birthdate);
  if (isNaN(birthdateObj.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthdateObj.getFullYear();
  const monthDiff = today.getMonth() - birthdateObj.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdateObj.getDate())) {
    age--;
  }

  return age;
};

/**
 * Get start of day
 */
export const startOfDay = (date) => {
  const dateObj = date instanceof Date ? new Date(date) : new Date(date);
  dateObj.setHours(0, 0, 0, 0);
  return dateObj;
};

/**
 * Get end of day
 */
export const endOfDay = (date) => {
  const dateObj = date instanceof Date ? new Date(date) : new Date(date);
  dateObj.setHours(23, 59, 59, 999);
  return dateObj;
};

/**
 * Validate date string or Date object
 * @param {string|Date} date - Date to validate
 * @returns {boolean} True if valid date
 */
export const isValidDate = (date) => {
  if (!date) return false;

  const dateObj = date instanceof Date ? date : new Date(date);
  return !isNaN(dateObj.getTime());
};

/**
 * Get current fiscal year (September 1 - August 31)
 * @returns {Object} Fiscal year object with start, end, and label
 */
export const getCurrentFiscalYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (month >= 8) {
    // September or later
    return {
      start: `${year}-09-01`,
      end: `${year + 1}-08-31`,
      label: `${year}-${year + 1}`,
    };
  } else {
    return {
      start: `${year - 1}-09-01`,
      end: `${year}-08-31`,
      label: `${year - 1}-${year}`,
    };
  }
};

/**
 * Get today's date in ISO format (YYYY-MM-DD)
 * @returns {string} Today's date
 */
export const getTodayISO = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default {
  formatDate,
  formatTime,
  formatDateTime,
  formatRelativeDate,
  getDayName,
  getMonthName,
  parseDate,
  isToday,
  isPast,
  isFuture,
  addDays,
  calculateAge,
  startOfDay,
  endOfDay,
  isValidDate,
  getCurrentFiscalYear,
  getTodayISO,
};
