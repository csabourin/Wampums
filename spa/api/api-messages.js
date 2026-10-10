/**
 * API calls for the member's own pushed messages.
 *
 * Read without the offline cache: a message opened from a notification has
 * just been sent, and a cached list would not hold it yet.
 *
 * @module spa/api/api-messages
 */

import { API } from './api-core.js';

/**
 * The member's most recent messages in this unit, newest first.
 *
 * @returns {Promise<Object>} API response
 */
export function getMessages() {
  return API.getNoCache('v1/messages');
}

/**
 * One of the member's messages.
 *
 * @param {number} messageId - Message id
 * @returns {Promise<Object>} API response
 */
export function getMessage(messageId) {
  return API.getNoCache(`v1/messages/${encodeURIComponent(messageId)}`);
}
