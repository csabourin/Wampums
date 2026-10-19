/**
 * Make another of the person's units the active one.
 *
 * The server takes the unit from the session's token and ignores any other it
 * is sent, so choosing a unit means getting a token for it: until then, every
 * request still reads and changes the previous unit. Once the token is held,
 * the stored roles and permissions, and the unit id and settings screens read
 * from the app, all follow it.
 *
 * @module modules/session/UnitSwitch
 */

import { switchOrganization } from '../../api/api-endpoints.js';
import { setStorageMultiple } from '../../utils/StorageUtils.js';
import { decodeJWT } from '../../jwt-helper.js';
import { refreshAccess } from './AccessRefresh.js';

/**
 * Switch the session to `unitId`. Nothing is changed when the switch fails.
 *
 * @param {Object} app - The application object
 * @param {number|string} unitId - A unit the person belongs to
 * @returns {Promise<void>}
 * @throws {Error} When the server refuses the switch or sends no token
 */
export async function switchActiveUnit(app, unitId) {
  const response = await switchOrganization(unitId);
  const token = response?.data?.token || response?.token;
  if (!token) {
    throw new Error('Missing switch result');
  }
  const claims = decodeJWT(token);
  setStorageMultiple({
    jwtToken: token,
    currentOrganizationId: unitId,
    organizationId: unitId,
    userPermissions: claims.permissions,
    userRoles: claims.roleNames,
    userRoleIds: claims.roleIds,
  });
  app.userPermissions = claims.permissions;
  app.userRoles = claims.roleNames;
  await refreshAccess(app);
  // Later screens read the unit's id and settings from the app.
  await app.useOrganization(unitId);
}
