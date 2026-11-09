/**
 * What the team sees of a permission slip's fingerprint, and the refusal a
 * parent meets when a slip's text changed while they were reading it
 * (#1410, services/permissionSlipFingerprint.js).
 */
import { translate } from '../app.js';
import { escapeHTML } from './SecurityUtils.js';

/** Key the server answers (409) when the text changed since it was shown. */
export const PERMISSION_SLIP_TEXT_CHANGED = 'permission_slip_text_changed';

/**
 * Whether an answer was refused because the slip's text changed since the
 * parent read it, who must read it again.
 *
 * @param {Error|Object} error - Error thrown by the API layer
 * @returns {boolean} True when the text changed
 */
export function isSlipTextChanged(error) {
  // The server's key, read directly: it decides what happens next, whatever
  // translations are loaded. api-core may prefix the message it rethrows.
  return [error?.message, error?.cause?.message, error?.data?.message]
    .map((message) => String(message ?? ''))
    .some((message) => message === PERMISSION_SLIP_TEXT_CHANGED
      || message.endsWith(`: ${PERMISSION_SLIP_TEXT_CHANGED}`));
}

/**
 * The label of an answered slip's fingerprint state.
 *
 * @param {string|null|undefined} status - `fingerprint_status` from the API
 * @returns {string} Translated label, or '' for a slip not yet answered
 */
export function fingerprintStatusLabel(status) {
  switch (status) {
    case 'verified':
      return translate('permission_slip_fingerprint_verified');
    case 'altered':
      return translate('permission_slip_fingerprint_altered');
    case 'not_verifiable':
      return translate('permission_slip_fingerprint_not_verifiable');
    default:
      return '';
  }
}

/** Icon beside each state; the text says the state, the icon only repeats it. */
const FINGERPRINT_ICONS = Object.freeze({
  verified: 'fa-shield-halved',
  altered: 'fa-triangle-exclamation',
  not_verifiable: 'fa-circle-question',
});

/**
 * Markup stating whether an answered slip's text is proven by its
 * fingerprint. An answer from before fingerprints is never shown as verified.
 *
 * @param {Object} slip - Slip from the API, with `fingerprint_status`
 * @returns {string} HTML, or '' for a slip not yet answered
 */
export function renderFingerprintStatus(slip) {
  const status = slip?.fingerprint_status;
  const label = fingerprintStatusLabel(status);
  if (!label) {
    return '';
  }
  return `<span class="permission-slip-fingerprint permission-slip-fingerprint--${escapeHTML(status)}">`
    + `<i class="fa-solid ${FINGERPRINT_ICONS[status]}" aria-hidden="true"></i> ${escapeHTML(label)}</span>`;
}
