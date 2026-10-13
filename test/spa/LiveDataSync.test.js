/**
 * @jest-environment jsdom
 *
 * Redrawing a screen when its data changed elsewhere.
 *
 * Live sync redraws the screen on display by routing to it again, and the
 * router rebuilds it from its loading state. Shown as is, the screen went
 * blank for a moment at every redraw (each socket reconnection triggers one).
 * The redraw now runs inside a view transition, where the browser keeps the
 * current screen on display until the refreshed one is drawn.
 */

const REDRAW_DEBOUNCE_MS = 1500;

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

const mockRoute = jest.fn();
jest.mock('../../spa/app.js', () => ({
  app: { router: { route: (...args) => mockRoute(...args) } },
  translate: (key) => key,
}));

import { liveDataSync } from '../../spa/modules/live-sync/LiveDataSync.js';
import { notePageRequestPath, resetPageReads } from '../../spa/modules/live-sync/LiveSyncState.js';

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

  test('the screen is redrawn inside a view transition, so the old one stays until the new one is drawn', async () => {
    const shownWhenTransitionStarted = [];
    document.startViewTransition = jest.fn((update) => {
      shownWhenTransitionStarted.push(document.getElementById('app').textContent);
      const updateCallbackDone = Promise.resolve().then(update);
      return {
        updateCallbackDone,
        ready: updateCallbackDone,
        finished: updateCallbackDone,
      };
    });

    await pointsChangedElsewhere();

    expect(document.startViewTransition).toHaveBeenCalledTimes(1);
    // Nothing was redrawn before the browser captured the current screen.
    expect(shownWhenTransitionStarted).toEqual(['12 points']);
    expect(mockRoute).toHaveBeenCalledWith('/');
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
