// api-yearly-planner.js
// API endpoint functions for the Yearly Meeting Planner module
import { API } from './api-core.js';
import { CONFIG } from '../config.js';

// ============================================================================
// YEAR PLANS
// ============================================================================

export async function getYearPlans() {
  return API.get('v1/yearly-planner/plans');
}

export async function getYearPlan(planId) {
  return API.get(`v1/yearly-planner/plans/${planId}`);
}

export async function createYearPlan(data) {
  return API.post('v1/yearly-planner/plans', data);
}

export async function updateYearPlan(planId, data) {
  return API.patch(`v1/yearly-planner/plans/${planId}`, data);
}

export async function deleteYearPlan(planId) {
  return API.delete(`v1/yearly-planner/plans/${planId}`);
}

// ============================================================================
// PERIODS
// ============================================================================

export async function getPeriods(planId) {
  return API.get(`v1/yearly-planner/plans/${planId}/periods`);
}

export async function createPeriod(planId, data) {
  return API.post(`v1/yearly-planner/plans/${planId}/periods`, data);
}

export async function updatePeriod(periodId, data) {
  return API.patch(`v1/yearly-planner/periods/${periodId}`, data);
}

export async function deletePeriod(periodId) {
  return API.delete(`v1/yearly-planner/periods/${periodId}`);
}

// ============================================================================
// OBJECTIVES
// ============================================================================

export async function getObjectives(planId) {
  return API.get(`v1/yearly-planner/plans/${planId}/objectives`);
}

export async function createObjective(planId, data) {
  return API.post(`v1/yearly-planner/plans/${planId}/objectives`, data);
}

export async function updateObjective(objectiveId, data) {
  return API.patch(`v1/yearly-planner/objectives/${objectiveId}`, data);
}

export async function deleteObjective(objectiveId) {
  return API.delete(`v1/yearly-planner/objectives/${objectiveId}`);
}

// ============================================================================
// MEETINGS
// ============================================================================

export async function getYearPlanMeeting(meetingId) {
  return API.get(`v1/yearly-planner/meetings/${meetingId}`);
}

export async function updateYearPlanMeeting(meetingId, data) {
  return API.patch(`v1/yearly-planner/meetings/${meetingId}`, data);
}

// ============================================================================
// MEETING ACTIVITIES
// ============================================================================

export async function addMeetingActivity(meetingId, data) {
  return API.post(`v1/yearly-planner/meetings/${meetingId}/activities`, data);
}

export async function updateMeetingActivity(activityId, data) {
  return API.patch(`v1/yearly-planner/meeting-activities/${activityId}`, data);
}

export async function deleteMeetingActivity(activityId) {
  return API.delete(`v1/yearly-planner/meeting-activities/${activityId}`);
}

// ============================================================================
// ACTIVITY LIBRARY
// ============================================================================

export async function getActivityLibrary(params = {}) {
  return API.get('v1/yearly-planner/activity-library', params);
}

export async function createLibraryActivity(data) {
  return API.post('v1/yearly-planner/activity-library', data);
}

export async function updateLibraryActivity(id, data) {
  return API.patch(`v1/yearly-planner/activity-library/${id}`, data);
}

export async function deleteLibraryActivity(id) {
  return API.delete(`v1/yearly-planner/activity-library/${id}`);
}

// ============================================================================
// OBJECTIVE ACHIEVEMENTS
// ============================================================================

export async function getAchievements(params = {}) {
  return API.get('v1/yearly-planner/achievements', params);
}

export async function grantAchievements(data) {
  return API.post('v1/yearly-planner/achievements', data);
}

export async function removeAchievement(id) {
  return API.delete(`v1/yearly-planner/achievements/${id}`);
}

// ============================================================================
// DISTRIBUTION RULES
// ============================================================================

export async function getDistributionRules(planId) {
  return API.get(`v1/yearly-planner/plans/${planId}/distribution-rules`);
}

export async function createDistributionRule(planId, data) {
  return API.post(`v1/yearly-planner/plans/${planId}/distribution-rules`, data);
}

export async function deleteDistributionRule(ruleId) {
  return API.delete(`v1/yearly-planner/distribution-rules/${ruleId}`);
}

// ============================================================================
// REMINDERS
// ============================================================================

export async function getReminders(planId) {
  return API.get(`v1/yearly-planner/plans/${planId}/reminders`);
}

export async function createReminder(meetingId, data) {
  return API.post(`v1/yearly-planner/meetings/${meetingId}/reminders`, data);
}
