/**
 * @jest-environment jsdom
 *
 * The leaders' programme bar is kept in step with the session on every
 * navigation, including one sent to the sign-in page because the session ended.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/modules/dashboard/Dashboard.js', () => ({ Dashboard: jest.fn() }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  isDebugMode: () => false,
}));
jest.mock('../../spa/utils/SessionUtils.js', () => ({
  checkSession: jest.fn(() => ({
    isLoggedIn: false, userRole: null, userFullName: null, userRoles: [], userPermissions: [], userDataScope: null,
  })),
}));
jest.mock('../../spa/modules/programme-bar/ProgrammeBar.js', () => ({ syncProgrammeBar: jest.fn() }));

import { Router } from '../../spa/router.js';
import { syncProgrammeBar } from '../../spa/modules/programme-bar/ProgrammeBar.js';

test('a session that ended on a protected page takes the bar down as it sends to sign-in', async () => {
  const app = { isLoggedIn: true, addSettingsIcon: jest.fn(), removeSettingsIcon: jest.fn() };
  const router = new Router(app);
  const loadLoginPage = jest.spyOn(router, 'loadLoginPage').mockResolvedValue();

  await router.renderRoute('/dashboard');

  expect(loadLoginPage).toHaveBeenCalled();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  expect(syncProgrammeBar).toHaveBeenCalledWith(app);
  expect(app.isLoggedIn).toBe(false);
});
