import { refreshStoredAccess } from '../AccessRefresh';

const STORED_ROLES = ['parent'];
const STORED_PERMISSIONS = ['participants.view', 'permission_slips.sign'];

describe('refreshing the access stored at sign-in', () => {
  test('stores and returns the server\'s permissions when a role gained a key', async () => {
    const store = jest.fn().mockResolvedValue(true);
    const current = [...STORED_PERMISSIONS, 'activities.view', 'carpools.view'];

    const access = await refreshStoredAccess({
      fetchAccess: jest.fn().mockResolvedValue({ success: true, data: { roles: STORED_ROLES, permissions: current } }),
      storedRoles: STORED_ROLES,
      storedPermissions: STORED_PERMISSIONS,
      store,
    });

    expect(access).toEqual({ changed: true, sessionRejected: false, roles: STORED_ROLES, permissions: current });
    expect(store).toHaveBeenCalledWith({ roles: STORED_ROLES, permissions: current });
  });

  test('leaves storage alone when nothing changed, whatever the order', async () => {
    const store = jest.fn();
    const access = await refreshStoredAccess({
      fetchAccess: jest.fn().mockResolvedValue({ data: { roles: STORED_ROLES, permissions: [...STORED_PERMISSIONS].reverse() } }),
      storedRoles: STORED_ROLES,
      storedPermissions: STORED_PERMISSIONS,
      store,
    });

    expect(access.changed).toBe(false);
    expect(access.permissions).toEqual(STORED_PERMISSIONS);
    expect(store).not.toHaveBeenCalled();
  });

  test('keeps the stored copy when offline or the answer is unexpected', async () => {
    const store = jest.fn();
    const onError = jest.fn();
    const offline = await refreshStoredAccess({
      fetchAccess: jest.fn().mockRejectedValue(new Error('Network request failed')),
      storedRoles: STORED_ROLES,
      storedPermissions: STORED_PERMISSIONS,
      store,
      onError,
    });
    const malformed = await refreshStoredAccess({
      fetchAccess: jest.fn().mockResolvedValue({ success: false, message: 'Authentication required' }),
      storedRoles: STORED_ROLES,
      storedPermissions: STORED_PERMISSIONS,
      store,
    });

    expect(offline.permissions).toEqual(STORED_PERMISSIONS);
    expect(malformed.permissions).toEqual(STORED_PERMISSIONS);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(store).not.toHaveBeenCalled();
  });

  test('a removed permission is removed from storage too', async () => {
    const store = jest.fn().mockResolvedValue(true);
    const access = await refreshStoredAccess({
      fetchAccess: jest.fn().mockResolvedValue({ data: { roles: STORED_ROLES, permissions: ['participants.view'] } }),
      storedRoles: STORED_ROLES,
      storedPermissions: STORED_PERMISSIONS,
      store,
    });

    expect(access.permissions).toEqual(['participants.view']);
    expect(store).toHaveBeenCalledWith({ roles: STORED_ROLES, permissions: ['participants.view'] });
  });

  test('missing stored lists count as empty', async () => {
    const access = await refreshStoredAccess({
      fetchAccess: jest.fn().mockRejectedValue(new Error('offline')),
      storedRoles: null,
      storedPermissions: undefined,
      store: jest.fn(),
    });
    expect(access).toEqual({ changed: false, sessionRejected: false, roles: [], permissions: [] });
  });

  test('a token the server rejects (401) sends the app back to sign-in', async () => {
    const store = jest.fn();
    const access = await refreshStoredAccess({
      // What the mobile API client throws after clearing the stored session.
      fetchAccess: jest.fn().mockRejectedValue({ success: false, status: 401, requiresLogin: true }),
      storedRoles: STORED_ROLES,
      storedPermissions: STORED_PERMISSIONS,
      store,
    });

    expect(access).toEqual({ changed: false, sessionRejected: true, roles: [], permissions: [] });
    expect(store).not.toHaveBeenCalled();
  });

  test('a server error is not mistaken for a rejected session', async () => {
    const access = await refreshStoredAccess({
      fetchAccess: jest.fn().mockRejectedValue({ success: false, status: 500 }),
      storedRoles: STORED_ROLES,
      storedPermissions: STORED_PERMISSIONS,
      store: jest.fn(),
    });
    expect(access.sessionRejected).toBe(false);
    expect(access.permissions).toEqual(STORED_PERMISSIONS);
  });
});
