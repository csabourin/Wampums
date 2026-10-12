/**
 * API calls for the "Messages and news" screen: the history of sent messages
 * and the unit's news, each with its archive.
 *
 * Read without the offline cache: archiving moves an item between two lists,
 * and a cached list would still hold it where it was.
 *
 * @module spa/api/api-communication-history
 */

import { API } from './api-core.js';

/**
 * Sent messages with their delivery logs, newest first.
 *
 * @param {Object} [options]
 * @param {boolean} [options.archived=false] - List the archived ones instead
 * @returns {Promise<Object>} API response
 */
export function getAnnouncementHistory({ archived = false } = {}) {
  return API.getNoCache('v1/announcements', { archived });
}

/**
 * Archive a sent message out of the history, or restore it.
 *
 * @param {number} announcementId - Message id
 * @param {boolean} archived - True to archive, false to restore
 * @returns {Promise<Object>} API response
 */
export function setAnnouncementArchived(announcementId, archived) {
  return API.patch(`v1/announcements/${encodeURIComponent(announcementId)}/archive`, { archived });
}

/**
 * The unit's news, newest first.
 *
 * @param {Object} [options]
 * @param {boolean} [options.archived=false] - List the archived ones instead
 * @returns {Promise<Object>} API response
 */
export function getNewsHistory({ archived = false } = {}) {
  return API.getNoCache(archived ? 'v1/news/archived' : 'v1/news');
}

/**
 * Archive a news item, or restore it.
 *
 * @param {number} newsId - News id
 * @param {boolean} archived - True to archive, false to restore
 * @returns {Promise<Object>} API response
 */
export function setNewsArchived(newsId, archived) {
  return API.patch(`v1/news/${encodeURIComponent(newsId)}/archive`, { archived });
}
