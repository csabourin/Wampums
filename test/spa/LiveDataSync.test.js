/**
 * @jest-environment jsdom
 *
 * Redrawing a screen when its data changed elsewhere.
 *
 * Live sync redraws the screen on display by routing to it again, and the
 * router rebuilds it from its loading state. Shown as is, the screen went
 * blank for a moment at every redraw (each socket reconnection triggers one).
 * The screen's data is now fetched again first, then the redraw runs inside a
 * view transition, where the browser keeps the current screen on display until
 * the refreshed one is drawn. The page ignores taps during a transition, so the
 * transition holds only briefly and never spans a network round trip.
 */

const REDRAW_DEBOUNCE_MS = 1500;
const MAX_TRANSITION_HOLD_MS = 300;
const SLOW_SCREEN_MS = 2000;

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: { API_BASE_URL: 'http://localhost' },
}));

jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: { isOffline: false, campMode: false },
}));

jest.mock('../../spa/utils/CacheInvalidation.js', () => ({
  invalidateForWrite: jest.fn(() => Promise.resolve({ deletedKeys: [], matchesPath: () => true })),
  applyInvalidation: jest.fn(() => Promise.resolve({ deletedKeys: [], matchesPath: () => true })),
  planFullRefresh: jest.fn(() => ({})),
}));

const mockSocketHandlers = {};
const mockSocket = {
  id: 'socket-1',
  connected: true,
  on: (event, handler) => {
    mockSocketHandlers[event] = handler;
  },
  connect: jest.fn(),
  disconnect() {
    return this;
  },
};

jest.mock('../../spa/utils/SocketIOClient.js', () => ({
  loadSocketIOClient: () => Promise.resolve(() => mockSocket),
}));

const mockApiGet = jest.fn();
jest.mock('../../spa/api/api-core.js', () => ({
  makeApiRequestWithCache: (...args) => mockApiGet(...args),
}));

const mockRoute = jest.fn();
jest.mock('../../spa/app.js', () => ({
  app: { router: { route: (...args) => mockRoute(...args) } },
  translate: (key) => key,
}));

import { liveDataSync } from '../../spa/modules/live-sync/LiveDataSync.js';
import {
  notePageCachedRequest,
  notePageRequestPath,
  notePageUncachedRead,
  noteWriteSettled,
  noteWriteStarted,
  resetPageReads,
} from '../../spa/modules/live-sync/LiveSyncState.js';

/**
 * The screen on display, as the router would draw it after loading its data.
 * @param {string} text - What the screen shows
 */
function drawScreen(text) {
  document.getElementById('app').textContent = text;
}

/**
 * Another session writes points the screen on display was built from.
 * @returns {Promise<void>}
 */
async function pointsChangedElsewhere() {
  await mockSocketHandlers['data-changed']({ path: '/api/v1/points' });
  await jest.advanceTimersByTimeAsync(REDRAW_DEBOUNCE_MS);
}

describe('live sync redraw', () => {
  beforeAll(async () => {
    localStorage.setItem('jwtToken', 'token');
    await liveDataSync.start();
  });

  afterAll(() => {
    liveDataSync.stop();
  });

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<main id="app"></main>';
    drawScreen('12 points');
    resetPageReads();
    notePageRequestPath('/api/v1/points');
    notePageCachedRequest('points_group_3', 'v1/points', { params: { group: 3 } }, { cacheDuration: 60000 });
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    mockRoute.mockReset();
    // The router shows its loading state, then the refreshed screen.
    mockRoute.mockImplementation(async () => {
      drawScreen('loading');
      await Promise.resolve();
      drawScreen('15 points');
    });
  });

  afterEach(() => {
    delete document.startViewTransition;
    jest.useRealTimers();
  });

  /**
   * A browser's view transition: runs the update and reports when the update
   * callback has settled, recording what was on screen when it started.
   * @returns {{ shownAtStart: string[], callbackSettledAt: number[] }}
   */
  function fakeViewTransitions() {
    const log = { shownAtStart: [], callbackSettledAt: [] };
    document.startViewTransition = jest.fn((update) => {
      log.shownAtStart.push(document.getElementById('app').textContent);
      const updateCallbackDone = Promise.resolve().then(update);
      updateCallbackDone.then(() => log.callbackSettledAt.push(Date.now()));
      return { updateCallbackDone, ready: updateCallbackDone, finished: updateCallbackDone };
    });
    return log;
  }

  test('the screen\'s data is fetched again before the redraw, so the redraw reads the cache', async () => {
    const order = [];
    mockApiGet.mockImplementation(() => {
      order.push('refetch');
      return Promise.resolve({ success: true });
    });
    mockRoute.mockImplementation(() => {
      order.push('redraw');
      return Promise.resolve();
    });

    await pointsChangedElsewhere();

    expect(mockApiGet).toHaveBeenCalledWith(
      'v1/points',
      { params: { group: 3 } },
      { cacheDuration: 60000, forceRefresh: true, isCurrent: expect.any(Function) },
    );
    expect(order).toEqual(['refetch', 'redraw']);
  });

  test('a refetch answered after the page asked again with another filter is not stored', async () => {
    let replayIsCurrent = null;
    mockApiGet.mockImplementation((endpoint, options, cacheOptions) => {
      // The person changes the filter while the refetch is in flight.
      notePageCachedRequest('points_group_3', 'v1/points', { params: { group: 4 } }, { cacheDuration: 60000 });
      replayIsCurrent = cacheOptions.isCurrent();
      return Promise.resolve({ success: true });
    });

    await pointsChangedElsewhere();

    expect(replayIsCurrent).toBe(false);
  });

  test('a failed refetch still redraws, leaving the screen to report the error', async () => {
    mockApiGet.mockRejectedValue(new Error('offline'));

    await pointsChangedElsewhere();

    expect(mockRoute).toHaveBeenCalledTimes(1);
  });

  test('the view transition holds the old screen briefly at most, even when the screen is slow to draw', async () => {
    const log = fakeViewTransitions();
    mockRoute.mockImplementation(async () => {
      drawScreen('loading');
      await new Promise((resolve) => setTimeout(resolve, SLOW_SCREEN_MS));
      drawScreen('15 points');
    });
    const start = Date.now();

    await pointsChangedElsewhere();
    await jest.advanceTimersByTimeAsync(SLOW_SCREEN_MS);

    expect(log.callbackSettledAt).toHaveLength(1);
    expect(log.callbackSettledAt[0] - start).toBeLessThanOrEqual(REDRAW_DEBOUNCE_MS + MAX_TRANSITION_HOLD_MS);
    expect(document.getElementById('app').textContent).toBe('15 points');
  });

  test('the screen is not redrawn when the person starts typing while its data loads', async () => {
    fakeViewTransitions();
    mockApiGet.mockImplementation(() => {
      document.getElementById('app').insertAdjacentHTML('beforeend', '<input id="live-sync-test-field">');
      document.getElementById('live-sync-test-field').focus();
      return Promise.resolve({ success: true });
    });

    await pointsChangedElsewhere();

    expect(mockApiGet).toHaveBeenCalled();
    expect(mockRoute).not.toHaveBeenCalled();
  });

  test('the screen is redrawn inside a view transition, so the old one stays until the new one is drawn', async () => {
    const log = fakeViewTransitions();

    await pointsChangedElsewhere();

    expect(document.startViewTransition).toHaveBeenCalledTimes(1);
    // Nothing was redrawn before the browser captured the current screen.
    expect(log.shownAtStart).toEqual(['12 points']);
    expect(mockRoute).toHaveBeenCalledWith('/', { refresh: true });
    expect(document.getElementById('app').textContent).toBe('15 points');
  });

  test('a screen that reads data no cache keeps is redrawn without a transition, which would freeze it during the read', async () => {
    fakeViewTransitions();
    notePageUncachedRead();

    await pointsChangedElsewhere();

    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(mockRoute).toHaveBeenCalledTimes(1);
    expect(document.getElementById('app').textContent).toBe('15 points');
  });

  test('a browser without view transitions still redraws the screen', async () => {
    await pointsChangedElsewhere();

    expect(mockRoute).toHaveBeenCalledTimes(1);
    expect(document.getElementById('app').textContent).toBe('15 points');
  });

  test('a transition the browser skips still leaves the refreshed screen, without an error', async () => {
    document.startViewTransition = jest.fn((update) => {
      const skipped = Promise.reject(new DOMException('Skipped', 'AbortError'));
      return {
        updateCallbackDone: Promise.resolve().then(update),
        ready: skipped,
        finished: skipped,
      };
    });

    await pointsChangedElsewhere();

    expect(document.getElementById('app').textContent).toBe('15 points');
  });

  test('the screen is not redrawn while the person is typing in it', async () => {
    document.startViewTransition = jest.fn();
    document.getElementById('app').insertAdjacentHTML('beforeend', '<input id="live-sync-test-field">');
    document.getElementById('live-sync-test-field').focus();

    await pointsChangedElsewhere();

    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(mockRoute).not.toHaveBeenCalled();
  });
});

describe('returning from the background', () => {
  const { applyInvalidation } = jest.requireMock('../../spa/utils/CacheInvalidation.js');
  const { offlineManager } = jest.requireMock('../../spa/modules/OfflineManager.js');
  const SYNC_STATE_WAIT_MS = 3000;
  const SETTLE_MS = SYNC_STATE_WAIT_MS + REDRAW_DEBOUNCE_MS;
  const state = (overrides = {}) => ({ run: 'run-1', org: '12', version: 5, shared: 0, ...overrides });

  /**
   * The socket connects, as when the app opens, and hears the server's state.
   * @param {Object} [syncState] - State the server sends
   */
  async function connect(syncState = state()) {
    mockSocketHandlers.connect();
    if (syncState) {
      mockSocketHandlers['sync-state'](syncState);
    }
    await jest.advanceTimersByTimeAsync(SETTLE_MS);
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    document.body.innerHTML = '<main id="app"></main>';
    drawScreen('12 points');
    resetPageReads();
    notePageRequestPath('/api/v1/points');
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ success: true });
    mockRoute.mockReset();
    mockRoute.mockResolvedValue();
    offlineManager.isOffline = false;
    localStorage.setItem('jwtToken', 'token');
    liveDataSync.stop();
    await liveDataSync.start();
    await connect();
    applyInvalidation.mockClear();
  });

  afterEach(() => {
    liveDataSync.stop();
    jest.useRealTimers();
  });

  test('when nothing changed while away, the screen is left as it is', async () => {
    await connect(state());

    expect(applyInvalidation).not.toHaveBeenCalled();
    expect(mockRoute).not.toHaveBeenCalled();
  });

  test('a change announced while away is caught up and the screen redrawn', async () => {
    await connect(state({ version: 6 }));

    expect(applyInvalidation).toHaveBeenCalledTimes(1);
    expect(mockRoute).toHaveBeenCalledTimes(1);
  });

  test('a restarted server, or another unit, is caught up', async () => {
    await connect(state({ run: 'run-2' }));
    await connect(state({ run: 'run-2', org: '13' }));

    expect(applyInvalidation).toHaveBeenCalledTimes(2);
  });

  test('a write no unit was named for (a public page) is caught up', async () => {
    await connect(state({ shared: 1 }));

    expect(applyInvalidation).toHaveBeenCalledTimes(1);
  });

  test('an own write acknowledged while a shared write happened leaves the shared one to catch up', async () => {
    noteWriteStarted();
    mockSocketHandlers['sync-state'](state({ version: 6, shared: 1 }));
    noteWriteSettled(true);

    await connect(state({ version: 6, shared: 1 }));

    expect(applyInvalidation).toHaveBeenCalledTimes(1);
  });

  test('a server that sends no state is caught up after a short wait', async () => {
    await connect(null);

    expect(applyInvalidation).toHaveBeenCalledTimes(1);
  });

  test('a change already seen while connected is not caught up again', async () => {
    await mockSocketHandlers['data-changed']({ path: '/api/v1/points', version: 6 });
    // The session's own write: the server tells it the unit's new version.
    mockSocketHandlers['sync-state'](state({ version: 7 }));
    await jest.advanceTimersByTimeAsync(SETTLE_MS);
    mockRoute.mockClear();

    await connect(state({ version: 7 }));

    expect(applyInvalidation).not.toHaveBeenCalled();
    expect(mockRoute).not.toHaveBeenCalled();
  });

  test('a change ignored while offline is caught up on reconnection', async () => {
    offlineManager.isOffline = true;
    await mockSocketHandlers['data-changed']({ path: '/api/v1/points', version: 6 });
    offlineManager.isOffline = false;

    await connect(state({ version: 6 }));

    expect(applyInvalidation).toHaveBeenCalledTimes(1);
  });

  test('a malformed state is ignored, and the reconnection caught up', async () => {
    await connect({ run: 'run-1', org: 12, version: '5', shared: 0 });

    expect(applyInvalidation).toHaveBeenCalledTimes(1);
  });

  test('a change found while in camp mode is caught up on the next reconnection', async () => {
    offlineManager.isOffline = true;
    await connect(state({ version: 6 }));
    offlineManager.isOffline = false;
    expect(applyInvalidation).not.toHaveBeenCalled();

    await connect(state({ version: 6 }));

    expect(applyInvalidation).toHaveBeenCalledTimes(1);
  });

  test('a catch-up that failed is tried again on the next reconnection', async () => {
    applyInvalidation.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    await connect(state({ version: 6 }));

    await connect(state({ version: 6 }));

    expect(applyInvalidation).toHaveBeenCalledTimes(2);
  });

  test('the server telling of an own write is counted once its response is handled', async () => {
    noteWriteStarted();
    mockSocketHandlers['sync-state'](state({ version: 6 }));
    noteWriteSettled(true);

    await connect(state({ version: 6 }));

    expect(applyInvalidation).not.toHaveBeenCalled();
  });

  test('an own write whose response was lost leaves the reconnection to catch up', async () => {
    noteWriteStarted();
    mockSocketHandlers['sync-state'](state({ version: 6 }));
    // The network dropped before the response arrived: nothing was invalidated.
    noteWriteSettled(false);

    await connect(state({ version: 6 }));

    expect(applyInvalidation).toHaveBeenCalledTimes(1);
  });

  test('a change that skips a version is not counted, so the missing one is caught up', async () => {
    await mockSocketHandlers['data-changed']({ path: '/api/v1/points', version: 7 });
    await jest.advanceTimersByTimeAsync(SETTLE_MS);

    await connect(state({ version: 7 }));

    expect(applyInvalidation).toHaveBeenCalledTimes(1);
  });

  test('a state arriving after the wait is counted once the catch-up it outlasted succeeds', async () => {
    await connect(null);
    mockSocketHandlers['sync-state'](state({ version: 6 }));
    await jest.advanceTimersByTimeAsync(SETTLE_MS);
    applyInvalidation.mockClear();

    await connect(state({ version: 6 }));

    expect(applyInvalidation).not.toHaveBeenCalled();
  });

  test('a state arriving after a catch-up that failed is not counted', async () => {
    applyInvalidation.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    await connect(null);
    mockSocketHandlers['sync-state'](state({ version: 6 }));
    await jest.advanceTimersByTimeAsync(SETTLE_MS);
    applyInvalidation.mockClear();

    await connect(state({ version: 6 }));

    expect(applyInvalidation).toHaveBeenCalledTimes(1);
  });
});
