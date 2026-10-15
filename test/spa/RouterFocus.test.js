/**
 * @jest-environment jsdom
 *
 * After a navigation, keyboard and screen-reader users start on the new
 * screen's heading, not back at the top of the document.
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
import { stopFollowingHeading } from '../../spa/utils/PageFocusUtils.js';

/** A router whose screens draw `markup` into #app. */
function routerDrawing(screens) {
  const router = new Router({ isLoggedIn: false });
  jest.spyOn(router, 'renderRoute').mockImplementation((path) => {
    document.getElementById('app').innerHTML = screens[path];
    return Promise.resolve();
  });
  return router;
}

beforeEach(() => {
  document.body.innerHTML = '<a class="skip-link" href="#app">Skip</a><div id="app" tabindex="-1"></div>';
});

afterEach(() => {
  stopFollowingHeading();
});

const SCREENS = {
  '/dashboard': '<a href="/attendance" id="tile">Attendance</a><h1>Dashboard</h1>',
  '/attendance': '<a href="/dashboard">Back</a><h1>Attendance</h1>',
  '/login': '<h1>Sign in</h1><label for="email">Email</label><input id="email">',
};

test('the first screen after a page load leaves focus where the browser put it', async () => {
  const router = routerDrawing(SCREENS);
  await router.route('/dashboard');
  expect(document.activeElement).toBe(document.body);
});

test('a navigation moves focus to the new screen\'s heading', async () => {
  const router = routerDrawing(SCREENS);
  await router.route('/dashboard');
  document.getElementById('tile').focus();

  await router.route('/attendance');

  expect(document.activeElement).toBe(document.querySelector('#app h1'));
  expect(document.activeElement.textContent).toBe('Attendance');
});

test('a screen drawn again in place by live sync keeps focus where it was', async () => {
  const router = routerDrawing(SCREENS);
  await router.route('/dashboard');
  const skip = document.querySelector('.skip-link');
  skip.focus();

  await router.route('/dashboard', { refresh: true });

  expect(document.activeElement).toBe(skip);
});

test('a screen that focuses its own field keeps it', async () => {
  const router = new Router({ isLoggedIn: false });
  jest.spyOn(router, 'renderRoute').mockImplementation((path) => {
    document.getElementById('app').innerHTML = SCREENS[path];
    document.getElementById('email')?.focus();
    return Promise.resolve();
  });
  await router.route('/dashboard');

  await router.route('/login');

  expect(document.activeElement).toBe(document.getElementById('email'));
});

test('only the latest of two quick navigations moves focus', async () => {
  const router = new Router({ isLoggedIn: false });
  let releaseSlow;
  jest.spyOn(router, 'renderRoute').mockImplementation((path) => {
    if (path === '/slow') {
      return new Promise((resolve) => { releaseSlow = resolve; });
    }
    document.getElementById('app').innerHTML = SCREENS[path];
    return Promise.resolve();
  });
  await router.route('/dashboard');

  const slow = router.route('/slow');
  await router.route('/attendance');
  const heading = document.querySelector('#app h1');
  expect(document.activeElement).toBe(heading);

  document.querySelector('.skip-link').focus();
  releaseSlow();
  await slow;
  expect(document.activeElement).toBe(document.querySelector('.skip-link'));
});
