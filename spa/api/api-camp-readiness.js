import { API } from './api-core.js';
/** Always refresh preparation decisions from their authoritative resources. */
export const getCampReadiness = (meetingId) => API.getNoCache(`v1/camp-readiness/${encodeURIComponent(meetingId)}`);
/** A camp recorded as an activity of several days; its planned camp answers when there is one. */
export const getActivityCampReadiness = (activityId) => API.getNoCache(`v1/camp-readiness/activities/${encodeURIComponent(activityId)}`);
/** Camps under way or starting within two weeks, for the dashboard. */
export const getUpcomingCamps = () => API.getNoCache('v1/camp-readiness/upcoming');
