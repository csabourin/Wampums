/**
 * A family answering its own child's permission slip from inside the app.
 *
 * An emailed link carries a token of its own (only its digest is stored, so the
 * app cannot rebuild one): from the dashboard, the signing page reads and
 * answers the slip by id, as the signed-in parent.
 *
 * @module spa/api/api-permission-slips
 */
import { API } from './api-core.js';

/** The page path that opens a child's slip for its signed-in family. */
export const OWN_SLIP_PREFIX = 'slip-';

/**
 * The signing page's path for one of the family's own slips.
 * @param {number|string} slipId - Slip
 * @returns {string} Path segment after /permission-slip/
 */
export function ownSlipRef(slipId) {
  return `${OWN_SLIP_PREFIX}${Number(slipId)}`;
}

/**
 * The slip id a signing page path names, when it names one by id.
 * @param {string} ref - Path segment after /permission-slip/
 * @returns {number|null} Slip id, or null for an emailed token
 */
export function slipIdFromRef(ref) {
  const match = new RegExp(`^${OWN_SLIP_PREFIX}(\\d+)$`).exec(String(ref ?? ''));
  return match ? Number(match[1]) : null;
}

/**
 * Read one of the family's own slips, fresh: its text may have changed.
 * @param {number} slipId - Slip
 * @returns {Promise<Object>} `{ success, data }`
 */
export function getOwnPermissionSlip(slipId) {
  return API.getNoCache(`v1/resources/permission-slips/${slipId}/view`);
}
