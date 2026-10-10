/**
 * @jest-environment jsdom
 */

/**
 * Browser push subscription.
 *
 * The browser subscribes with the key the server signs with, fetched from the
 * server. A browser already subscribed with that key keeps its endpoint (no
 * new line in the recipient list); one subscribed with another key, which
 * could never receive this server's pushes, is unsubscribed and subscribed
 * again, including on browsers that hide the key of a subscription. When the
 * server cannot be asked, an existing subscription is never replaced on a
 * guess.
 *
 * @module test/spa/PushSubscription
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: { PUSH_NOTIFICATIONS: { VAPID_PUBLIC_KEY: 'AQID' } },
}));

jest.mock('../../spa/api/api-core.js', () => ({ makeApiRequest: jest.fn() }));

const { makeApiRequest } = require('../../spa/api/api-core.js');
const { registerPushSubscription } = require('../../spa/modules/push/PushSubscription.js');

// "BAUG" is base64url for the bytes 4, 5, 6; "AQID" for 1, 2, 3.
const SERVER_KEY = 'BAUG';
const SERVER_KEY_BYTES = [4, 5, 6];
const OTHER_KEY_BYTES = [1, 2, 3];

function fakeSubscription(endpoint, keyBytes, { hidesKey = false } = {}) {
  return {
    endpoint,
    keyBytes,
    options: { applicationServerKey: hidesKey ? null : new Uint8Array(keyBytes).buffer },
    unsubscribe: jest.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
  };
}

function installPushManager(existing, { refuseNewKey = false } = {}) {
  const fresh = fakeSubscription('https://push.example.test/new', SERVER_KEY_BYTES);
  let current = existing;
  const pushManager = {
    getSubscription: jest.fn().mockResolvedValue(existing),
    // Like browsers: the same key returns the current subscription, another
    // key is refused while one exists.
    subscribe: jest.fn(({ applicationServerKey }) => {
      if (current && !current.unsubscribe.mock.calls.length) {
        const sameKey = Array.from(new Uint8Array(current.keyBytes)).join() === Array.from(applicationServerKey).join();
        if (sameKey && !refuseNewKey) {
          return Promise.resolve(current);
        }
        return Promise.reject(Object.assign(new Error('different key'), { name: 'InvalidStateError' }));
      }
      current = fresh;
      return Promise.resolve(fresh);
    }),
  };
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  window.PushManager = function PushManager() {};
  return pushManager;
}

const savedEndpoint = () => makeApiRequest.mock.calls
  .find(([endpoint]) => endpoint === 'v1/notifications/subscription')?.[1].body.endpoint;

describe('Push subscription', () => {
  beforeEach(() => {
    makeApiRequest.mockReset();
    makeApiRequest.mockImplementation((endpoint) => Promise.resolve(
      endpoint === 'v1/notifications/vapid-public-key' ? { success: true, data: { publicKey: SERVER_KEY } } : { success: true }
    ));
  });

  test('a browser already subscribed with the server key keeps its endpoint', async () => {
    const existing = fakeSubscription('https://push.example.test/kept', SERVER_KEY_BYTES);
    installPushManager(existing);

    await registerPushSubscription();

    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(savedEndpoint()).toBe('https://push.example.test/kept');
  });

  test('a browser subscribed with another key is subscribed again with the server key', async () => {
    const existing = fakeSubscription('https://push.example.test/stale', OTHER_KEY_BYTES);
    const pushManager = installPushManager(existing);

    await registerPushSubscription();

    expect(existing.unsubscribe).toHaveBeenCalled();
    const { applicationServerKey } = pushManager.subscribe.mock.calls.at(-1)[0];
    expect(Array.from(applicationServerKey)).toEqual(SERVER_KEY_BYTES);
    expect(savedEndpoint()).toBe('https://push.example.test/new');
  });

  test('a browser that hides the key of its subscription is still moved to the server key', async () => {
    const existing = fakeSubscription('https://push.example.test/hidden', OTHER_KEY_BYTES, { hidesKey: true });
    installPushManager(existing);

    await registerPushSubscription();

    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(savedEndpoint()).toBe('https://push.example.test/new');
  });

  test('a browser that hides a matching key keeps its endpoint', async () => {
    const existing = fakeSubscription('https://push.example.test/hidden-kept', SERVER_KEY_BYTES, { hidesKey: true });
    installPushManager(existing);

    await registerPushSubscription();

    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(savedEndpoint()).toBe('https://push.example.test/hidden-kept');
  });

  test('when the server cannot be asked, an existing subscription is kept and re-registered', async () => {
    makeApiRequest.mockImplementation((endpoint) => (
      endpoint === 'v1/notifications/vapid-public-key' ? Promise.reject(new Error('503')) : Promise.resolve({ success: true })
    ));
    const existing = fakeSubscription('https://push.example.test/offline', SERVER_KEY_BYTES);
    const pushManager = installPushManager(existing);

    await registerPushSubscription();

    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(savedEndpoint()).toBe('https://push.example.test/offline');
  });

  test('when the server cannot be asked and nothing is subscribed, the built-in key is used', async () => {
    makeApiRequest.mockImplementation((endpoint) => (
      endpoint === 'v1/notifications/vapid-public-key' ? Promise.reject(new Error('503')) : Promise.resolve({ success: true })
    ));
    const pushManager = installPushManager(null);

    await registerPushSubscription();

    const { applicationServerKey } = pushManager.subscribe.mock.calls[0][0];
    expect(Array.from(applicationServerKey)).toEqual(OTHER_KEY_BYTES);
  });

  test('a refused subscription is logged, not thrown', async () => {
    const existing = fakeSubscription('https://push.example.test/stuck', SERVER_KEY_BYTES);
    const pushManager = installPushManager(existing, { refuseNewKey: true });
    existing.unsubscribe.mockRejectedValue(new Error('cannot unsubscribe'));

    await expect(registerPushSubscription()).resolves.toBeUndefined();
    expect(pushManager.subscribe).toHaveBeenCalled();
    expect(savedEndpoint()).toBeUndefined();
  });
});
