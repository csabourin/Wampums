/**
 * Keep the stored roles and permissions in step with the database.
 *
 * Sign-in stores the roles and permissions of that moment, and screens and
 * route guards read that copy. A permission taken away from a role afterwards
 * (a parent losing the unit's finances, say) left the tile and the screen in
 * place until the next sign-in; the API refused the data, so people met
 * errors instead. On start, the app asks the server for the current list and,
 * when it differs, stores it and shows the current screen again under the
 * new rules.
 *
 * @module modules/session/AccessRefresh
 */

import { getCurrentAccess } from '../../api/api-endpoints.js';
import { setStorageMultiple } from '../../utils/StorageUtils.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';
import { isParent } from '../../utils/PermissionUtils.js';

const PARENT_HOME = '/parent-dashboard';
const UNIT_HOME = '/dashboard';
const HOME_PATHS = new Set(['/', UNIT_HOME, PARENT_HOME]);

/**
 * Whether two lists hold the same keys, in any order.
 *
 * @param {string[]} first - A list of keys
 * @param {string[]} second - Another list of keys
 * @returns {boolean} True when both hold exactly the same keys
 */
function sameKeys(first, second) {
  const a = new Set(first || []);
  const b = new Set(second || []);
  if (a.size !== b.size) {
    return false;
  }
  return [...a].every((key) => b.has(key));
}

/**
 * Replace the stored roles and permissions with the server's when they differ.
 * On a home page, the address becomes the home the new access calls for
 * (see pathAfterAccessChange), so showing it again lands on the right one.
 *
 * Failure (offline, server error) leaves the stored copy as it is: the API
 * still decides every request, so a stale copy only affects what is shown.
 *
 * @param {Object} app - The application object (userRoles, userPermissions, userDataScope)
 * @returns {Promise<boolean>} True when the stored access changed
 */
export async function refreshAccess(app) {
  let access;
  try {
    const response = await getCurrentAccess();
    access = response?.data;
  } catch (error) {
    debugError('Could not refresh access; keeping the stored copy:', error);
    return false;
  }

  if (!access || !Array.isArray(access.roles) || !Array.isArray(access.permissions)) {
    return false;
  }

  const dataScope = access.data_scope || null;
  if (sameKeys(access.roles, app.userRoles)
    && sameKeys(access.permissions, app.userPermissions)
    && dataScope === (app.userDataScope || null)) {
    return false;
  }

  debugLog('Access changed since sign-in; updating the stored copy');
  app.userRoles = access.roles;
  app.userPermissions = access.permissions;
  app.userDataScope = dataScope;
  setStorageMultiple({
    userRoles: JSON.stringify(access.roles),
    userPermissions: JSON.stringify(access.permissions),
    userDataScope: dataScope || '',
  });

  // The caller shows the current address again; make it the right home.
  const current = window.location.pathname + window.location.search;
  const target = pathAfterAccessChange(window.location.pathname, window.location.search);
  if (target !== current) {
    window.history.replaceState(null, '', target);
  }
  return true;
}

/**
 * Where to show the person after their access changed.
 *
 * A parent given the leader role while signed in sat on the parent
 * dashboard, where sign-in had sent them, and showing that screen again kept
 * them there. On a home page they go to the home their roles now call for;
 * any other screen is shown again under the new rules.
 *
 * @param {string} pathname - Current path
 * @param {string} [search=''] - Current query string
 * @returns {string} Path to route to
 */
export function pathAfterAccessChange(pathname, search = '') {
  if (HOME_PATHS.has(pathname)) {
    return isParent() ? PARENT_HOME : UNIT_HOME;
  }
  return pathname + search;
}
