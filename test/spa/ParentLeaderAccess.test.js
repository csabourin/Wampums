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

import { canAccessParentTools, holdsFamilyRole, hasOrganizationScope, isParent } from '../../spa/utils/PermissionUtils.js';
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

describe('canAccessParentTools', () => {
  test('a parent who also holds a whole-unit role without participants.view keeps the family pages', () => {
    signIn(['parent', 'u12_communications'], 'organization');
    mockApp.userPermissions = ['communications.send'];
    expect(isParent()).toBe(false);
    expect(canAccessParentTools()).toBe(true);
  });

  test('staff without a family role need participants.view', () => {
    signIn(['u12_communications'], 'organization');
    mockApp.userPermissions = ['communications.send'];
    expect(canAccessParentTools()).toBe(false);
    mockApp.userPermissions = ['participants.view'];
    expect(canAccessParentTools()).toBe(true);
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

describe('guardian access is not a persona choice', () => {
  // The router cannot be instantiated under Jest without the whole
  // application; read its source, as FamilyAccessRoutes does.
  const fs = require('fs');
  const path = require('path');
  const routerSource = fs.readFileSync(path.join(__dirname, '../../spa/router.js'), 'utf8');
  const dashboardSource = fs.readFileSync(path.join(__dirname, '../../spa/dashboard.js'), 'utf8');

  test('no page grants access because the person is parent-only', () => {
    // isParent() is false for a parent who is also a leader; as an access
    // alternative it took their own children's pages away from them.
    expect(routerSource).not.toMatch(/guard\(isParent\(\)/);
    expect(dashboardSource).not.toMatch(/return isParent\(\) \|\|/);
  });

  test('a parent who is also a leader keeps their child\'s medication pages', () => {
    expect(routerSource).toMatch(
      /case "medicationPlanningParticipant":\s*if \(!guard\(holdsFamilyRole\(\) \|\| canViewMedication\(\)\)\)/
    );
    expect(routerSource).toMatch(
      /case "medicationAuthorizationsParticipant":\s*if \(!guard\(holdsFamilyRole\(\) \|\| canViewMedication\(\)\)\)/
    );
  });
});
