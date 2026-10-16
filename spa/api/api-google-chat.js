/**
 * Google Chat: the unit's service account, its spaces, and a test message.
 *
 * @module spa/api/api-google-chat
 */
import { API } from './api-core.js';

/** @returns {Promise<Object>} Whether Google Chat is set up, and as whom */
export function getGoogleChatConfig() {
  return API.getNoCache('v1/google-chat/config');
}

/** @returns {Promise<Object>} The spaces the unit has registered */
export function getGoogleChatSpaces() {
  return API.getNoCache('v1/google-chat/spaces');
}

/**
 * @param {Object} credentials - The service account's JSON key, parsed
 * @returns {Promise<Object>} API response
 */
export function saveGoogleChatCredentials(credentials) {
  return API.post('v1/google-chat/config', { credentials });
}

/**
 * @param {{spaceId: string, spaceName: ?string, description: ?string, isBroadcastSpace: boolean}} space
 * @returns {Promise<Object>} API response
 */
export function saveGoogleChatSpace(space) {
  return API.post('v1/google-chat/spaces', space);
}

/**
 * @param {{spaceId: string, message: string, subject: string}} payload
 * @returns {Promise<Object>} API response
 */
export function sendGoogleChatTestMessage(payload) {
  return API.post('v1/google-chat/send-message', payload);
}
