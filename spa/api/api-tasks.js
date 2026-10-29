/** Shared tasks; mutations require a connection and are never queued. */
import { API } from './api-core.js';

export const getMyTasks = (options = {}) => API.get('v1/tasks/mine', {}, options);
export const getUnitTasks = (options = {}) => API.get('v1/tasks', {}, options);
export const getTaskOptions = () => API.getNoCache('v1/tasks/options');
export const saveTask = (task, id = null) => id
  ? API.put(`v1/tasks/${encodeURIComponent(id)}`, task)
  : API.post('v1/tasks', task);
export const changeTaskStatus = (id, status, expectedStatus, ownOnly = true) =>
  API.patch(`v1/tasks/${ownOnly ? 'mine/' : ''}${encodeURIComponent(id)}/status`, { status, expected_status: expectedStatus });

export const configureEquipmentReminder = (id, value) => API.put(`v1/tasks/${encodeURIComponent(id)}/equipment-reminder`, value);
export const confirmEquipmentReminder = (id, revision) => API.post(`v1/tasks/mine/${encodeURIComponent(id)}/equipment-confirmation`, { revision });
