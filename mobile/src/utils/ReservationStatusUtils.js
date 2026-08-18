/**
 * Reservation status labels.
 *
 * The status arrives from the API as a bare English keyword — `reserved`,
 * `confirmed`, `returned`, `cancelled`, `expired`. Rendering it straight put an
 * English word in the middle of a French screen, which the project's first rule
 * forbids.
 *
 * Shared between the screens that show reservations so the two cannot drift
 * apart, and so a status added later is translated everywhere at once.
 */

import { translate } from '../i18n';

/**
 * Label a reservation status in the reader's language.
 *
 * An unrecognised value falls back to itself rather than to an empty string: a
 * row with an odd label is still readable, a row with a blank status is not.
 *
 * @param {string} status - Stored status keyword
 * @returns {string} Translated label
 */
export function reservationStatusLabel(status) {
  if (!status) {
    return '';
  }
  const key = `reservation_status_${status}`;
  const label = translate(key);
  return label && label !== key ? label : status;
}

export default { reservationStatusLabel };
