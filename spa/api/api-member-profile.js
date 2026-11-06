/** Personal forms and consent are always fresh, never cached or queued for offline replay. */
import { API } from './api-core.js';
export const getMyProfile = () => API.getNoCache('v1/member-profile/me');
export const saveMyProfile = (body) => API.put('v1/member-profile/me', body);
export const getMyHealth = () => API.getNoCache('v1/member-profile/me/health');
export const saveMyHealth = (body) => API.put('v1/member-profile/me/health', body);
export const getCampContacts = (activityId) => API.getNoCache(`v1/volunteer-space/camps/${encodeURIComponent(activityId)}/contacts`);
