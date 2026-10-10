/**
 * A parent who becomes a leader.
 *
 * Such an account keeps the parent role for their own children and gains the
 * leader role. `isParent()` answered from the parent role alone, so the app
 * sent them to the parent dashboard -- listing every child of the unit, since
 * the leader role opens the whole unit -- and never to the unit's dashboard.
 * The unit's dashboard is chosen now when one role covers the whole unit
 * (the server's data_scope), whatever family role the person also holds.
 */

const TRANSLATIONS = {
  role_label_leader: 'Animateurs',
  role_label_unitadmin: 'Gestion d’unité'
};

const mockApp = { userRoles: [], userPermissions: [], userDataScope: null };

jest.mock('../../spa/app.js', () => ({
  get app() {
    return mockApp;
  },
  translate: (key) => TRANSLATIONS[key] || key
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn()
}));

import { holdsFamilyRole, hasOrganizationScope, isParent } from '../../spa/utils/PermissionUtils.js';
import { roleLabel } from '../../spa/utils/RoleLabelUtils.js';

/**
 * Set the signed-in account.
 *
 * @param {string[]} roles - Role names
 * @param {?string} dataScope - Scope reported by the server
 */
function signIn(roles, dataScope) {
  mockApp.userRoles = roles;
  mockApp.userDataScope = dataScope;
}

describe('isParent', () => {
  test('a family-only account is a parent', () => {
    signIn(['parent'], 'linked');
    expect(isParent()).toBe(true);
    expect(holdsFamilyRole()).toBe(true);
  });

  test('a parent who is also a leader uses the unit, and keeps the family role', () => {
    signIn(['leader', 'parent'], 'organization');
    expect(isParent()).toBe(false);
    expect(hasOrganizationScope()).toBe(true);
    expect(holdsFamilyRole()).toBe(true);
  });

  test('a custom organization-wide role counts, whatever its name', () => {
    signIn(['parent', 'u12_animation_castors'], 'organization');
    expect(isParent()).toBe(false);
  });

  test('a session stored before the scope was known stays as it was until refreshed', () => {
    signIn(['leader', 'parent'], null);
    expect(isParent()).toBe(true);
  });

  test('a staff account without a family role is not a parent', () => {
    signIn(['leader'], 'organization');
    expect(isParent()).toBe(false);
    expect(holdsFamilyRole()).toBe(false);
  });
});

describe('roleLabel', () => {
  test('names a built-in role in the interface language', () => {
    expect(roleLabel({ role_name: 'leader', display_name: 'Leader' })).toBe('Animateurs');
    expect(roleLabel('unitadmin')).toBe('Gestion d’unité');
  });

  test('keeps the name a unit gave its own role', () => {
    expect(roleLabel({ role_name: 'u12_tresorerie', display_name: 'Trésorerie' })).toBe('Trésorerie');
  });

  test('falls back to the role name when nothing else names it', () => {
    expect(roleLabel({ role_name: 'u12_x' })).toBe('u12_x');
    expect(roleLabel('u12_x')).toBe('u12_x');
    expect(roleLabel(null)).toBe('');
  });
});
