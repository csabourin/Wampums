/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"http://localhost:3000/"}
 *
 * User stories: offline manager (spa/modules/OfflineManager.js) with the real
 * IndexedDB queue (fake-indexeddb).
 *
 * Implements: US-OFF-001, US-OFF-002, US-OFF-003, US-OFF-004, US-OFF-005,
 *             US-OFF-007
 */

'use strict';

require('fake-indexeddb/auto');
const { IDBFactory } = require('fake-indexeddb');

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  debugError: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    API_BASE_URL: 'http://localhost:3000',
    CACHE_DURATION: { SHORT: 60000, MEDIUM: 300000 },
    UI: { SYNC_TIMEOUT: 1 }
  },
  getStorageKey: (key) => key
}));

// Minimal Response for the jsdom environment (matches test/offline pattern)
if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(body, init = {}) {
      this._body = body;
      this.status = init.status || 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = {
        map: new Map(Object.entries(init.headers || {})),
        get(name) { return this.map.get(name) || null; }
      };
    }

    async json() { return JSON.parse(this._body); }

    async text() { return this._body; }

    clone() {
      return new global.Response(this._body, {
        status: this.status,
        headers: Object.fromEntries(this.headers.map)
      });
    }
  };
}

const { OfflineManager } = require('../../spa/modules/OfflineManager.js');
const { saveOfflineData, getOfflineData, setCachedData } = require('../../spa/indexedDB.js');
const { flushPromises } = require('./helpers/story-helpers');

function makeJsonResponse(data, { status = 200 } = {}) {
  return new global.Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function captureWindowEvents(eventName) {
  const seen = [];
  const handler = (event) => seen.push(event.detail);
  window.addEventListener(eventName, handler);
  return { seen, stop: () => window.removeEventListener(eventName, handler) };
}

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  localStorage.clear();
  localStorage.setItem('userId', 'leader-1');
  localStorage.setItem('currentOrganizationId', '1');
  localStorage.setItem('jwtToken', 'queued-session-token');
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('US-OFF-001 — Saving offline says "saved locally", not "error"', () => {
  it('returns a 202 queued envelope and stores the mutation in IndexedDB', async () => {
    const manager = new OfflineManager();
    manager.isOffline = true;

    const response = await manager.fetchWithOfflineSupport(
      'http://localhost:3000/api/v1/attendance',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: 1, date: '2026-07-15', status: 'present' })
      }
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, queued: true });
    expect(body.message).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();

    const queued = await getOfflineData();
    expect(queued).toHaveLength(1);
    expect(queued[0].data.url).toBe('http://localhost:3000/api/v1/attendance');
    expect(JSON.parse(queued[0].data.body)).toMatchObject({ participant_id: 1, status: 'present' });
    expect(queued[0].data.headers.Authorization).toBeUndefined();
  });

  it('keeps additive point awards online-only', async () => {
    const manager = new OfflineManager();
    manager.isOffline = true;

    await expect(manager.fetchWithOfflineSupport(
      'http://localhost:3000/api/v1/points',
      { method: 'POST', body: JSON.stringify([{ id: 1, points: 5 }]) },
    )).rejects.toThrow('internet connection');
    expect(await getOfflineData()).toHaveLength(0);
  });

  it('performs the write normally while online', async () => {
    const manager = new OfflineManager();
    manager.isOffline = false;
    global.fetch.mockResolvedValue(makeJsonResponse({ success: true }));

    await manager.fetchWithOfflineSupport('http://localhost:3000/api/v1/points', { method: 'POST' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await getOfflineData()).toHaveLength(0);
  });
});

describe('US-OFF-002 — Reconnecting syncs my queue safely', () => {
  async function queueOne(manager) {
    manager.isOffline = true;
    await manager.queueMutation('http://localhost:3000/api/v1/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_id: 1, date: '2026-07-15', status: 'present' })
    });
  }

  it('replays with a fresh Authorization header and deletes the record on success', async () => {
    const manager = new OfflineManager();
    await queueOne(manager);
    localStorage.setItem('jwtToken', 'fresh-token');
    global.fetch.mockResolvedValue(makeJsonResponse({ success: true }));

    await manager.replayPendingMutations();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/v1/attendance');
    expect(options.headers.Authorization).toBe('Bearer fresh-token');
    expect(await getOfflineData()).toHaveLength(0);
  });

  it('discards permanently rejected mutations (400) instead of looping', async () => {
    const manager = new OfflineManager();
    await queueOne(manager);
    localStorage.setItem('jwtToken', 'fresh-token');
    global.fetch.mockResolvedValue(makeJsonResponse({ success: false }, { status: 400 }));

    await manager.replayPendingMutations();

    expect(await getOfflineData()).toHaveLength(0);
  });

  it('keeps retryable failures (500) queued for the next sync', async () => {
    const manager = new OfflineManager();
    await queueOne(manager);
    localStorage.setItem('jwtToken', 'fresh-token');
    global.fetch.mockResolvedValue(makeJsonResponse({ success: false }, { status: 500 }));

    await manager.replayPendingMutations();

    expect(await getOfflineData()).toHaveLength(1);
  });

  it('does not replay at all without an auth token', async () => {
    const manager = new OfflineManager();
    await queueOne(manager);
    localStorage.removeItem('jwtToken');

    await manager.replayPendingMutations();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(await getOfflineData()).toHaveLength(1);
  });
});

describe('US-OFF-003 — Unscoped legacy writes cannot cross accounts', () => {
  it('discards legacy point records without replaying them', async () => {
    const manager = new OfflineManager();
    await saveOfflineData('updatePoints', { type: 'individual', id: 1, points: 5 });
    await saveOfflineData('updatePoints', { type: 'group', id: 5, points: 3 });
    localStorage.setItem('jwtToken', 'fresh-token');
    global.fetch.mockResolvedValue(makeJsonResponse({ success: true }));

    await manager.replayPendingMutations();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(await getOfflineData()).toHaveLength(0);
  });
});

describe('US-OFF-004 — Reads fall back to cache when the network dies', () => {
  const URL = 'http://localhost:3000/api/v1/participants';

  it('caches a successful JSON GET, then serves it when the network fails', async () => {
    const manager = new OfflineManager();
    global.fetch.mockResolvedValueOnce(makeJsonResponse({ success: true, data: [{ id: 1 }] }));

    await manager.fetchWithOfflineSupport(URL, { method: 'GET' });

    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const fallback = await manager.fetchWithOfflineSupport(URL, { method: 'GET' });

    expect(fallback.status).toBe(200);
    expect(fallback.headers.get('X-From-Cache')).toBe('true');
    const body = await fallback.json();
    expect(body.data[0].id).toBe(1);
  });

  it('answers 503 with a translated offline error when nothing is cached', async () => {
    const manager = new OfflineManager();
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const response = await manager.fetchWithOfflineSupport('http://localhost:3000/api/v1/never-cached', { method: 'GET' });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, offline: true });
  });

  it('serves stale-tolerant cached data seeded directly under the url key', async () => {
    const manager = new OfflineManager();
    await setCachedData('http://localhost:3000/api/v1/groups', { success: true, data: [{ id: 5 }] });
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const response = await manager.fetchWithOfflineSupport('http://localhost:3000/api/v1/groups', { method: 'GET' });
    const body = await response.json();
    expect(body.data[0].id).toBe(5);
  });
});

describe('US-OFF-005 — Camp mode remembers what was prepared', () => {
  it('generates the inclusive camp date range', () => {
    const manager = new OfflineManager();
    expect(manager.generateDateRange('2026-07-14', '2026-07-16'))
      .toEqual(['2026-07-14', '2026-07-15', '2026-07-16']);
  });

  it('answers date-prepared queries from the prepared activities map', () => {
    const manager = new OfflineManager();
    manager.preparedActivities.set('9', {
      startDate: '2026-07-14',
      endDate: '2026-07-16',
      dates: ['2026-07-14', '2026-07-15', '2026-07-16']
    });

    expect(manager.isDatePrepared('2026-07-15')).toBe(true);
    expect(manager.isDatePrepared('2026-07-20')).toBe(false);
    expect(manager.getPreparedActivityForDate('2026-07-15')).toMatchObject({ id: '9', startDate: '2026-07-14' });
    expect(manager.getPreparedActivityForDate('2026-07-20')).toBeNull();
  });

  it('persists prepared activities and camp mode across a reload', () => {
    const manager = new OfflineManager();
    manager.preparedActivities.set('9', {
      startDate: '2026-07-14',
      endDate: '2026-07-16',
      dates: ['2026-07-14', '2026-07-15', '2026-07-16']
    });
    manager.savePreparedActivities();

    const events = captureWindowEvents('campModeChanged');
    manager.enableCampMode('9');
    expect(events.seen[0]).toEqual({ enabled: true, activityId: '9' });
    events.stop();

    // "Reload": a fresh instance restores from localStorage
    const reloaded = new OfflineManager();
    reloaded.restoreCampMode();
    expect(reloaded.campMode).toBe(true);
    expect(reloaded.activeActivityId).toBe('9');
    expect(reloaded.isDatePrepared('2026-07-15')).toBe(true);
  });

  it('disabling camp mode clears the persisted state and announces it', () => {
    const manager = new OfflineManager();
    manager.enableCampMode('9');

    const events = captureWindowEvents('campModeChanged');
    manager.disableCampMode();
    events.stop();

    expect(events.seen[0]).toEqual({ enabled: false });
    expect(localStorage.getItem('wampums_camp_mode')).toBeNull();

    const reloaded = new OfflineManager();
    reloaded.restoreCampMode();
    expect(reloaded.campMode).toBe(false);
  });

  it('clearPreparedActivities wipes everything', () => {
    const manager = new OfflineManager();
    manager.preparedActivities.set('9', { dates: ['2026-07-15'] });
    manager.savePreparedActivities();
    manager.enableCampMode('9');

    manager.clearPreparedActivities();

    expect(manager.preparedActivities.size).toBe(0);
    expect(manager.campMode).toBe(false);
    expect(localStorage.getItem('wampums_prepared_activities')).toBeNull();
  });
});

describe('US-OFF-007 — The app announces connection changes', () => {
  it('handleOffline dispatches offlineStatusChanged {isOffline: true} and a toast', () => {
    const manager = new OfflineManager();
    const status = captureWindowEvents('offlineStatusChanged');
    const toasts = captureWindowEvents('showToast');

    manager.handleOffline();

    status.stop();
    toasts.stop();
    expect(manager.isOffline).toBe(true);
    expect(status.seen).toContainEqual({ isOffline: true });
    expect(toasts.seen.length).toBeGreaterThan(0);
  });

  it('handleOnline dispatches {isOffline: false} and runs a sync cycle', async () => {
    const manager = new OfflineManager();
    manager.isOffline = true;
    localStorage.setItem('jwtToken', 'fresh-token');
    const status = captureWindowEvents('offlineStatusChanged');
    const sync = captureWindowEvents('syncStatusChanged');

    await manager.handleOnline();
    await flushPromises();

    status.stop();
    sync.stop();
    expect(manager.isOffline).toBe(false);
    expect(status.seen).toContainEqual({ isOffline: false });
    expect(sync.seen).toContainEqual({ isSyncing: true });
    expect(sync.seen).toContainEqual({ isSyncing: false });
  });
});
