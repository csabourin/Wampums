import { API } from './api-core.js';
const equipmentPath = (id) => /^activity-[1-9]\d*$/.test(String(id)) ? `activities/${String(id).slice('activity-'.length)}` : encodeURIComponent(id);
/** Published common lists; checkmarks never reach an API. */
export const getPersonalEquipmentTasks = () => API.get('v1/personal-equipment/mine');
export const getPersonalEquipment = (meetingId, manage = false) => API.get(`v1/personal-equipment/${equipmentPath(meetingId)}${manage ? '/manage' : ''}`, {}, { forceRefresh: navigator.onLine });
export const savePersonalEquipment = (meetingId, data) => API.put(`v1/personal-equipment/${equipmentPath(meetingId)}`, data, {}, { queueOffline: false });
export const translatePersonalEquipment = (meetingId, language) => API.post(
  `v1/personal-equipment/${equipmentPath(meetingId)}/translations`, { language }, {}, { queueOffline: false });
