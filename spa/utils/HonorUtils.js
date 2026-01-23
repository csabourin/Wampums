/**
 * HonorUtils.js
 *
 * Shared helpers for formatting honors consistently across the SPA.
 */

/**
 * Build a display string for a youth honor, including optional reason text.
 * Accepts raw honor objects or preformatted strings.
 * @param {string|object} honor - Honor string or honor record.
 * @returns {string} Display-ready honor text.
 */
export function formatHonorText(honor) {
        if (!honor) return '';
        if (typeof honor === 'string') return honor;

        const nameParts = [honor.first_name, honor.last_name].filter(Boolean);
        const name = nameParts.join(' ').trim() || honor.participant_name || '';
        const reason = typeof honor.reason === 'string' ? honor.reason.trim() : '';
        if (!name && !reason) return '';
        return `${name}${reason ? ` — ${reason}` : ''}`.trim();
}
