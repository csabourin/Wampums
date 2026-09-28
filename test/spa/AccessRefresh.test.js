/**
 * @jest-environment jsdom
 */

/**
 * Refreshing the stored roles and permissions.
 *
 * Screens and route guards read the copy stored at sign-in. When a role loses
 * a permission, the copy must follow on the next start, so a parent who lost
 * the unit's finances stops seeing them without signing in again. When the
 * server cannot be reached, nothing is thrown away: the API still decides.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/api/api-endpoints.js', () => ({
  getCurrentAccess: jest.fn()
}));

import { getCurrentAccess } from '../../spa/api/api-endpoints.js';
import { refreshAccess } from '../../spa/modules/session/AccessRefresh.js';

const SIGNED_IN_PERMISSIONS = ['participants.create_own', 'finance.view', 'budget.view'];

/**
 * An app object holding the copy stored at sign-in.
 *
 * @returns {Object} App with roles and permissions
 */
function signedInParent() {
  localStorage.setItem('userRoles', JSON.stringify(['parent']));
  localStorage.setItem('userPermissions', JSON.stringify(SIGNED_IN_PERMISSIONS));
  return { userRoles: ['parent'], userPermissions: [...SIGNED_IN_PERMISSIONS] };
}

describe('refreshAccess', () => {
  beforeEach(() => {
    localStorage.clear();
    getCurrentAccess.mockReset();
  });

  test('replaces permissions the role no longer holds, in memory and in storage', async () => {
    const app = signedInParent();
    getCurrentAccess.mockResolvedValue({
      success: true,
      data: { roles: ['parent'], permissions: ['participants.create_own'] }
    });

    const changed = await refreshAccess(app);

    expect(changed).toBe(true);
    expect(app.userPermissions).toEqual(['participants.create_own']);
    expect(JSON.parse(localStorage.getItem('userPermissions'))).toEqual(['participants.create_own']);
    expect(JSON.parse(localStorage.getItem('userRoles'))).toEqual(['parent']);
  });

  test('reports no change when the server agrees, in whatever order', async () => {
    const app = signedInParent();
    getCurrentAccess.mockResolvedValue({
      success: true,
      data: { roles: ['parent'], permissions: [...SIGNED_IN_PERMISSIONS].reverse() }
    });

    await expect(refreshAccess(app)).resolves.toBe(false);
    expect(app.userPermissions).toEqual(SIGNED_IN_PERMISSIONS);
  });

  test('picks up a role added since sign-in', async () => {
    const app = signedInParent();
    getCurrentAccess.mockResolvedValue({
      success: true,
      data: { roles: ['finance', 'parent'], permissions: SIGNED_IN_PERMISSIONS }
    });

    await expect(refreshAccess(app)).resolves.toBe(true);
    expect(app.userRoles).toEqual(['finance', 'parent']);
  });

  test('keeps the stored copy when the server cannot be reached', async () => {
    const app = signedInParent();
    getCurrentAccess.mockRejectedValue(new Error('offline'));

    await expect(refreshAccess(app)).resolves.toBe(false);
    expect(app.userPermissions).toEqual(SIGNED_IN_PERMISSIONS);
    expect(JSON.parse(localStorage.getItem('userPermissions'))).toEqual(SIGNED_IN_PERMISSIONS);
  });

  test('keeps the stored copy when the answer is malformed', async () => {
    const app = signedInParent();
    getCurrentAccess.mockResolvedValue({ success: true, data: { roles: ['parent'] } });

    await expect(refreshAccess(app)).resolves.toBe(false);
    expect(app.userPermissions).toEqual(SIGNED_IN_PERMISSIONS);
  });
});
