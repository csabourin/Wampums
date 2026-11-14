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

  test('a new deploy does not delete the installed app when a service worker controls the page', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    navigator.serviceWorker.controller = {};
    navigator.serviceWorker.getRegistration = jest.fn().mockResolvedValue({ update });
    localStorage.setItem('wampums.client.buildId', 'old-build');
    fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { version: '3.1.0', build_id: 'new-build' } }),
    });
    const { checkForStaleClient } = require('../../spa/modules/app-recovery/StaleClientRecovery.js');

    await expect(checkForStaleClient()).resolves.toBe(false);

    expect(update).toHaveBeenCalledTimes(1);
    expect(navigator.serviceWorker.getRegistrations).not.toHaveBeenCalled();
    expect(caches.delete).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
    // Not yet running the new build: the old id stays, so a missing chunk is still recovered.
    expect(localStorage.getItem('wampums.client.buildId')).toBe('old-build');
  });

  test('a missing chunk after a deferred update is still recovered', async () => {
    navigator.serviceWorker.controller = {};
    navigator.serviceWorker.getRegistration = jest.fn().mockResolvedValue({ update: jest.fn().mockResolvedValue() });
    localStorage.setItem('wampums.client.buildId', 'old-build');
    fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { version: '3.1.0', build_id: 'new-build' } }),
    });
    const { checkForStaleClient } = require('../../spa/modules/app-recovery/StaleClientRecovery.js');
    await checkForStaleClient();

    listeners.unhandledrejection({ reason: new Error('Failed to fetch dynamically imported module') });
    await flushAsyncWork();

    expect(caches.delete).toHaveBeenCalledWith('shell-cache');
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  describe('judged by the entry script this page loaded', () => {
    const entry = (src) => {
      global.document = { querySelector: () => ({ getAttribute: () => src }) };
    };
    const serverAnswers = (data) => fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue({ data }) });
    afterEach(() => { delete global.document; });

    test('a page already running the deployed build only records it', async () => {
      entry('/assets/main-new.js');
      localStorage.setItem('wampums.client.buildId', 'old-build');
      serverAnswers({ build_id: 'new-build', entry: '/assets/main-new.js' });
      const { checkForStaleClient } = require('../../spa/modules/app-recovery/StaleClientRecovery.js');

      await expect(checkForStaleClient()).resolves.toBe(false);
      expect(localStorage.getItem('wampums.client.buildId')).toBe('new-build');
      expect(caches.delete).not.toHaveBeenCalled();
    });

    test('a missing chunk on the deployed build is a network hiccup, not a stale client', async () => {
      entry('/assets/main-new.js');
      localStorage.setItem('wampums.client.buildId', 'old-build');
      serverAnswers({ build_id: 'new-build', entry: '/assets/main-new.js' });

      listeners.unhandledrejection({ reason: new Error('Failed to fetch dynamically imported module') });
      await flushAsyncWork();

      expect(caches.delete).not.toHaveBeenCalled();
      expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('a missing chunk on an older build is recovered even when the remembered id already matches', async () => {
      entry('/assets/main-old.js');
      localStorage.setItem('wampums.client.buildId', 'new-build');
      serverAnswers({ build_id: 'new-build', entry: '/assets/main-new.js' });

      listeners.unhandledrejection({ reason: new Error('Failed to fetch dynamically imported module') });
      await flushAsyncWork();

      expect(window.location.reload).toHaveBeenCalledTimes(1);
    });

    test('a forced refresh already applied does not purge again on a later chunk hiccup', async () => {
      entry('/assets/main-new.js');
      localStorage.setItem('wampums.client.buildId', 'force-token');
      serverAnswers({ build_id: 'force-token', entry: '/assets/main-new.js', forced: true });

      listeners.unhandledrejection({ reason: new Error('Failed to fetch dynamically imported module') });
      await flushAsyncWork();

      expect(caches.delete).not.toHaveBeenCalled();
      expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('a forced refresh not yet applied purges on a chunk error, even on the current build', async () => {
      entry('/assets/main-new.js');
      localStorage.setItem('wampums.client.buildId', 'new-build');
      serverAnswers({ build_id: 'force-token', entry: '/assets/main-new.js', forced: true });

      listeners.unhandledrejection({ reason: new Error('Failed to fetch dynamically imported module') });
      await flushAsyncWork();

      expect(window.location.reload).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('wampums.client.buildId')).toBe('force-token');
    });

    test('an operator-forced refresh still purges and reloads every client', async () => {
      entry('/assets/main-new.js');
      navigator.serviceWorker.controller = {};
      navigator.serviceWorker.getRegistration = jest.fn().mockResolvedValue({ update: jest.fn() });
      localStorage.setItem('wampums.client.buildId', 'new-build');
      serverAnswers({ build_id: 'force-token', entry: '/assets/main-new.js', forced: true });
      const { checkForStaleClient } = require('../../spa/modules/app-recovery/StaleClientRecovery.js');

      await expect(checkForStaleClient()).resolves.toBe(true);
      expect(window.location.reload).toHaveBeenCalledTimes(1);
    });
  });

  test('a new deploy still purges and reloads a page no service worker controls', async () => {
    localStorage.setItem('wampums.client.buildId', 'old-build');
    fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { version: '3.1.0', build_id: 'new-build' } }),
    });
    const { checkForStaleClient } = require('../../spa/modules/app-recovery/StaleClientRecovery.js');

    await expect(checkForStaleClient()).resolves.toBe(true);

    expect(caches.delete).toHaveBeenCalledWith('shell-cache');
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});
