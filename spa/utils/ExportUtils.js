/**
 * ExportUtils.js
 * Utilities for exporting data to various formats (CSV, etc.)
 */

import { debugLog } from "./DebugUtils.js";

/**
 * Export data to a CSV file and trigger download.
 *
 * @param {Array<Object>} data - Array of data objects to export
 * @param {Array<{key: string, label: string, format?: Function}>} columns - Column definitions
 * @param {string} filename - Desired filename (without extension)
 */
export function exportToCSV(data, columns, filename) {
    if (!data || !data.length) {
        debugLog('ExportUtils: No data to export');
        return;
    }

    // 1. Create Header Row
    const headerRow = columns.map(col => escapeCSV(col.label)).join(',');

    // 2. Create Data Rows
    const rows = data.map(item => {
        return columns.map(col => {
            let value = item[col.key];

            // Apply custom formatting if provided
            if (col.format && typeof col.format === 'function') {
                value = col.format(value, item);
            }

            // Handle null/undefined
            if (value === null || value === undefined) {
                value = '';
            }

            return escapeCSV(String(value));
        }).join(',');
    });

    // 3. Combine with BOM for Excel UTF-8 support
    const csvContent = '\uFEFF' + [headerRow, ...rows].join('\n');

    // 4. Trigger Download
    downloadBlob(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');
}

/**
 * Helper to escape CSV values (wrap in quotes if needed, escape existing quotes)
 * @param {string} str
 * @returns {string}
 */
function escapeCSV(str) {
    if (str === null || str === undefined) return '';
    const stringValue = String(str);

    // Check if value contains special chars
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        // Escape double quotes by doubling them
        return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
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
