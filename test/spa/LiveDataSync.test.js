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
      { cacheDuration: 60000, forceRefresh: true },
    );
    expect(order).toEqual(['refetch', 'redraw']);
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
    expect(mockRoute).toHaveBeenCalledWith('/');
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
