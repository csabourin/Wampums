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
 * again.
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

function fakeSubscription(endpoint, keyBytes) {
  return {
    endpoint,
    options: { applicationServerKey: new Uint8Array(keyBytes).buffer },
    unsubscribe: jest.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
  };
}

function installPushManager(existing) {
  const fresh = fakeSubscription('https://push.example.test/new', SERVER_KEY_BYTES);
  const pushManager = {
    getSubscription: jest.fn().mockResolvedValue(existing),
    subscribe: jest.fn().mockResolvedValue(fresh),
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
    const pushManager = installPushManager(existing);

    await registerPushSubscription();

    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(savedEndpoint()).toBe('https://push.example.test/kept');
  });

  test('a browser subscribed with another key is subscribed again with the server key', async () => {
    const existing = fakeSubscription('https://push.example.test/stale', OTHER_KEY_BYTES);
    const pushManager = installPushManager(existing);

    await registerPushSubscription();

    expect(existing.unsubscribe).toHaveBeenCalled();
    const { applicationServerKey } = pushManager.subscribe.mock.calls[0][0];
    expect(Array.from(applicationServerKey)).toEqual(SERVER_KEY_BYTES);
    expect(savedEndpoint()).toBe('https://push.example.test/new');
  });

  test('without the server key, the built-in key is used', async () => {
    makeApiRequest.mockImplementation((endpoint) => (
      endpoint === 'v1/notifications/vapid-public-key' ? Promise.reject(new Error('503')) : Promise.resolve({ success: true })
    ));
    const pushManager = installPushManager(null);

    await registerPushSubscription();

    const { applicationServerKey } = pushManager.subscribe.mock.calls[0][0];
    expect(Array.from(applicationServerKey)).toEqual(OTHER_KEY_BYTES);
  });
});
