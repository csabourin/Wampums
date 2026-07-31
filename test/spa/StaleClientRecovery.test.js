describe('StaleClientRecovery chunk error safeguards', () => {
  let installChunkErrorRecovery;
  let listeners;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    listeners = {};

    global.fetch = jest.fn();
    global.window = {
      addEventListener: jest.fn((type, handler) => {
        listeners[type] = handler;
      }),
      location: {
        origin: 'http://localhost:3000',
        reload: jest.fn(),
      },
    };
    global.localStorage = {
      store: new Map(),
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null;
      },
      setItem(key, value) {
        this.store.set(key, String(value));
      },
      clear() {
        this.store.clear();
      },
    };
    global.sessionStorage = {
      store: new Map(),
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null;
      },
      setItem(key, value) {
        this.store.set(key, String(value));
      },
      clear() {
        this.store.clear();
      },
    };
    global.navigator = {
      onLine: true,
      serviceWorker: {
        getRegistrations: jest.fn().mockResolvedValue([]),
      },
    };
    global.caches = {
      keys: jest.fn().mockResolvedValue(['shell-cache']),
      delete: jest.fn().mockResolvedValue(true),
    };

    jest.doMock('../../spa/config.js', () => ({
      CONFIG: {
        API_BASE_URL: 'http://localhost:3000',
        VERSION: '3.1.0',
      },
    }));
    jest.doMock('../../spa/utils/DebugUtils.js', () => ({
      debugLog: jest.fn(),
      debugError: jest.fn(),
      debugWarn: jest.fn(),
    }));

    ({ installChunkErrorRecovery } = require('../../spa/modules/app-recovery/StaleClientRecovery.js'));
    installChunkErrorRecovery();
  });

  async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  test('does not purge caches for transient chunk errors when the version probe fails', async () => {
    fetch.mockRejectedValue(new Error('offline'));

    listeners.unhandledrejection({
      reason: new Error('Failed to fetch dynamically imported module'),
    });
    await flushAsyncWork();

    expect(caches.keys).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  test('purges caches after a chunk error only when the server build changed', async () => {
    localStorage.setItem('wampums.client.buildId', 'old-build');
    fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
          version: '3.1.0',
          build_id: 'new-build',
        },
      }),
    });

    listeners.unhandledrejection({
      reason: new Error('Failed to fetch dynamically imported module'),
    });
    await flushAsyncWork();

    expect(caches.keys).toHaveBeenCalledTimes(1);
    expect(caches.delete).toHaveBeenCalledWith('shell-cache');
    expect(window.location.reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('wampums.client.buildId')).toBe('new-build');
  });
});
