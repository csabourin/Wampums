/**
 * Volunteer space (#1360): a member's own shifts and tasks, and the camps they take part in.
 * Read online every time; the last answer is kept on the device for a camp without a connection.
 */
import { API } from './api-core.js';
import { CONFIG } from '../config.js';

const READ = () => ({ forceRefresh: true, cacheDuration: CONFIG.CACHE_DURATION.CAMP_MODE });

/** Camps the member takes part in, their upcoming places and their open tasks. */
export const getVolunteerSpace = () => API.get('v1/volunteer-space', {}, READ());
/** One camp of the member's: shifts, schedule, tasks, site, the team's instructions and what their shift types call for. */
export const getVolunteerSpaceCamp = (activityId) =>
  API.get(`v1/volunteer-space/camps/${encodeURIComponent(activityId)}`, {}, READ());
