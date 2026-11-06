/**
 * Camp review (#1257): a camp's notes and the "+1" given to each.
 *
 * Every write names the id the device chose for the note or the vote, so it
 * is idempotent and the offline outbox may replay it (SAFE_OFFLINE_MUTATIONS,
 * kind `camp_review`). Reads are always fresh; the copy kept on this device
 * lives in `CampReviewOffline.js`.
 *
 * @module spa/api/api-camp-reviews
 */
import { API } from './api-core.js';

const notePath = (meetingId, noteId) => `v1/camp-reviews/camps/${encodeURIComponent(meetingId)}/notes/${encodeURIComponent(noteId)}`;

/**
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} { camp, notes }
 */
export function getCampReview(meetingId) {
  return API.getNoCache(`v1/camp-reviews/camps/${encodeURIComponent(meetingId)}`);
}

/**
 * Create a note with the id this device chose, or edit it (with `expected_version`).
 *
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID chosen by this device
 * @param {{category: string, moment: string, day?: ?string, theme?: ?string, text: string, expected_version?: number}} body
 * @returns {Promise<Object>} { note }, or { queued: true }
 */
export function saveCampReviewNote(meetingId, noteId, body) {
  return API.put(`v1/camp-reviews/camps/${encodeURIComponent(meetingId)}/notes/${encodeURIComponent(noteId)}`, body);
}

/**
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID of the note
 * @returns {Promise<Object>} { deleted }, or { queued: true }
 */
export function deleteCampReviewNote(meetingId, noteId) {
  return API.delete(`v1/camp-reviews/camps/${encodeURIComponent(meetingId)}/notes/${encodeURIComponent(noteId)}`);
}

/**
 * Add a "+1", with the id this device chose.
 *
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID of the note
 * @param {string} voteId - UUID chosen by this device
 * @returns {Promise<Object>} { note }, or { queued: true }
 */
export function addCampReviewVote(meetingId, noteId, voteId) {
  return API.put(`${notePath(meetingId, noteId)}/votes/${encodeURIComponent(voteId)}`, {});
}

/**
 * Undo a "+1".
 *
 * @param {number} meetingId - The planned camp
 * @param {string} noteId - UUID of the note
 * @param {string} voteId - UUID of the vote
 * @returns {Promise<Object>} { note }, or { queued: true }
 */
export function removeCampReviewVote(meetingId, noteId, voteId) {
  return API.delete(`${notePath(meetingId, noteId)}/votes/${encodeURIComponent(voteId)}`);
}
