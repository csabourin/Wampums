/**
 * @jest-environment jsdom
 *
 * The router tells a screen whether it is drawn again in place (live sync)
 * or navigated to, so a refreshed screen can keep what is on display.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/modules/dashboard/Dashboard.js', () => ({ Dashboard: jest.fn() }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  isDebugMode: () => false,
}));

import { Router } from '../../spa/router.js';

test('a screen drawn again in place is told it is a refresh; the next navigation is not', async () => {
  const router = new Router({ isLoggedIn: false });
  let duringRefresh = null;
  jest.spyOn(router, 'getRouteNameAndParam').mockImplementation(() => {
    duringRefresh = router.isRefreshingScreen();
    throw new Error('stop here');
  });

  await router.route('/dashboard', { refresh: true }).catch(() => {});
  expect(duringRefresh).toBe(true);

  await router.route('/dashboard').catch(() => {});
  expect(duringRefresh).toBe(false);
});
