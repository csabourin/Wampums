/**
 * API calls for the signed-in person's calendar subscription link.
 *
 * Read without the offline cache: the link may have been made or turned off
 * from another device. Making one requires a connection (CONFIG.
 * ONLINE_REQUIRED_MUTATION_RESOURCES): the link is shown only in the answer.
 *
 * @module spa/api/api-calendar-feed
 */

import { API } from './api-core.js';

/**
 * Whether the person has an active link, since when, and when a calendar app
 * last fetched it. The link itself is not kept and so not returned.
 *
 * @returns {Promise<Object>} API response: `{ active, created_at, last_used_at }`
 */
export function getCalendarFeedStatus() {
  return API.getNoCache('v1/calendar-feed');
}

/**
 * Make a new link, turning off the previous one.
 *
 * @returns {Promise<Object>} API response: `{ url, webcal_url, created_at }`
 */
export function createCalendarFeed() {
  return API.post('v1/calendar-feed');
}

/**
 * Turn the link off.
 *
 * @returns {Promise<Object>} API response: `{ revoked }`
 */
export function revokeCalendarFeed() {
  return API.delete('v1/calendar-feed');
}
