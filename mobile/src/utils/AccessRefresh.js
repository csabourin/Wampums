/**
 * Keep the stored roles and permissions in step with the database.
 *
 * Mirrors spa/modules/session/AccessRefresh.js. Sign-in stores the roles and
 * permissions of that moment, and every screen reads that copy. A permission
 * given to or taken from a role afterwards (parents receiving carpools.view,
 * say) left screens showing the old access until the next sign-in, while the
 * API already answered by the new rules. On start, the app asks the server for
 * the current list and stores it when it differs.
 *
 * The storage and API calls are passed in, so this module has no
 * dependencies and can be tested on its own.
 *
 * @module utils/AccessRefresh
 */

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
 *
 * Failure (offline, server error, unexpected answer) keeps the stored copy:
 * the API still decides every request, so a stale copy only affects what is
 * shown.
 *
 * @param {Object} deps - Injected calls
 * @param {Function} deps.fetchAccess - Resolves to GET /api/v1/users/me/access's body
 * @param {string[]} deps.storedRoles - Roles stored at sign-in
 * @param {string[]} deps.storedPermissions - Permissions stored at sign-in
 * @param {Function} deps.store - Persists ({ roles, permissions })
 * @param {Function} [deps.onError] - Receives a fetch error
 * @returns {Promise<{changed: boolean, roles: string[], permissions: string[]}>} Access to use now
 */
export async function refreshStoredAccess({ fetchAccess, storedRoles, storedPermissions, store, onError }) {
  const unchanged = { changed: false, roles: storedRoles || [], permissions: storedPermissions || [] };

  let access;
  try {
    const response = await fetchAccess();
    access = response?.data;
  } catch (error) {
    if (onError) {
      onError(error);
    }
    return unchanged;
  }

  if (!access || !Array.isArray(access.roles) || !Array.isArray(access.permissions)) {
    return unchanged;
  }

  if (sameKeys(access.roles, storedRoles) && sameKeys(access.permissions, storedPermissions)) {
    return unchanged;
  }

  await store({ roles: access.roles, permissions: access.permissions });
  return { changed: true, roles: access.roles, permissions: access.permissions };
}
