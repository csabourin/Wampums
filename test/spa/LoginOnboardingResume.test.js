/**
 * @jest-environment jsdom
 */

/**
 * Where a parent lands after signing in.
 *
 * A parent who accepted an invitation and closed the tab before registering a
 * child must be brought back to that step. Whether they have finished is read
 * from the server, never from this browser: the invitation may have been
 * accepted on a phone and this sign-in be on a laptop. And the check is a
 * convenience -- if it fails, signing in must still work.
 *
 * @module test/spa/LoginOnboardingResume
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/ajax-functions.js', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  getApiUrl: jest.fn(),
  getCurrentOrganizationId: jest.fn(),
  fetchOrganizationId: jest.fn(),
}));
jest.mock('../../spa/utils/StorageUtils.js', () => ({
  setStorage: jest.fn(),
  getStorage: jest.fn(),
  removeStorage: jest.fn(),
  setStorageMultiple: jest.fn(),
}));
jest.mock('../../spa/utils/ClientCleanupUtils.js', () => ({ clearAllClientData: jest.fn() }));

const mockRole = { parent: true, permissions: new Set(['participants.create_own']) };
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  isParent: () => mockRole.parent,
  hasPermission: (key) => mockRole.permissions.has(key),
}));
jest.mock('../../spa/api/api-family.js', () => ({ getOnboardingContext: jest.fn() }));

import { getOnboardingContext } from '../../spa/api/api-family.js';
import { Login } from '../../spa/login.js';
import { buildLoginRedirect } from '../../spa/utils/LoginRedirectUtils.js';

/**
 * Run the post-login redirect and report where it went.
 *
 * @returns {Promise<string>} The routed path
 */
async function landing() {
  const route = jest.fn();
  await Login.prototype.redirectAfterLogin.call({ app: { router: { route } } });
  return route.mock.calls[0][0];
}

beforeEach(() => {
  history.replaceState(null, '', '/login');
  jest.clearAllMocks();
  mockRole.parent = true;
  mockRole.permissions = new Set(['participants.create_own']);
});

test.each([true, false])('a notification destination survives login for parent=%s', async (parent) => {
  mockRole.parent = parent;
  history.replaceState(null, '', '/login?returnTo=%2Fmessages%2F42');
  expect(await landing()).toBe('/messages/42');
  expect(getOnboardingContext).not.toHaveBeenCalled();
});

test('a local return destination preserves its query string and fragment', async () => {
  history.replaceState(null, '', '/messages/42?source=push#message-title');
  const routePath = window.location.pathname + window.location.search;
  history.pushState(null, '', buildLoginRedirect(routePath, window.location.href));
  expect(await landing()).toBe('/messages/42?source=push');
  expect(window.location.hash).toBe('#message-title');
});

test('a static destination with a fragment is routed without the fragment', async () => {
  history.replaceState(null, '', '/dashboard#announcements');
  history.pushState(null, '', buildLoginRedirect('/dashboard', window.location.href));
  expect(await landing()).toBe('/dashboard');
  expect(window.location.hash).toBe('#announcements');
});

test('programmatic navigation does not copy a different page fragment', async () => {
  history.replaceState(null, '', '/dashboard#announcements');
  history.pushState(null, '', buildLoginRedirect('/messages/42', window.location.href));
  expect(await landing()).toBe('/messages/42');
  expect(window.location.hash).toBe('');
});

test('a destination fragment wins over the current page fragment', () => {
  const redirect = buildLoginRedirect('/messages/42#requested', 'http://localhost/messages/42#previous');
  expect(new URLSearchParams(redirect.split('?')[1]).get('returnTo')).toBe('/messages/42#requested');
});

test.each(['https://example.com/messages/42', '//example.com/messages/42', '/\\example.com/messages/42', '/login?returnTo=/messages/42'])('rejects unsafe or looping return destination %s', async (destination) => {
  mockRole.parent = false;
  history.replaceState(null, '', `/login?returnTo=${encodeURIComponent(destination)}`);
  expect(await landing()).toBe('/dashboard');
});

test('a parent with children still to register is taken back to that step', async () => {
  getOnboardingContext.mockResolvedValue({ data: { onboarding_pending: true } });

  expect(await landing()).toBe('/parent-onboarding');
  expect(window.location.pathname).toBe('/parent-onboarding');
});

test('a parent who has finished lands on the dashboard', async () => {
  getOnboardingContext.mockResolvedValue({ data: { onboarding_pending: false } });

  expect(await landing()).toBe('/parent-dashboard');
});

test('if the check fails, signing in still lands on the dashboard', async () => {
  getOnboardingContext.mockRejectedValue(new Error('offline'));

  expect(await landing()).toBe('/parent-dashboard');
});

test('staff are not asked about onboarding at all', async () => {
  mockRole.parent = false;

  expect(await landing()).toBe('/dashboard');
  expect(getOnboardingContext).not.toHaveBeenCalled();
});

test('a parent role without the permission is not asked either', async () => {
  mockRole.permissions = new Set();

  expect(await landing()).toBe('/parent-dashboard');
  expect(getOnboardingContext).not.toHaveBeenCalled();
});
