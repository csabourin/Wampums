'use strict';

/**
 * Placeholders for one row of a multi-row INSERT … VALUES.
 * Row 0 of a 4-column insert is `$1, $2, $3, $4`; row 1 is `$5, $6, $7, $8`.
 * @param {number} rowIndex - Zero-based index of the row
 * @param {number} columns - Parameters each row takes
 * @param {number} [offset=0] - Parameters placed before the first row
 * @returns {string} Comma-separated placeholders for that row
 */
function rowPlaceholders(rowIndex, columns, offset = 0) {
  const first = offset + (rowIndex * columns) + 1;
  return Array.from({ length: columns }, (_, column) => `$${first + column}`).join(', ');
}

module.exports = { rowPlaceholders };
