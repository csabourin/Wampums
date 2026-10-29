import { API } from './api-core.js';
/** Published common lists; checkmarks never reach an API. */
export const getPersonalEquipmentTasks = () => API.get('v1/personal-equipment/mine');
export const getPersonalEquipment = (meetingId, manage = false) => API.get(`v1/personal-equipment/${encodeURIComponent(meetingId)}${manage ? '/manage' : ''}`, {}, { forceRefresh: navigator.onLine });
export const savePersonalEquipment = (meetingId, data) => API.put(`v1/personal-equipment/${encodeURIComponent(meetingId)}`, data, {}, { queueOffline: false });
export const translatePersonalEquipment = (meetingId, language) => API.post(
  `v1/personal-equipment/${encodeURIComponent(meetingId)}/translations`, { language }, {}, { queueOffline: false });
