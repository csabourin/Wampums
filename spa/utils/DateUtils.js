/**
 * DateUtils.js
 *
 * Centralized date manipulation and formatting utilities for the Wampums application.
 * Consolidates date functions scattered across multiple files.
 *
 * Usage:
 *   import { formatDate, parseDate, getTodayISO } from './utils/DateUtils.js';
 */
import { debugError } from './DebugUtils.js';


/**
 * Get today's date in ISO format (YYYY-MM-DD)
 * @returns {string} Today's date in ISO format
 */
export function getTodayISO() {
    return new Date().toLocaleDateString("en-CA");
}

/**
 * Format a date string for display with localization
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @param {string} lang - Language code ('en', 'fr', etc.)
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
 */
export function formatDate(dateString, lang = 'en', options = null) {
    if (!dateString) return '';

    try {
        // Always parse as local date to avoid timezone issues
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(year, month - 1, day);

        if (isNaN(date.getTime())) {
            return '';
        }

        const defaultOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };

        return date.toLocaleDateString(lang, options || defaultOptions);
    } catch (error) {
        debugError('Error formatting date:', error);
        return dateString;
    }
}

/**
 * Format a date string for display (short version)
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @param {string} lang - Language code ('en', 'fr', etc.)
 * @returns {string} Formatted date string
 */
export function formatDateShort(dateString, lang = 'en') {
    if (!dateString) return '';

    try {
        const [year, month, day] = dateString.split('-').map(Number);
        const date = new Date(year, month - 1, day);

        return date.toLocaleDateString(lang, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (error) {
        debugError('Error formatting date short:', error);
        return dateString;
    }
}

/**
 * Parse a date string and return a Date object in local time
 * @param {string|Date} dateSource - Date string in YYYY-MM-DD format or Date object
 * @returns {Date|null} Date object or null if invalid
 */
export function parseDate(dateSource) {
    if (!dateSource) return null;

    try {
        if (dateSource instanceof Date) {
            return new Date(dateSource.getTime());
        }

        if (typeof dateSource !== 'string') return null;

        // If it's an ISO string with time, convert to date part first
        const datePart = isoToDateString(dateSource);
        const [year, month, day] = datePart.split('-').map(Number);

        if (!year || !month || !day) return null;

        return new Date(year, month - 1, day);
    } catch (error) {
        debugError('Error parsing date:', error);
        return null;
    }
}

/**
 * Validate if a string is a valid date in YYYY-MM-DD format
 * @param {string} dateString - Date string to validate
 * @returns {boolean} True if valid date
 */
export function isValidDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return false;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateString)) return false;

    const date = parseDate(dateString);
    return date instanceof Date && !isNaN(date);
}

/**
 * Convert an ISO date string (with time) or Date object to YYYY-MM-DD format
 * Ensures the date is treated as the local day, avoiding timezone shifts.
 * @param {string|Date} dateSource - ISO date string (e.g., '2025-12-01T00:00:00Z') or Date object
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function isoToDateString(dateSource) {
    if (!dateSource) return '';

    try {
        if (dateSource instanceof Date) {
            return dateSource.toLocaleDateString("en-CA"); // Always returns YYYY-MM-DD
        }

        if (typeof dateSource !== 'string') return '';

        // If it's already a YYYY-MM-DD string, return it
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateSource)) {
            return dateSource;
        }

        // If it's an ISO string with time (e.g. from database)
        if (dateSource.includes('T')) {
            // Split by T to get the date part. 
            // IMPORTANT: We take the date part literally from the string to avoid timezone shifts
            // that happen when parsing "2025-01-01T00:00:00Z" as a Date object.
            return dateSource.split('T')[0];
        }

        return dateSource;
    } catch (error) {
        debugError('Error converting to date string:', error);
        return String(dateSource);
    }
}

/**
 * Format time to HH:MM format
 * @param {number} hours - Hours (0-23)
 * @param {number} minutes - Minutes (0-59)
 * @returns {string} Time string in HH:MM format
 */
export function formatTime(hours, minutes) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Format minutes to HH:MM format
 * @param {number} totalMinutes - Total minutes
 * @returns {string} Time string in HH:MM format
 */
export function formatMinutesToHHMM(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Parse time string (HH:MM) to hours and minutes
 * @param {string} timeString - Time string in HH:MM format
 * @returns {{hours: number, minutes: number}} Object with hours and minutes
 */
export function parseTime(timeString) {
    if (!timeString) return { hours: 0, minutes: 0 };

    try {
        const [hours, minutes] = timeString.split(':').map(Number);
        return { hours: hours || 0, minutes: minutes || 0 };
    } catch (error) {
        debugError('Error parsing time:', error);
        return { hours: 0, minutes: 0 };
    }
}

/**
 * Convert time string to total minutes
 * @param {string} timeString - Time string in HH:MM format
 * @returns {number} Total minutes
 */
export function timeToMinutes(timeString) {
    const { hours, minutes } = parseTime(timeString);
    return (hours * 60) + minutes;
}

/**
 * Add duration to a start time
 * @param {string} startTime - Start time in HH:MM format
 * @param {number} durationMinutes - Duration in minutes
 * @returns {string} End time in HH:MM format
 */
export function addDuration(startTime, durationMinutes) {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = startMinutes + durationMinutes;
    return formatMinutesToHHMM(endMinutes);
}

/**
 * Get date range array between two dates
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {string[]} Array of date strings in YYYY-MM-DD format
 */
export function getDateRange(startDate, endDate) {
    const dates = [];
    const start = parseDate(startDate);
    const end = parseDate(endDate);

    if (!start || !end || start > end) return [];

    const current = new Date(start);
    while (current <= end) {
        dates.push(current.toLocaleDateString("en-CA"));
        current.setDate(current.getDate() + 1);
    }

    return dates;
}

/**
 * Check if a date is in the past
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @returns {boolean} True if date is in the past
 */
export function isPastDate(dateString) {
    const date = parseDate(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!date) return false;
    return date < today;
}

/**
 * Check if a date is today
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @returns {boolean} True if date is today
 */
export function isToday(dateString) {
    return dateString === getTodayISO();
}

/**
 * Check if a date is in the future
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @returns {boolean} True if date is in the future
 */
export function isFutureDate(dateString) {
    const date = parseDate(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!date) return false;
    return date > today;
}

/**
 * Get the next occurrence of a specific day of the week
 * @param {string} dayName - Day name (e.g., 'Monday', 'Tuesday')
 * @param {Date} fromDate - Starting date (defaults to today)
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getNextDayOfWeek(dayName, fromDate = new Date()) {
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const targetDayIndex = daysOfWeek.indexOf(dayName);

    if (targetDayIndex === -1) {
        throw new Error(`Invalid day name: ${dayName}`);
    }

    const today = new Date(fromDate);
    const todayIndex = today.getDay();

    // Calculate days until the next target day
    let daysUntilNext = (targetDayIndex - todayIndex + 7) % 7;

    // If today is the target day and it's after 8 PM, set to next week
    if (daysUntilNext === 0 && today.getHours() >= 20) {
        daysUntilNext = 7;
    }

    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + daysUntilNext);

    return nextDate.toLocaleDateString("en-CA");
}

/**
 * Sort dates in ascending order
 * @param {string[]} dates - Array of date strings in YYYY-MM-DD format
 * @returns {string[]} Sorted array of date strings
 */
export function sortDatesAscending(dates) {
    return [...dates].sort((a, b) => new Date(a) - new Date(b));
}

/**
 * Sort dates in descending order
 * @param {string[]} dates - Array of date strings in YYYY-MM-DD format
 * @returns {string[]} Sorted array of date strings
 */
export function sortDatesDescending(dates) {
    return [...dates].sort((a, b) => new Date(b) - new Date(a));
}

/**
 * Format a timestamp for display
 * @param {string|Date} timestamp - Timestamp to format
 * @param {string} lang - Language code ('en', 'fr', etc.)
 * @returns {string} Formatted timestamp string
 */
export function formatTimestamp(timestamp, lang = 'en') {
    try {
        const date = new Date(timestamp);
        return date.toLocaleString(lang, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        debugError('Error formatting timestamp:', error);
        return String(timestamp);
    }
}

/**
 * Get relative time string (e.g., "2 days ago", "in 3 hours")
 * @param {string|Date} date - Date to compare
 * @param {string} lang - Language code ('en', 'fr', etc.)
 * @returns {string} Relative time string
 */
export function getRelativeTime(date, lang = 'en') {
    const now = new Date();
    const target = new Date(date);
    const diffMs = target - now;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (Math.abs(diffDays) > 7) {
        return formatDate(target.toLocaleDateString("en-CA"), lang);
    }

    try {
        const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });

        if (Math.abs(diffDays) >= 1) {
            return rtf.format(diffDays, 'day');
        } else if (Math.abs(diffHours) >= 1) {
            return rtf.format(diffHours, 'hour');
        } else if (Math.abs(diffMins) >= 1) {
            return rtf.format(diffMins, 'minute');
        } else {
            return rtf.format(diffSecs, 'second');
        }
    } catch (error) {
        debugError('Error getting relative time:', error);
        return formatDate(target.toLocaleDateString("en-CA"), lang);
    }
}
