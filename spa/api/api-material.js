/** Fresh owner choices while connected; scoped cached choices remain readable offline. No rosters. */
import { API } from './api-core.js';
export const getEquipmentOwners = () => API.get('v1/resources/equipment/owners', {}, { forceRefresh: true });
