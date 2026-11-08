/**
 * Written sections of the camp plan (#1318): a camp's own sections, its
 * bad-weather games, and the unit's templates for the stable sections.
 * Reads are always fresh; changes need a connection and are never queued
 * (CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES): each names the version it
 * replaces, and a replayed edit could silently undo a colleague's.
 *
 * @module spa/api/api-camp-plans
 */
import { API } from './api-core.js';

/** @returns {Promise<Object>} The unit's templates for the stable sections */
export function getCampPlanTemplates() {
  return API.getNoCache('v1/camp-plans/templates');
}

/**
 * @param {string} sectionKey - A stable section
 * @param {{body_html: string, expected_version: number}} body - Empty text removes the template
 * @returns {Promise<Object>} The template as it now is
 */
export function saveCampPlanTemplate(sectionKey, body) {
  return API.put(`v1/camp-plans/templates/${encodeURIComponent(sectionKey)}`, body);
}

/** @returns {Promise<Object>} The unit's camps, coming then past, with what each plan lacks */
export function getCampPlans() {
  return API.getNoCache('v1/camp-plans/camps');
}

/**
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} { camp, sections, rain_games, motivation, gaps }
 */
export function getCampPlan(meetingId) {
  return API.getNoCache(`v1/camp-plans/camps/${encodeURIComponent(meetingId)}`);
}

/**
 * The camp permit's checklist (#1416): each line's state, read fresh from where it lives.
 *
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} { camp, header, groups, lines }
 */
export function getCampPermit(meetingId) {
  return API.getNoCache(`v1/camp-plans/camps/${encodeURIComponent(meetingId)}/permit`);
}

/**
 * @param {number} meetingId - The planned camp
 * @param {string} sectionKey - The section
 * @param {{body_html: string, expected_version: number}} body - Empty text removes the camp's own text
 * @returns {Promise<Object>} { section, gaps }
 */
export function saveCampPlanSection(meetingId, sectionKey, body) {
  return API.put(`v1/camp-plans/camps/${encodeURIComponent(meetingId)}/sections/${encodeURIComponent(sectionKey)}`, body);
}

/**
 * @param {number} meetingId - The planned camp
 * @param {number[]} activityLibraryIds - The games, in order
 * @returns {Promise<Object>} { rain_games, gaps }
 */
export function saveCampPlanRainGames(meetingId, activityLibraryIds) {
  return API.put(`v1/camp-plans/camps/${encodeURIComponent(meetingId)}/rain-games`, { activity_library_ids: activityLibraryIds });
}

/**
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} { versions, changed_since_latest }
 */
export function getCampPlanVersions(meetingId) {
  return API.getNoCache(`v1/camp-plans/camps/${encodeURIComponent(meetingId)}/versions`);
}

/**
 * Submit the plan: freeze its content and generate its document.
 *
 * @param {number} meetingId - The planned camp
 * @returns {Promise<Object>} The new version
 */
export function submitCampPlanVersion(meetingId) {
  return API.post(`v1/camp-plans/camps/${encodeURIComponent(meetingId)}/versions`, {});
}

/**
 * @param {number} meetingId - The planned camp
 * @param {number} versionNumber - The version
 * @param {{signal?: AbortSignal}} [options] - Abort when the screen is left
 * @returns {Promise<{blob: Blob, filename: string|null, sha256: string|null}>} Its PDF
 */
export function getCampPlanVersionPdf(meetingId, versionNumber, options = {}) {
  return API.getFile(`v1/camp-plans/camps/${encodeURIComponent(meetingId)}/versions/${encodeURIComponent(versionNumber)}/pdf`, options);
}
