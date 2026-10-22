const { SISC_IMPORT_LIMITS: LIMITS } = require('../config/constants');

const BAD_REQUEST = 400;
const PAYLOAD_TOO_LARGE = 413;
const MIN_CSV_ROWS = 2;

/** A rejected CSV, safe to report through the standard API error response. */
class SiscCsvError extends Error {
  constructor(message, status = BAD_REQUEST) {
    super(message);
    this.status = status;
  }
}

/**
 * Parse a bounded semicolon-delimited line, retaining quoted separators.
 * @param {string} line - A line from the validated CSV string
 * @returns {string[]} Trimmed fields
 */
function parseLine(line) {
  if (line.length > LIMITS.MAX_LINE_LENGTH) {
    throw new SiscCsvError('CSV line is too long', PAYLOAD_TOO_LARGE);
  }
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ';' && !inQuotes) {
      fields.push(current.trim());
      current = '';
      if (fields.length >= LIMITS.MAX_COLUMNS) {
        throw new SiscCsvError('CSV has too many columns', PAYLOAD_TOO_LARGE);
      }
    } else {
      current += char;
      if (current.length > LIMITS.MAX_FIELD_LENGTH) {
        throw new SiscCsvError('CSV field is too long', PAYLOAD_TOO_LARGE);
      }
    }
  }
  if (inQuotes) {
    throw new SiscCsvError('CSV has an unterminated quoted field');
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Validate the entire import before a connection or transaction is opened.
 * The byte cap bounds splitting and parsing; row caps also bound database work.
 * @param {*} csvContent - Untrusted request value
 * @returns {string[][]} Header followed by one or more data rows
 * @throws {SiscCsvError} For malformed or oversized CSV content
 */
function parseSiscCsv(csvContent) {
  if (typeof csvContent !== 'string') {
    throw new SiscCsvError('CSV content must be a non-empty string');
  }
  if (Buffer.byteLength(csvContent, 'utf8') > LIMITS.MAX_BYTES) {
    throw new SiscCsvError('CSV content is too large', PAYLOAD_TOO_LARGE);
  }
  const rows = [];
  for (const line of csvContent.split('\n')) {
    if (!line.trim()) {continue;}
    if (rows.length >= LIMITS.MAX_DATA_ROWS + 1) {
      throw new SiscCsvError('CSV has too many data rows', PAYLOAD_TOO_LARGE);
    }
    rows.push(parseLine(line));
  }
  if (rows.length < MIN_CSV_ROWS) {
    throw new SiscCsvError('CSV must have header and at least one data row');
  }
  return rows;
}

module.exports = { parseSiscCsv, SiscCsvError };
