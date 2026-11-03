/**
 * Camp sites (#1317): the places the unit camps at, and where each camp is
 * held. Changes need a connection and are never queued
 * (CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES): a site named offline could
 * collide with one named elsewhere, and an emergency number must be current.
 *
 * @module spa/api/api-camp-sites
 */
import { API } from './api-core.js';

/**
 * @param {{includeArchived?: boolean}} [options]
 * @returns {Promise<Object>} The unit's sites, active first
 */
export function getCampSites({ includeArchived = false } = {}) {
  return API.getNoCache('v1/camp-sites', includeArchived ? { include_archived: 'true' } : {});
}

/**
 * @param {Object} site - The site's information
 * @returns {Promise<Object>} The new site
 */
export function createCampSite(site) {
  return API.post('v1/camp-sites', site);
}

/**
 * @param {number} siteId
 * @param {Object} site - The whole site, with the `expected_version` the editor loaded
 * @returns {Promise<Object>} The site as it now is
 */
export function updateCampSite(siteId, site) {
  return API.put(`v1/camp-sites/${encodeURIComponent(siteId)}`, site);
}

/**
 * @param {number} siteId
 * @param {boolean} archived - Archive, or restore
 * @returns {Promise<Object>} The site as it now is
 */
export function setCampSiteArchived(siteId, archived) {
  return API.patch(`v1/camp-sites/${encodeURIComponent(siteId)}/archive`, { archived });
}

/**
 * Where a camp is held and how to reach help from there. Always fresh.
 *
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} { camp, details, site, gaps, members? }
 */
export function getCampSite(meetingId) {
  return API.getNoCache(`v1/camp-sites/camps/${encodeURIComponent(meetingId)}`);
}

/**
 * @param {number} meetingId - The planned camp
 * @param {Object} details - camp_site_id, season, accommodation, on_site_lead_id, contact_phone, expected_version
 * @returns {Promise<Object>} The camp's site as it now is
 */
export function saveCampSite(meetingId, details) {
  return API.put(`v1/camp-sites/camps/${encodeURIComponent(meetingId)}`, details);
}
