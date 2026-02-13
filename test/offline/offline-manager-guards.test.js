'use strict';

const { indexedDB, IDBKeyRange } = require('fake-indexeddb');

global.indexedDB = indexedDB;
global.IDBKeyRange = IDBKeyRange;

describe('OfflineManager guardrails', () => {
  let OfflineManager;

  beforeEach(async () => {
    jest.resetModules();

    global.window = global.window || {
      dispatchEvent: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { origin: 'http://localhost:3000' },
    };

    global.document = global.document || {
      hidden: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    global.localStorage = global.localStorage || {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };

    global.navigator = {
      onLine: true,
      serviceWorker: {
        controller: { postMessage: jest.fn() },
        ready: Promise.resolve({
          sync: { register: jest.fn().mockResolvedValue(undefined) },
        }),
      },
    };

    global.CustomEvent = global.CustomEvent || class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    };

    jest.doMock('../../spa/utils/DebugUtils.js', () => ({
      debugLog: jest.fn(),
      debugWarn: jest.fn(),
      debugError: jest.fn(),
    }));

    jest.doMock('../../spa/config.js', () => ({
      CONFIG: {
        UI: { SYNC_TIMEOUT: 1, SW_PENDING_TIMEOUT: 1 },
        API_BASE_URL: 'http://localhost:3000',
      },
    }));

    ({ OfflineManager } = require('../../spa/modules/OfflineManager.js'));
  });

  test('handleReadOperation skips caching for non-JSON 200 responses', async () => {
    const manager = new OfflineManager();
    const cacheSpy = jest.spyOn(manager, 'cacheData').mockResolvedValue(undefined);

    const response = {
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      clone: jest.fn(() => ({ json: jest.fn() })),
    };

    global.fetch = jest.fn().mockResolvedValue(response);

    const result = await manager.handleReadOperation('/api/v1/participants', {}, 1000);

    expect(result).toBe(response);
    expect(response.clone).not.toHaveBeenCalled();
    expect(cacheSpy).not.toHaveBeenCalled();
  });

  test('syncPendingData defers direct replay when service worker sync is available', async () => {
    const manager = new OfflineManager();

    const replaySpy = jest.spyOn(manager, 'replayPendingMutations').mockResolvedValue(undefined);
    jest.spyOn(manager, 'updatePendingCount').mockResolvedValue(undefined);

    await manager.syncPendingData();

    expect(replaySpy).not.toHaveBeenCalled();
  });
});
