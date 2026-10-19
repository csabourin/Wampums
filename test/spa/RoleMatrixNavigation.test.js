/** @jest-environment jsdom */
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/modules/dashboard/Dashboard.js', () => ({ Dashboard: jest.fn() }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), isDebugMode: () => false }));
import { Router } from '../../spa/router.js';
import { TabbedPage } from '../../spa/modules/TabbedPage.js';

beforeEach(() => { document.body.innerHTML = '<main id="app"><h1>Matrix</h1></main>'; });

test('declining to discard changes preserves the editor and restores its URL', async () => {
  const router = new Router({ isLoggedIn: true });
  router.currentPath = '/roles/permissions';
  router.currentModuleInstance = { beforeLeave: jest.fn().mockResolvedValue(false), destroy: jest.fn() };
  const render = jest.spyOn(router, 'renderRoute').mockResolvedValue();
  window.history.pushState(null, '', '/dashboard');
  await router.route('/dashboard');
  expect(render).not.toHaveBeenCalled();
  expect(router.currentModuleInstance.destroy).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe('/roles/permissions');
});
test('a live refresh consults the editor before tearing it down', async () => {
  const router = new Router({ isLoggedIn: true });
  const beforeLeave = jest.fn().mockResolvedValue(false);
  router.currentModuleInstance = { beforeLeave };
  const render = jest.spyOn(router, 'renderRoute').mockResolvedValue();
  await router.route('/roles/permissions', { refresh: true });
  expect(beforeLeave).toHaveBeenCalledWith({ refresh: true });
  expect(render).not.toHaveBeenCalled();
});
test('declining to discard district edits keeps the Roles tab mounted', async () => {
  const page = new TabbedPage({}, { tabs: [{ key: 'roles' }, { key: 'unites' }] });
  page.activeKey = 'roles';
  page.activeModule = { beforeLeave: jest.fn().mockResolvedValue(false) };
  const mount = jest.spyOn(page, 'mountActiveTab').mockResolvedValue();
  await page.switchTo('unites');
  expect(page.activeKey).toBe('roles'); expect(mount).not.toHaveBeenCalled();
});
test('an accepted district tab change updates the URL remembered by the router', async () => {
  const app = { router: {} };
  const page = new TabbedPage(app, { tabs: [{ key: 'roles' }, { key: 'unites' }] });
  page.activeKey = 'roles';
  page.activeModule = { beforeLeave: jest.fn().mockResolvedValue(true) };
  jest.spyOn(page, 'mountActiveTab').mockResolvedValue();
  window.history.replaceState(null, '', '/district?tab=roles');
  await page.switchTo('unites');
  expect(app.router.currentPath).toBe('/district?tab=unites');
});
