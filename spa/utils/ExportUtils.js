/**
 * ExportUtils.js
 * Utilities for exporting data to various formats (CSV, etc.)
 */

import { debugLog } from './DebugUtils.js';

const BYTE_ORDER_MARK = '﻿';
const CSV_ROW_BREAK = '\r\n';
const COMMA = ',';
const SEMICOLON = ';';

/** A number with a decimal, to see which mark a language writes it with. */
const DECIMAL_PROBE = 1.5;

/**
 * A number written with a point, as `toFixed()` and `String(number)` write it.
 * Spreadsheets set to a decimal-comma language read it as text, or as a date.
 */
const POINT_DECIMAL = /^-?\d+\.\d+$/;

/**
 * Text a spreadsheet would run as a formula: it starts with `=` or `@`, a tab
 * or a carriage return.
 */
const FORMULA_START = /^[=@\t\r]/;

/**
 * `+` or `-` followed by something other than a number or a phone number
 * (`-5`, `+1 819 555-0100` are data; `-2+3`, `+cmd|' /C calc'!A0` are not).
 */
const SIGNED_NON_DATA = /^[+-](?![\d\s().,-]*$)/;

/**
 * The delimiter a spreadsheet opens without asking: languages that write the
 * decimal comma (French, Italian, Ukrainian, Indonesian…) use a semicolon,
 * because their spreadsheets read a comma-separated file as one single column.
 *
 * @param {string} [lang] - Language code; defaults to the page language
 * @returns {string} `;` or `,`
 */
export function csvDelimiterForLanguage(lang) {
  const language = lang
    || (typeof document !== 'undefined' && document.documentElement.lang)
    || (typeof navigator !== 'undefined' && navigator.language)
    || 'en';
  try {
    const decimal = new Intl.NumberFormat(language).format(DECIMAL_PROBE);
    return decimal.includes(',') ? SEMICOLON : COMMA;
  } catch {
    return COMMA;
  }
}

/**
 * Make a value safe to open in a spreadsheet: a text that would run as a formula
 * (a parent may type `=HYPERLINK(…)` into an allergy field) is prefixed with an
 * apostrophe so it stays text.
 *
 * @param {string} text - Cell text
 * @returns {string} Cell text that cannot run as a formula
 */
function neutralizeFormula(text) {
  return FORMULA_START.test(text) || SIGNED_NON_DATA.test(text) ? `'${text}` : text;
}

/**
 * Quote a value when it holds the delimiter, a quote or a line break, and double
 * the quotes inside it.
 *
 * @param {string} str - Cell text
 * @param {string} [delimiter=','] - Column delimiter of the file
 * @returns {string} The cell as it is written in the file
 */
function escapeCSV(str, delimiter = COMMA) {
  if (str === null || str === undefined) {return '';}
  const stringValue = String(str);

  if (
    stringValue.includes(delimiter)
    || stringValue.includes('"')
    || stringValue.includes('\n')
    || stringValue.includes('\r')
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Turn one value into the text of a cell.
 *
 * @param {*} value - Value after the column's `format`
 * @param {string} delimiter - Column delimiter of the file
 * @returns {string} Cell as it is written in the file
 */
function toCell(value, delimiter) {
  if (value === null || value === undefined) {return '';}

  let text = String(value);
  if (delimiter === SEMICOLON && POINT_DECIMAL.test(text)) {
    text = text.replace('.', COMMA);
  }
  return escapeCSV(neutralizeFormula(text), delimiter);
}

/**
 * Build the text of a CSV file.
 *
 * @param {Array<Object>} data - Array of data objects to export
 * @param {Array<{key: string, label: string, format?: Function}>} columns - Column definitions
 * @param {{delimiter?: string, lang?: string}} [options] - `delimiter` forces `,` or `;`;
 *   otherwise it follows `lang` (the page language by default)
 * @returns {string} File content, starting with a byte order mark so Excel reads UTF-8
 */
export function buildCSV(data, columns, options = {}) {
  const delimiter = options.delimiter || csvDelimiterForLanguage(options.lang);

  const headerRow = columns.map((col) => toCell(col.label, delimiter)).join(delimiter);

  const rows = data.map((item) => columns.map((col) => {
    let value = item[col.key];

    if (col.format && typeof col.format === 'function') {
      value = col.format(value, item);
    }

    return toCell(value, delimiter);
  }).join(delimiter));

  return `${BYTE_ORDER_MARK}${[headerRow, ...rows].join(CSV_ROW_BREAK)}${CSV_ROW_BREAK}`;
}

/**
 * Make a file name every system accepts: no spaces, commas, accents or slashes.
 *
 * @param {string} filename - Desired name, with or without extension
 * @returns {string} Safe file name
 */
export function safeFilename(filename) {
  const base = String(filename || 'export')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'export';
}

/**
 * Export data to a CSV file and trigger download.
 *
 * @param {Array<Object>} data - Array of data objects to export
 * @param {Array<{key: string, label: string, format?: Function}>} columns - Column definitions
 * @param {string} filename - Desired filename (without extension)
 * @param {{delimiter?: string, lang?: string}} [options] - See `buildCSV`
 */
export function exportToCSV(data, columns, filename, options = {}) {
  if (!data || !data.length) {
    debugLog('ExportUtils: No data to export');
    return;
  }

  downloadBlob(buildCSV(data, columns, options), `${safeFilename(filename)}.csv`, 'text/csv;charset=utf-8;');
}

/**
 * Helper to create a blob and trigger browser download
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
