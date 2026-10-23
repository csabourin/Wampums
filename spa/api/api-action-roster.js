import { API } from './api-core.js';

/** Signed authorizations and attendance for a date, scoped by the API client. */
export function getActionRoster(date) {
  return navigator.onLine
    ? API.getNoCache('v1/action-roster', { date })
    : API.get('v1/action-roster', { date });
}

/** A departure changes eligibility, while retaining the day's attendance credit. */
export function markActivityDeparture(participantId, date) {
  return API.post('v1/attendance/departure', { participant_id: participantId, date });
}
