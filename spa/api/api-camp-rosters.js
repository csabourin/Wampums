/**
 * Camp lists (#1319): a planned camp's youth and team. Reads are always
 * fresh; naming the team needs a connection and is never queued
 * (CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES).
 *
 * @module spa/api/api-camp-rosters
 */
import { API } from './api-core.js';

/**
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} { camp, scout_year, consent, youth, team, volunteers, gaps }
 */
export function getCampRoster(meetingId) {
  return API.getNoCache(`v1/camp-rosters/${encodeURIComponent(meetingId)}`);
}

/**
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} The unit's members a team may be chosen from
 */
export function getCampTeamCandidates(meetingId) {
  return API.getNoCache(`v1/camp-rosters/${encodeURIComponent(meetingId)}/team-candidates`);
}

/**
 * @param {number} meetingId - The planned camp
 * @param {string} userId - UUID of the member
 * @param {{team_role: string, date_of_birth?: string|null}} body
 * @returns {Promise<Object>} { team }
 */
export function saveCampTeamMember(meetingId, userId, body) {
  return API.put(`v1/camp-rosters/${encodeURIComponent(meetingId)}/team/${encodeURIComponent(userId)}`, body);
}

/**
 * @param {number} meetingId - The planned camp
 * @param {string} userId - UUID of the member
 * @returns {Promise<Object>} { team }
 */
export function removeCampTeamMember(meetingId, userId) {
  return API.delete(`v1/camp-rosters/${encodeURIComponent(meetingId)}/team/${encodeURIComponent(userId)}`);
}
