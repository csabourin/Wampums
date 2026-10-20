/** Role definitions always require a current, confirmed server result. */
import { API } from './api-core.js';

export function getRoleMatrix() {
  return API.getNoCache('v1/roles/matrix');
}
export function replaceRolePermissions(roleId, permissionIds, expectedIds) {
  return API.put(`v1/roles/${encodeURIComponent(roleId)}/permissions`, {
    permission_ids: permissionIds, expected_permission_ids: expectedIds,
  });
}
export function createUnitRole(definition) {
  return API.post('v1/roles', definition);
}
export function updateUnitRole(roleId, definition) {
  return API.patch(`v1/roles/${encodeURIComponent(roleId)}`, definition);
}
export function deleteUnitRole(roleId) {
  return API.delete(`v1/roles/${encodeURIComponent(roleId)}`);
}
/** Hide a built-in role the unit customized, or show it again. */
export function setRoleHidden(roleId, hidden) {
  return API.put(`v1/roles/${encodeURIComponent(roleId)}/visibility`, { hidden });
}
