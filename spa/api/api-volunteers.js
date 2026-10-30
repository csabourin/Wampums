/** Volunteer shifts (#1251). Writes need a connection: a place is confirmed or refused now. */
import { API } from './api-core.js';

/** Upcoming shifts, with places and the caller's own sign-up; managers also get names. */
export const getVolunteerShifts = () => API.getNoCache('v1/volunteer-shifts');
/** Activities a shift may belong to: names and dates only. */
export const getVolunteerShiftActivities = () => API.getNoCache('v1/volunteer-shifts/activities');
export const saveVolunteerShift = (shift, id = null) => id
  ? API.put(`v1/volunteer-shifts/${encodeURIComponent(id)}`, shift)
  : API.post('v1/volunteer-shifts', shift);
export const deleteVolunteerShift = (id) => API.delete(`v1/volunteer-shifts/${encodeURIComponent(id)}`);
export const signUpForShift = (id) => API.post(`v1/volunteer-shifts/${encodeURIComponent(id)}/signups`, {});
export const withdrawFromShift = (id) => API.delete(`v1/volunteer-shifts/${encodeURIComponent(id)}/signups/me`);
export const removeVolunteer = (id, userId) =>
  API.delete(`v1/volunteer-shifts/${encodeURIComponent(id)}/signups/${encodeURIComponent(userId)}`);
