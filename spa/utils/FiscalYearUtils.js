/**
 * FiscalYearUtils.js
 * 
 * Reusable utilities for fiscal year calculations and dropdowns.
 * Supports organization-specific fiscal year start dates (default: September 1).
 * 
 * Usage:
 *   import { getFiscalYearOptions, getCurrentFiscalYear, formatFiscalYearLabel } from './FiscalYearUtils.js';
 *   
 *   const options = getFiscalYearOptions(app.organizationSettings);
 *   const current = getCurrentFiscalYear(app.organizationSettings);
 */

import { debugLog, debugError } from './DebugUtils.js';

/**
 * Get fiscal year start date from organization settings
 * Falls back to September 1 if not configured
 * Reads from organizationSettings.fiscal_year JSONB setting
 * 
 * @param {object} organizationSettings - Organization settings object
 * @returns {object} Object with month (1-12) and day (1-31)
 */
export function getFiscalYearStartDate(organizationSettings) {
  // Try to get from fiscal_year setting (JSONB)
  let fiscalYearSetting = null;
  
  if (organizationSettings) {
    // If it's an object with fiscal_year property
    if (organizationSettings.fiscal_year) {
      fiscalYearSetting = organizationSettings.fiscal_year;
    }
  }
  
  // Defaults to September 1
  const month = fiscalYearSetting?.start_month || 9;
  const day = fiscalYearSetting?.start_day || 1;
  
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    debugError(`Invalid fiscal year settings: month=${month}, day=${day}. Using defaults.`);
    return { month: 9, day: 1 };
  }
  
  return { month, day };
}

/**
 * Calculate fiscal year for a given date
 * 
 * @param {Date|string} dateArg - Date to calculate fiscal year for (Date object or ISO string)
 * @param {object} organizationSettings - Organization settings object
 * @returns {object} Object with {year, label, start, end}
 *   - year: Starting year of fiscal period
 *   - label: Formatted label like "2024 – 2025"
 *   - start: ISO date string for fiscal year start (YYYY-MM-DD)
 *   - end: ISO date string for fiscal year end (YYYY-MM-DD)
 */
export function calculateFiscalYear(dateArg, organizationSettings) {
  const { month, day } = getFiscalYearStartDate(organizationSettings);
  
  const date = dateArg instanceof Date ? dateArg : new Date(dateArg);
  const currentYear = date.getFullYear();
  const currentMonth = date.getMonth() + 1; // 0-indexed to 1-indexed
  const currentDay = date.getDate();
  
  // Check if we're in or past the fiscal year start month
  const isFiscalYearStarted = 
    currentMonth > month || 
    (currentMonth === month && currentDay >= day);
  
  let fiscalYearStart;
  let fiscalYearEnd;
  
  if (isFiscalYearStarted) {
    // Current fiscal year started this year
    fiscalYearStart = currentYear;
    fiscalYearEnd = currentYear + 1;
  } else {
    // Current fiscal year started last year
    fiscalYearStart = currentYear - 1;
    fiscalYearEnd = currentYear;
  }
  
  // Build ISO date strings
  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  
  const startDate = `${fiscalYearStart}-${monthStr}-${dayStr}`;
  
  // Calculate end date (day before fiscal year start next year)
  const endYear = fiscalYearEnd;
  const endMonth = month - 1 === 0 ? 12 : month - 1;
  const endDay = endMonth === 12 ? 31 : new Date(endYear, endMonth, 0).getDate();
  const endMonthStr = String(endMonth).padStart(2, '0');
  const endDayStr = String(endDay).padStart(2, '0');
  
  const endDateStr = `${endYear}-${endMonthStr}-${endDayStr}`;
  
  return {
    year: fiscalYearStart,
    label: `${fiscalYearStart} – ${fiscalYearEnd}`,
    start: startDate,
    end: endDateStr
  };
}

/**
 * Get current fiscal year
 * 
 * @param {object} organizationSettings - Organization settings object
 * @returns {object} Object with {year, label, start, end}
 */
export function getCurrentFiscalYear(organizationSettings) {
  return calculateFiscalYear(new Date(), organizationSettings);
}

/**
 * Generate array of fiscal year options (past 3 + current + next 3)
 * 
 * @param {object} organizationSettings - Organization settings object
 * @param {number} yearsBack - Number of past years to include (default: 3)
 * @param {number} yearsAhead - Number of future years to include (default: 3)
 * @returns {array} Array of fiscal year objects [{year, label, start, end}, ...]
 */
export function getFiscalYearOptions(organizationSettings, yearsBack = 3, yearsAhead = 3) {
  const current = getCurrentFiscalYear(organizationSettings);
  const { month, day } = getFiscalYearStartDate(organizationSettings);
  
  const options = [];
  
  // Add past years
  for (let i = yearsBack; i > 0; i--) {
    const year = current.year - i;
    const startYear = year;
    const endYear = year + 1;
    
    const monthStr = String(month).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const startDate = `${startYear}-${monthStr}-${dayStr}`;
    
    const endMonth = month - 1 === 0 ? 12 : month - 1;
    const endDay = endMonth === 12 ? 31 : new Date(endYear, endMonth, 0).getDate();
    const endMonthStr = String(endMonth).padStart(2, '0');
    const endDayStr = String(endDay).padStart(2, '0');
    const endDate = `${endYear}-${endMonthStr}-${endDayStr}`;
    
    options.push({
      year: startYear,
      label: `${startYear} – ${endYear}`,
      start: startDate,
      end: endDate
    });
  }
  
  // Add current year
  options.push(current);
  
  // Add future years
  for (let i = 1; i <= yearsAhead; i++) {
    const year = current.year + i;
    const startYear = year;
    const endYear = year + 1;
    
    const monthStr = String(month).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const startDate = `${startYear}-${monthStr}-${dayStr}`;
    
    const endMonth = month - 1 === 0 ? 12 : month - 1;
    const endDay = endMonth === 12 ? 31 : new Date(endYear, endMonth, 0).getDate();
    const endMonthStr = String(endMonth).padStart(2, '0');
    const endDayStr = String(endDay).padStart(2, '0');
    const endDate = `${endYear}-${endMonthStr}-${endDayStr}`;
    
    options.push({
      year: startYear,
      label: `${startYear} – ${endYear}`,
      start: startDate,
      end: endDate
    });
  }
  
  return options;
}

/**
 * Format fiscal year label
 * 
 * @param {number} year - Starting year of fiscal period
 * @param {object} organizationSettings - Organization settings object
 * @returns {string} Formatted label like "2024 – 2025"
 */
export function formatFiscalYearLabel(year, organizationSettings) {
  const endYear = year + 1;
  return `${year} – ${endYear}`;
}

/**
 * Create HTML for fiscal year dropdown
 * 
 * @param {object} organizationSettings - Organization settings object
 * @param {number} selectedYear - Currently selected fiscal year (default: current)
 * @returns {string} HTML for select dropdown
 */
export function createFiscalYearDropdownHTML(organizationSettings, selectedYear = null) {
  const current = getCurrentFiscalYear(organizationSettings);
  const selected = selectedYear || current.year;
  const options = getFiscalYearOptions(organizationSettings);
  
  const optionsHTML = options
    .map(opt => `<option value="${opt.year}" ${opt.year === selected ? 'selected' : ''}>${opt.label}</option>`)
    .join('');
  
  return `<select id="fiscal-year-select" class="fiscal-year-select">${optionsHTML}</select>`;
}

/**
 * Parse fiscal year from ISO dates
 * 
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @returns {number} Fiscal year (start year)
 */
export function getFiscalYearFromDates(startDate, endDate) {
  const year = parseInt(startDate.split('-')[0], 10);
  return year;
}

/**
 * Check if a date falls within a fiscal year
 * 
 * @param {Date|string} dateArg - Date to check
 * @param {number} fiscalYear - Fiscal year (start year)
 * @param {object} organizationSettings - Organization settings object
 * @returns {boolean} True if date is within the fiscal year
 */
export function isDateInFiscalYear(dateArg, fiscalYear, organizationSettings) {
  const date = dateArg instanceof Date ? dateArg : new Date(dateArg);
  const fy = calculateFiscalYear(date, organizationSettings);
  return fy.year === fiscalYear;
}

export default {
  getFiscalYearStartDate,
  calculateFiscalYear,
  getCurrentFiscalYear,
  getFiscalYearOptions,
  formatFiscalYearLabel,
  createFiscalYearDropdownHTML,
  getFiscalYearFromDates,
  isDateInFiscalYear
};
