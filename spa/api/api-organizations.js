/**
 * The unit's branch and the addresses it answers at. Their writes need a
 * connection (CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES): they are never queued.
 *
 * @module spa/api/api-organizations
 */
import { API } from './api-core.js';
import { deleteCachedData } from '../indexedDB.js';
import { debugWarn } from '../utils/DebugUtils.js';

/**
 * Change the unit's branch; its vocabulary follows unless the unit wrote its own.
 *
 * @param {string} programSection - Branch key, e.g. `scouts`
 * @returns {Promise<Object>} `{ data: { program_section, unit_vocabulary } }`
 */
export async function updateUnitBranch(programSection) {
  const response = await API.patch('v1/organizations/settings/branch', { program_section: programSection });
  try {
    // The settings the app keeps under its own name, as the vocabulary save clears them.
    await deleteCachedData('org_settings');
  } catch (cacheError) {
    debugWarn('Failed to invalidate organization settings cache', cacheError);
  }
  return response;
}

/**
 * The addresses the unit answers at, the one emails use first.
 *
 * @returns {Promise<Object>} `{ data: Array<{id, domain, is_primary, is_wildcard}> }`
 */
export function getUnitDomains() {
  return API.getNoCache('v1/organizations/domains');
}

/**
 * Add an address under the platform's domain.
 *
 * @param {string} subdomain - Label before the platform's domain
 * @param {boolean} makePrimary - Whether emails should use it from now on
 * @returns {Promise<Object>} The address added
 */
export function addUnitDomain(subdomain, makePrimary) {
  return API.post('v1/organizations/domains', { subdomain, make_primary: makePrimary });
}

/**
 * Make an address the one emailed links are built from.
 *
 * @param {number} domainId - organization_domains.id
 * @returns {Promise<Object>} The address
 */
export function setPrimaryUnitDomain(domainId) {
  return API.put(`v1/organizations/domains/${encodeURIComponent(domainId)}/primary`, {});
}

/**
 * Stop answering at an address.
 *
 * @param {number} domainId - organization_domains.id
 * @returns {Promise<Object>} API response
 */
export function removeUnitDomain(domainId) {
  return API.delete(`v1/organizations/domains/${encodeURIComponent(domainId)}`);
}
