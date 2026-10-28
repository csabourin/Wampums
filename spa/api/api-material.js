/** Minimal choices for identifying the real owner; never loads group rosters. */
import { API } from './api-core.js';
export const getEquipmentOwners = () => API.getNoCache('v1/resources/equipment/owners');
