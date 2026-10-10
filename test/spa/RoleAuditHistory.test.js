/**
 * @jest-environment jsdom
 */

/**
 * Role change history in the district Units tab.
 *
 * The server returns the roles before and after each change (as they were
 * then) and an optional note. The screen names the roles added and removed in
 * the interface language (built-in roles through role_label_*) and escapes
 * every value it shows. Entries recorded only on this device (a failed save
 * waiting to be retried) keep their own summary.
 *
 * @module test/spa/RoleAuditHistory
 */

const TRANSLATIONS = {
  role_label_leader: 'Animateurs',
  role_label_parent: 'Parent',
  district_management_audit_added: 'Ajouté : {roles}',
  district_management_audit_removed: 'Retiré : {roles}',
  district_management_audit_note: 'Note : {note}',
  district_management_unknown_actor: 'Utilisateur inconnu',
  district_management_audit_unknown_change: 'Détails indisponibles',
};

jest.mock('../../spa/app.js', () => ({
  app: {},
  translate: (key) => TRANSLATIONS[key] || key,
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  CONFIG: { CACHE_DURATION: { SHORT: 1 } },
  clearUserCaches: jest.fn(),
  getCurrentOrganizationId: jest.fn(() => 1),
  getRoleAuditLog: jest.fn(),
  getRoleBundles: jest.fn(),
  getRolePermissions: jest.fn(),
  getUserOrganizations: jest.fn(),
  getUsers: jest.fn(),
  getUserRoleAssignments: jest.fn(),
  updateUserRoleBundles: jest.fn(),
  updateUserRolesV1: jest.fn(),
}));

jest.mock('../../spa/indexedDB.js', () => ({ getCachedData: jest.fn(), setCachedData: jest.fn() }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canAssignRoles: () => true,
  canViewRoles: () => true,
}));
jest.mock('../../spa/utils/RoleValidationUtils.js', () => ({
  buildRoleBundleIndex: () => ({ list: [], byName: {} }),
  calculatePermissionGaps: () => ({ missing: [] }),
  detectRoleConflicts: () => ({ hasConflict: false, conflicts: [] }),
  getLocalGroupEligibleRoles: () => [],
}));
jest.mock('../../spa/utils/PageMount.js', () => ({
  getMountPoint: () => globalThis.document.getElementById('app'),
  resolveMountOptions: () => ({}),
}));

import { DistrictManagement } from '../../spa/district_management.js';

const LEADER = { id: 3, role_name: 'leader', display_name: 'Leader' };
const PARENT = { id: 4, role_name: 'parent', display_name: 'Parent' };
const CUSTOM = { id: 9, role_name: 'u1_tresorerie', display_name: 'Trésorerie' };

/**
 * Render one entry into the document and return its element.
 *
 * @param {Object} entry - Audit entry
 * @returns {HTMLElement} The rendered list item
 */
function render(entry) {
  const view = new DistrictManagement({ lang: 'fr' });
  document.body.innerHTML = `<ul>${view.renderAuditEntry(entry)}</ul>`;
  return document.querySelector('.dm-audit-entry');
}

describe('role history entry', () => {
  test('names the roles added and removed in the interface language, and the note', () => {
    const item = render({
      actor_name: 'Akela',
      created_at: '2026-10-10T16:00:00Z',
      previous_roles: [PARENT],
      new_roles: [LEADER, CUSTOM],
      note: 'Devenue animatrice',
    });

    const summary = item.querySelector('.dm-audit-summary').innerHTML.split('<br>');
    expect(summary).toEqual(['Ajouté : Animateurs, Trésorerie', 'Retiré : Parent', 'Note : Devenue animatrice']);
    expect(item.querySelector('.dm-audit-actor').textContent).toBe('Akela');
  });

  test('escapes the note, the author and custom role names', () => {
    const item = render({
      actor_name: '<img src=x onerror=alert(1)>',
      previous_roles: [],
      new_roles: [{ id: 10, role_name: 'u1_x', display_name: '<b>Bold</b>' }],
      note: '<script>alert(1)</script>',
    });

    expect(item.querySelector('img, script, b')).toBeNull();
    expect(item.textContent).toContain('<script>alert(1)</script>');
    expect(item.textContent).toContain('<b>Bold</b>');
  });

  test('an author since removed reads as unknown', () => {
    const item = render({ actor_name: null, previous_roles: [PARENT], new_roles: [] });

    expect(item.querySelector('.dm-audit-actor').textContent).toBe('Utilisateur inconnu');
    expect(item.querySelector('.dm-audit-summary').textContent).toBe('Retiré : Parent');
  });

  test('an entry recorded only on this device keeps its summary', () => {
    const item = render({ actor_name: 'Akela', summary: 'Animateurs', status: 'error' });

    expect(item.querySelector('.dm-audit-summary').textContent).toBe('Animateurs');
  });
});
