import { API } from './api-core.js';
/** Always refresh preparation decisions from their authoritative resources. */
export const getCampReadiness = (meetingId) => API.getNoCache(`v1/camp-readiness/${encodeURIComponent(meetingId)}`);
