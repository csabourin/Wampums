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
  if (!honor) {return '';}
  if (typeof honor === 'string') {return honor;}

  const nameParts = [honor.first_name, honor.last_name].filter(Boolean);
  const name = nameParts.join(' ').trim() || honor.participant_name || '';
  const reason = typeof honor.reason === 'string' ? honor.reason.trim() : '';
  if (!name && !reason) {return '';}
  return `${name}${reason ? ` — ${reason}` : ''}`.trim();
}

const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

/**
 * The previous meeting's honour, as the meeting-plan assistant expects it.
 * Reads a row of the honours history (`first_name`, `last_name`, `reason`,
 * `date`); without a reason, the honour is named by the unit's own term.
 *
 * @param {Object|null} honor - Honours-history row
 * @param {string} [honorTerm] - The unit's word for the honour (e.g. "Loup d'honneur")
 * @returns {{name: string, honor: string, date: string}|null} Null when nobody is named
 */
export function honorForMeetingPlan(honor, honorTerm = '') {
  const name = [honor?.first_name, honor?.last_name].filter(Boolean).join(' ').trim();
  if (!name) {
    return null;
  }
  const reason = typeof honor.reason === 'string' ? honor.reason.trim() : '';
  return {
    name,
    honor: reason || honorTerm || '',
    date: typeof honor.date === 'string' ? honor.date.slice(0, ISO_DATE_LENGTH) : '',
  };
}
