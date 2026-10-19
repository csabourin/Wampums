/**
 * @jest-environment jsdom
 */

/**
 * Switching the session to another unit: the new token, roles and
 * permissions are stored, and the app then reads the new unit's settings.
 * A refused switch changes nothing.
 *
 * @module test/spa/UnitSwitch
 */

jest.mock('../../spa/api/api-endpoints.js', () => ({ switchOrganization: jest.fn() }));
jest.mock('../../spa/modules/session/AccessRefresh.js', () => ({ refreshAccess: jest.fn() }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));

import { switchActiveUnit } from '../../spa/modules/session/UnitSwitch.js';
import { switchOrganization } from '../../spa/api/api-endpoints.js';
import { refreshAccess } from '../../spa/modules/session/AccessRefresh.js';

const CLAIMS = { permissions: ['roles.view'], roleIds: [2], roleNames: ['unitadmin'] };
const TOKEN = `${btoa('{}')}.${btoa(JSON.stringify(CLAIMS))}.signature`;

let app;

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  refreshAccess.mockResolvedValue(false);
  app = { userPermissions: ['old.key'], userRoles: ['district'], useOrganization: jest.fn(() => Promise.resolve()) };
});

test('a switch stores the new unit\'s token and access, then loads its settings', async () => {
  switchOrganization.mockResolvedValue({ success: true, data: { token: TOKEN } });
  await switchActiveUnit(app, 7);

  expect(switchOrganization).toHaveBeenCalledWith(7);
  expect(localStorage.getItem('jwtToken')).toBe(TOKEN);
  expect(app.userPermissions).toEqual(CLAIMS.permissions);
  expect(app.userRoles).toEqual(CLAIMS.roleNames);
  expect(refreshAccess).toHaveBeenCalledWith(app);
  expect(app.useOrganization).toHaveBeenCalledWith(7);
  expect(refreshAccess.mock.invocationCallOrder[0]).toBeLessThan(app.useOrganization.mock.invocationCallOrder[0]);
});

test('a switch that brings no token fails and leaves the session as it was', async () => {
  // What an offline request answers when it is only queued.
  switchOrganization.mockResolvedValue({ success: true, queued: true });
  await expect(switchActiveUnit(app, 7)).rejects.toThrow();

  expect(localStorage.getItem('jwtToken')).toBeNull();
  expect(app.userPermissions).toEqual(['old.key']);
  expect(app.useOrganization).not.toHaveBeenCalled();
});

test('a refused switch leaves the session as it was', async () => {
  switchOrganization.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
  await expect(switchActiveUnit(app, 7)).rejects.toThrow();

  expect(localStorage.getItem('jwtToken')).toBeNull();
  expect(refreshAccess).not.toHaveBeenCalled();
  expect(app.useOrganization).not.toHaveBeenCalled();
});
