// api-yearly-planner.js
// API endpoint functions for the Yearly Meeting Planner module
import { API } from './api-core.js';
import { CONFIG } from '../config.js';
import { clearYearlyPlannerCaches } from '../indexedDB.js';
import { debugWarn } from '../utils/DebugUtils.js';

/**
 * Drop the cached planner reads after a mutation.
 *
 * Every read here goes through the IndexedDB API cache, so without this the SPA
 * keeps rendering the state it captured before the write and the mutation looks
 * like a no-op.
 *
 * @param {Object} [options] - Passed through to clearYearlyPlannerCaches
 * @returns {Promise<void>}
 */
async function invalidatePlanner(options = {}) {
  try {
    await clearYearlyPlannerCaches(options);
  } catch (error) {
    // Cache invalidation is best-effort: the write already succeeded.
    debugWarn('Failed to invalidate yearly planner caches', error);
  }
}

/**
 * Read options shared by every planner GET.
 * @param {Object} options - { forceRefresh }
 * @returns {Object} cacheOptions for API.get
 */
function readCacheOptions(options = {}) {
  return {
    forceRefresh: options.forceRefresh === true,
    cacheDuration: CONFIG.CACHE_DURATION.SHORT
  };
}

// ============================================================================
// YEAR PLANS
// ============================================================================

export async function getYearPlans(options = {}) {
  return API.get('v1/yearly-planner/plans', {}, readCacheOptions(options));
}

export async function getYearPlan(planId, options = {}) {
  return API.get(`v1/yearly-planner/plans/${planId}`, {}, readCacheOptions(options));
}

export async function createYearPlan(data) {
  const response = await API.post('v1/yearly-planner/plans', data);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

export async function updateYearPlan(planId, data) {
  const response = await API.patch(`v1/yearly-planner/plans/${planId}`, data);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

export async function deleteYearPlan(planId) {
  const response = await API.delete(`v1/yearly-planner/plans/${planId}`);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

// ============================================================================
// PERIODS
// ============================================================================

export async function getPeriods(planId, options = {}) {
  return API.get(`v1/yearly-planner/plans/${planId}/periods`, {}, readCacheOptions(options));
}

export async function createPeriod(planId, data) {
  const response = await API.post(`v1/yearly-planner/plans/${planId}/periods`, data);
  await invalidatePlanner();
  return response;
}

export async function updatePeriod(periodId, data) {
  const response = await API.patch(`v1/yearly-planner/periods/${periodId}`, data);
  await invalidatePlanner();
  return response;
}

export async function deletePeriod(periodId) {
  const response = await API.delete(`v1/yearly-planner/periods/${periodId}`);
  await invalidatePlanner();
  return response;
}

// ============================================================================
// OBJECTIVES
// ============================================================================

export async function getObjectives(planId, options = {}) {
  return API.get(`v1/yearly-planner/plans/${planId}/objectives`, {}, readCacheOptions(options));
}

export async function createObjective(planId, data) {
  const response = await API.post(`v1/yearly-planner/plans/${planId}/objectives`, data);
  await invalidatePlanner();
  return response;
}

export async function updateObjective(objectiveId, data) {
  const response = await API.patch(`v1/yearly-planner/objectives/${objectiveId}`, data);
  await invalidatePlanner();
  return response;
}

export async function deleteObjective(objectiveId) {
  const response = await API.delete(`v1/yearly-planner/objectives/${objectiveId}`);
  await invalidatePlanner();
  return response;
}

// ============================================================================
// MEETINGS
// ============================================================================

export async function getYearPlanMeeting(meetingId, options = {}) {
  return API.get(`v1/yearly-planner/meetings/${meetingId}`, {}, readCacheOptions(options));
}

export async function updateYearPlanMeeting(meetingId, data) {
  const response = await API.patch(`v1/yearly-planner/meetings/${meetingId}`, data);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

/**
 * Add a single date to a plan: a one-off meeting, a weekend outing, or a
 * multi-day camp. Weekend and camp kinds also create the linked activity that
 * unlocks consent forms and carpooling.
 *
 * @param {number} planId - Year plan ID
 * @param {Object} data - { meeting_date, end_date?, kind?, theme?, location?, period_id? }
 * @returns {Promise<Object>} API response
 */
export async function createPlanMeeting(planId, data) {
  const response = await API.post(`v1/yearly-planner/plans/${planId}/meetings`, data);
  await invalidatePlanner({ includeMeetingPrep: true, includeActivities: true });
  return response;
}

/**
 * Remove a date from the calendar. The linked outing, if any, is unlinked but
 * never deleted.
 * @param {number} meetingId - Year plan meeting ID
 * @returns {Promise<Object>} API response
 */
export async function deletePlanMeeting(meetingId) {
  const response = await API.delete(`v1/yearly-planner/meetings/${meetingId}`);
  await invalidatePlanner({ includeMeetingPrep: true, includeActivities: true });
  return response;
}

/**
 * Detach a meeting from its outing without deleting the outing.
 * @param {number} meetingId - Year plan meeting ID
 * @returns {Promise<Object>} API response
 */
export async function unlinkActivityEvent(meetingId) {
  const response = await API.delete(`v1/yearly-planner/meetings/${meetingId}/activity-event`);
  await invalidatePlanner({ includeMeetingPrep: true, includeActivities: true });
  return response;
}

/**
 * Create an outing/event in the activities calendar from a planned meeting
 * (enables carpools, permission slips and the iCal feed) and link it back.
 * @param {number} meetingId - Year plan meeting ID
 * @param {Object} data - Optional overrides { name, description, location, meeting_time, departure_time, end_date, end_time }
 */
export async function createActivityEventFromMeeting(meetingId, data = {}) {
  const response = await API.post(`v1/yearly-planner/meetings/${meetingId}/activity-event`, data);
  await invalidatePlanner({ includeMeetingPrep: true, includeActivities: true });
  return response;
}

// ============================================================================
// MEETING ACTIVITIES
// ============================================================================

export async function addMeetingActivity(meetingId, data) {
  const response = await API.post(`v1/yearly-planner/meetings/${meetingId}/activities`, data);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

export async function updateMeetingActivity(activityId, data) {
  const response = await API.patch(`v1/yearly-planner/meeting-activities/${activityId}`, data);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

export async function deleteMeetingActivity(activityId) {
  const response = await API.delete(`v1/yearly-planner/meeting-activities/${activityId}`);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

/** Get a meeting's complete multi-day schedule. */
export async function getMeetingSchedule(meetingId, options = {}) {
  return API.get(`v1/yearly-planner/meetings/${meetingId}/schedule`, {}, readCacheOptions(options));
}

/** Upsert one day's heading and notes. */
export async function updateMeetingDay(meetingId, dayOffset, data) {
  const response = await API.put(`v1/yearly-planner/meetings/${meetingId}/days/${dayOffset}`, data);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

/** Copy a prior camp's later-day schedule into an empty target camp. */
export async function copyMeetingSchedule(meetingId, sourceMeetingId) {
  const response = await API.post(
    `v1/yearly-planner/meetings/${meetingId}/schedule/copy-from/${sourceMeetingId}`,
    {}
  );
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

// ============================================================================
// SERIES
// ============================================================================

/**
 * Place one activity onto several dates at once, optionally as a numbered
 * series threading through those meetings.
 *
 * @param {number} planId - Year plan ID
 * @param {Object} data - { meeting_ids, activity, as_series, series_label }
 * @returns {Promise<Object>} API response with { created, skipped, series_id }
 */
export async function batchPlaceActivity(planId, data) {
  const response = await API.post(`v1/yearly-planner/plans/${planId}/meetings/batch-activity`, data);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

/**
 * Remove every occurrence of a series.
 * @param {string} seriesId - Series identifier
 * @returns {Promise<Object>} API response
 */
export async function deleteSeries(seriesId) {
  const response = await API.delete(`v1/yearly-planner/series/${seriesId}`);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

/**
 * Update the editable fields on every occurrence of a series.
 * @param {string} seriesId - Series identifier
 * @param {Object} data - { name?, duration_minutes?, description? }
 * @returns {Promise<Object>} API response
 */
export async function updateSeries(seriesId, data) {
  const response = await API.patch(`v1/yearly-planner/series/${seriesId}`, data);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}

// ============================================================================
// ACTIVITY LIBRARY
// ============================================================================

export async function getActivityLibrary(params = {}, options = {}) {
  return API.get('v1/yearly-planner/activity-library', params, readCacheOptions(options));
}

export async function createLibraryActivity(data) {
  const response = await API.post('v1/yearly-planner/activity-library', data);
  await invalidatePlanner();
  return response;
}

export async function updateLibraryActivity(id, data) {
  const response = await API.patch(`v1/yearly-planner/activity-library/${id}`, data);
  await invalidatePlanner();
  return response;
}

export async function deleteLibraryActivity(id) {
  const response = await API.delete(`v1/yearly-planner/activity-library/${id}`);
  await invalidatePlanner();
  return response;
}

// ============================================================================
// OBJECTIVE ACHIEVEMENTS
// ============================================================================

export async function getAchievements(params = {}, options = {}) {
  return API.get('v1/yearly-planner/achievements', params, readCacheOptions(options));
}

export async function grantAchievements(data) {
  const response = await API.post('v1/yearly-planner/achievements', data);
  await invalidatePlanner();
  return response;
}

export async function removeAchievement(id) {
  const response = await API.delete(`v1/yearly-planner/achievements/${id}`);
  await invalidatePlanner();
  return response;
}

// ============================================================================
// DISTRIBUTION RULES
// ============================================================================

export async function getDistributionRules(planId, options = {}) {
  return API.get(`v1/yearly-planner/plans/${planId}/distribution-rules`, {}, readCacheOptions(options));
}

export async function createDistributionRule(planId, data) {
  const response = await API.post(`v1/yearly-planner/plans/${planId}/distribution-rules`, data);
  await invalidatePlanner();
  return response;
}

export async function deleteDistributionRule(ruleId) {
  const response = await API.delete(`v1/yearly-planner/distribution-rules/${ruleId}`);
  await invalidatePlanner();
  return response;
}

// ============================================================================
// REMINDERS
// ============================================================================

export async function getReminders(planId, options = {}) {
  return API.get(`v1/yearly-planner/plans/${planId}/reminders`, {}, readCacheOptions(options));
}

export async function getMeetingReminders(meetingId, options = {}) {
  return API.get(`v1/yearly-planner/meetings/${meetingId}/reminders`, {}, readCacheOptions(options));
}

export async function createReminder(meetingId, data) {
  const response = await API.post(`v1/yearly-planner/meetings/${meetingId}/reminders`, data);
  await invalidatePlanner({ includeMeetingPrep: true });
  return response;
}
