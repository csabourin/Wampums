/**
 * Youth records of the current unit.
 *
 * @module api/api-participants
 */

import { API } from './api-core.js';

/**
 * Set the name a youth goes by in the unit; an empty value clears it.
 *
 * @param {number} participantId - Participant id
 * @param {string} nickname - Nickname, or '' for none
 * @returns {Promise<Object>} API response
 */
export function updateParticipantNickname(participantId, nickname) {
  return API.patch(`v1/participants/${encodeURIComponent(participantId)}/nickname`, { nickname });
}
