/**
 * Keeps every open session of a unit current with changes made elsewhere.
 *
 * The server announces each successful write to the unit's other connections
 * (`data-changed`, carrying the API path written). This client drops the cache
 * entries the change made stale and, when the screen on display was built from
 * them, draws it again once the person is not in the middle of editing.
 *
 * Offline and in camp mode, announcements are ignored: the cache then holds
 * the prepared copy of the unit and must not be emptied under the leader.
 */
import { offlineManager } from '../OfflineManager.js';
import { applyInvalidation, invalidateForWrite, planFullRefresh } from '../../utils/CacheInvalidation.js';
import { loadSocketIOClient } from '../../utils/SocketIOClient.js';
import { debugLog, debugWarn } from '../../utils/DebugUtils.js';
import { CONFIG } from '../../config.js';
import { makeApiRequestWithCache } from '../../api/api-core.js';
import {
  getPageCachedRequests,
  isPageCachedRequestCurrent,
  onWriteSettled,
  pageReadAnyOf,
  pageReadsAreReplayable,
  setLiveSyncClientId,
  takeWriteState,
} from './LiveSyncState.js';

const DATA_CHANGED_EVENT = 'data-changed';
const SYNC_STATE_EVENT = 'sync-state';
const TOKEN_STORAGE_KEY = 'jwtToken';

/** Wait for a burst of changes (a leader awarding points) to settle before redrawing. */
const REFRESH_DEBOUNCE_MS = 1500;
/** How often to check again whether the person has finished editing. */
const REFRESH_RETRY_MS = 5000;
/**
 * Longest the browser may keep showing the old screen while the new one is
 * drawn. During a view transition the page ignores taps and the screen reader
 * reads the new content, so the hold stays short: its data is already fetched.
 */
const MAX_TRANSITION_HOLD_MS = 300;
/**
 * How long a reconnected session waits for the server's sync state before
 * catching up anyway (a server that does not send one).
 */
const SYNC_STATE_WAIT_MS = 3000;
/**
 * Longest absence after which a reconnection trusts the server's sync state.
 * Some changes are never announced (a background job, a name seen by other
 * units); after a longer absence (10 minutes) the session catches up whatever
 * the state.
 */
const MAX_TRUSTED_ABSENCE_MS = 600000;
/** Delay before retrying a connection the server refused. */
const RECONNECT_DELAY_MS = 30000;

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
const OPEN_DIALOG_SELECTOR = 'dialog[open], [role="dialog"], [aria-modal="true"], .modal-overlay';

/**
 * Whether writes and announcements should refresh caches broadly: connected,
 * and not working from a camp or activity's offline copy.
 * @returns {boolean} True when live sync applies
 */
export function isLiveSyncActive() {
  return navigator.onLine !== false && !offlineManager.isOffline && !offlineManager.campMode;
}

/**
 * @param {Element} field - Form control
 * @returns {boolean} Whether its value differs from what the page drew
 */
function isFieldModified(field) {
  if (field instanceof HTMLInputElement) {
    if (field.type === 'checkbox' || field.type === 'radio') {
      return field.checked !== field.defaultChecked;
    }
    return field.value !== field.defaultValue;
  }
  if (field instanceof HTMLTextAreaElement) {
    return field.value !== field.defaultValue;
  }
  if (field instanceof HTMLSelectElement) {
    if (field.multiple) {
      return Array.from(field.options).some((option) => option.selected !== option.defaultSelected);
    }
    // Without a `selected` attribute, a single select starts on its first option.
    const defaultIndex = Math.max(0, Array.from(field.options).findIndex((option) => option.defaultSelected));
    return field.options.length > 0 && field.selectedIndex !== defaultIndex;
  }
  return false;
}

/**
 * Redrawing the page would throw away what the person is doing when a field
 * has focus, a dialog is open, or a form holds unsaved changes. Filters and
 * search boxes outside a form are not unsaved work and do not hold it back.
 * @returns {boolean} True when the page can be redrawn without loss
 */
function isSafeToRedraw() {
  if (document.visibilityState === 'hidden') {
    return false;
  }
  if (document.activeElement?.matches?.(EDITABLE_SELECTOR)) {
    return false;
  }
  if (document.querySelector(OPEN_DIALOG_SELECTOR)) {
    return false;
  }
  const app = document.getElementById('app');
  return !app || !Array.from(app.querySelectorAll('form input, form textarea, form select')).some(isFieldModified);
}

/**
 * @param {*} state - `sync-state` payload
 * @returns {boolean} Whether it names a unit, its version and the shared
 *   version (writes no unit could be named for)
 */
function isSyncState(state) {
  return typeof state?.org === 'string' && Number.isInteger(state?.version) && Number.isInteger(state?.shared);
}

/**
 * @param {Object|null} seen - Last sync state this session saw
 * @param {Object} current - Sync state the server sent on reconnection
 * @returns {boolean} True when the server announced nothing while away
 */
function nothingChangedSince(seen, current) {
  return Boolean(seen) && seen.org === current.org
    && seen.version === current.version && seen.shared === current.shared;
}

/**
 * @returns {string} Path and query of the screen on display
 */
function currentLocation() {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Fetch again the cached data the screen on display read, so that redrawing
 * it reads the cache instead of waiting on the network. A request that fails
 * is left for the screen itself to report when it redraws. A response that
 * arrives after the page moved on is not stored.
 * @returns {Promise<void>}
 */
async function refetchPageData() {
  await Promise.allSettled(getPageCachedRequests().map((request) =>
    makeApiRequestWithCache(request.endpoint, request.options, {
      ...request.cacheOptions,
      forceRefresh: true,
      // Stored only while the page still reads its entry through this request.
      isCurrent: () => isPageCachedRequestCurrent(request),
    })));
}

/**
 * Replace the screen with its refreshed copy in one step. Inside a view
 * transition the browser keeps showing the current screen until the update
 * has drawn the new one, so its loading state never flashes up. That holds
 * only for a screen whose reads were all fetched again beforehand: a screen
 * reading data no cache keeps is redrawn without a transition, since the page
 * ignores taps during one. The hold ends
 * after MAX_TRANSITION_HOLD_MS even if the update is still running: the screen
 * then shows its loading state, as it would without a transition. Browsers
 * without view transitions redraw as the router normally does.
 * @param {function(): Promise<void>} update - Draws the refreshed screen
 * @returns {Promise<void>} Settles once the update has run
 */
async function showRefreshed(update) {
  if (typeof document.startViewTransition !== 'function' || !pageReadsAreReplayable()) {
    await update();
    return;
  }
  let updated = null;
  let holdTimer = null;
  const transition = document.startViewTransition(() => {
    updated = update();
    const holdEnded = new Promise((resolve) => {
      holdTimer = setTimeout(resolve, MAX_TRANSITION_HOLD_MS);
    });
    return Promise.race([updated, holdEnded]);
  });
  // A skipped or timed-out transition rejects these, yet the update still applies.
  transition.ready.catch(() => {});
  transition.finished.catch(() => {});
  // A failed update is reported through `updated` below.
  await transition.updateCallbackDone.catch(() => {});
  clearTimeout(holdTimer);
  await updated;
}

class LiveDataSync {
  constructor() {
    this.socket = null;
    this.connectedToken = null;
    this.hasConnectedBefore = false;
    this.redrawTimer = null;
    this.redrawLocation = null;
    this.reconnectTimer = null;
    this.syncState = null;
    this.awaitingConnectionState = false;
    this.reconnected = false;
    this.pendingWriteStates = [];
    this.fallbackCatchUp = null;
    this.lastAliveAt = 0;
    this.awayTooLong = false;
    this.syncStateTimer = null;
    this.onVisibilityChange = () => this.checkToken();
  }

  /**
   * Connect to the unit's change feed. Safe to call more than once.
   * @returns {Promise<void>}
   */
  async start() {
    if (this.socket || !localStorage.getItem(TOKEN_STORAGE_KEY)) {
      return;
    }

    let io;
    try {
      io = await loadSocketIOClient();
    } catch (error) {
      debugWarn('Live sync unavailable:', error);
      return;
    }
    if (!io || this.socket) {
      return;
    }

    this.socket = io(CONFIG.API_BASE_URL, {
      // Read at every (re)connection so a refreshed token is used.
      auth: (callback) => {
        this.connectedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
        callback({ token: this.connectedToken });
      }
    });

    this.socket.on('connect', () => this.handleConnect());
    this.socket.on('disconnect', () => setLiveSyncClientId(null));
    this.socket.on('connect_error', (error) => this.handleConnectError(error));
    this.socket.on(SYNC_STATE_EVENT, (state) => this.handleSyncState(state));
    // The server pings every connection: the last ping marks when this one was last alive.
    this.socket.io?.on?.('ping', () => this.markAlive());
    onWriteSettled(() => this.acceptPendingWriteState());
    this.socket.on(DATA_CHANGED_EVENT, (payload) => {
      this.handleDataChanged(payload).catch((error) => debugWarn('Live sync update failed:', error));
    });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /**
   * Disconnect, e.g. on logout.
   */
  stop() {
    clearTimeout(this.redrawTimer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.syncStateTimer);
    onWriteSettled(null);
    this.syncState = null;
    this.awaitingConnectionState = false;
    this.fallbackCatchUp = null;
    this.pendingWriteStates = [];
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.socket?.disconnect();
    this.socket = null;
    this.hasConnectedBefore = false;
    setLiveSyncClientId(null);
  }

  handleConnect() {
    setLiveSyncClientId(this.socket.id);
    debugLog('Live sync connected:', this.socket.id);

    // The server sends its sync state right after connecting. On a first
    // connection it is the baseline. On a reconnection (a phone reconnects
    // each time the app returns from the background) it tells whether
    // changes were announced while this session was away.
    this.awaitingConnectionState = true;
    this.reconnected = this.hasConnectedBefore;
    this.awayTooLong = this.reconnected && Date.now() - this.lastAliveAt > MAX_TRUSTED_ABSENCE_MS;
    this.markAlive();
    this.fallbackCatchUp = null;
    clearTimeout(this.syncStateTimer);
    if (this.reconnected) {
      this.syncStateTimer = setTimeout(() => {
        // Still awaiting the connection's state, but no longer to decide.
        this.fallbackCatchUp = this.catchUp(null);
      }, SYNC_STATE_WAIT_MS);
    }
    this.hasConnectedBefore = true;
  }

  /**
   * @param {*} state - `sync-state` from the server: on connection, and after
   *   this session's own writes
   */
  handleSyncState(state) {
    if (!isSyncState(state)) {
      return;
    }
    // The connection's state is marked; anything else follows one of this
    // session's own writes, and is seen once its response is handled.
    if (!this.awaitingConnectionState || state.connection !== true) {
      this.pendingWriteStates.push(state);
      this.acceptPendingWriteState();
      return;
    }
    this.awaitingConnectionState = false;
    clearTimeout(this.syncStateTimer);
    if (this.fallbackCatchUp) {
      // Arrived after the wait: seen once the catch-up already under way succeeds.
      this.fallbackCatchUp.then((caughtUp) => {
        if (caughtUp) {
          this.recordSeen(state);
        }
      });
      this.fallbackCatchUp = null;
      return;
    }
    if (!this.reconnected) {
      this.recordSeen(state);
      return;
    }
    if (!this.awayTooLong && nothingChangedSince(this.syncState, state)) {
      debugLog('Live sync: nothing changed while disconnected');
      return;
    }
    this.catchUp(state);
  }

  /** Note that the connection was alive just now. */
  markAlive() {
    this.lastAliveAt = Date.now();
  }

  /**
   * Count the server's state after one of this session's writes as seen only
   * once every write has been handled, cache invalidation included. A write
   * that went unconfirmed (its response lost) leaves the state unseen, so the
   * next reconnection catches up.
   */
  acceptPendingWriteState() {
    if (this.pendingWriteStates.length === 0) {
      return;
    }
    const writes = takeWriteState();
    if (writes === 'pending') {
      return;
    }
    const states = this.pendingWriteStates.sort((a, b) => a.version - b.version);
    this.pendingWriteStates = [];
    if (writes === 'settled') {
      states.forEach((state) => this.advanceSeen(state));
    }
  }

  /**
   * Count one more change as seen, only when it directly follows the last one
   * seen: a gap means a change this session never applied.
   * @param {{ org?: string, version: number }} state - Version just applied
   */
  advanceSeen(state) {
    const seen = this.syncState;
    if (!seen || (state.org && state.org !== seen.org)) {
      return;
    }
    if (state.version === seen.version + 1) {
      seen.version = state.version;
    }
  }

  /**
   * @param {{ org: string, version: number, shared: number }} state - State the
   *   whole cache now reflects (first connection, or after a full catch-up)
   */
  recordSeen(state) {
    this.syncState = { org: state.org, version: state.version, shared: state.shared };
  }

  /**
   * Drop what changes made while disconnected may have made stale. The
   * server's state is recorded only once that is done: offline, in camp mode,
   * or if it fails, the next reconnection tries again.
   * @param {Object|null} state - Server state to record afterwards
   * @returns {Promise<boolean>} Whether the cache was cleared
   */
  catchUp(state) {
    if (!isLiveSyncActive()) {
      return Promise.resolve(false);
    }
    return applyInvalidation(planFullRefresh())
      .then((invalidation) => {
        if (state) {
          this.recordSeen(state);
        }
        this.redrawIfShown(invalidation);
        return true;
      })
      .catch((error) => {
        debugWarn('Live sync catch-up failed:', error);
        return false;
      });
  }

  /**
   * The server refuses a connection whose token it cannot verify, and
   * Socket.IO does not retry that on its own.
   * @param {Error} error - Connection error
   */
  handleConnectError(error) {
    debugWarn('Live sync connection refused:', error?.message);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.socket && !this.socket.connected && localStorage.getItem(TOKEN_STORAGE_KEY)) {
        this.socket.connect();
      }
    }, RECONNECT_DELAY_MS);
  }

  /**
   * A new token can name another unit; reconnect so the server files this
   * session under the right one.
   */
  checkToken() {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!this.socket || !token || token === this.connectedToken) {
      return;
    }
    this.socket.disconnect().connect();
  }

  /**
   * @param {{ path?: string }} payload - Announcement from the server
   * @returns {Promise<void>}
   */
  async handleDataChanged(payload) {
    this.checkToken();
    this.markAlive();
    const path = typeof payload?.path === 'string' ? payload.path : null;
    if (!path || !isLiveSyncActive()) {
      return;
    }
    debugLog('Live sync: data changed elsewhere', path);
    const invalidation = await invalidateForWrite(path);
    // Counted as seen only once applied: an ignored change is caught up on reconnection.
    if (Number.isInteger(payload?.version)) {
      this.advanceSeen({ version: payload.version });
    }
    this.redrawIfShown(invalidation);
  }

  /**
   * @param {{ deletedKeys: string[], matchesPath: function(string): boolean }} invalidation
   */
  redrawIfShown(invalidation) {
    if (!pageReadAnyOf(invalidation)) {
      return;
    }
    clearTimeout(this.redrawTimer);
    this.redrawLocation = currentLocation();
    this.redrawTimer = setTimeout(() => this.redraw(), REFRESH_DEBOUNCE_MS);
  }

  async redraw() {
    // Navigating away already loaded the next screen from the refreshed cache.
    if (currentLocation() !== this.redrawLocation) {
      return;
    }
    if (!isSafeToRedraw()) {
      this.redrawTimer = setTimeout(() => this.redraw(), REFRESH_RETRY_MS);
      return;
    }
    await refetchPageData();
    // The person may have moved on, or started typing, while it loaded.
    if (currentLocation() !== this.redrawLocation) {
      return;
    }
    if (!isSafeToRedraw()) {
      this.redrawTimer = setTimeout(() => this.redraw(), REFRESH_RETRY_MS);
      return;
    }
    // Imported here: app.js loads this module, so a static import would be circular.
    const { app } = await import('../../app.js');
    const router = app?.router;
    if (!router) {
      return;
    }
    // The router keeps the screen where it was scrolled.
    // A refresh: screens keep what is on display while they load (no skeleton).
    await showRefreshed(() => router.route(currentLocation(), { refresh: true }));
  }
}

export const liveDataSync = new LiveDataSync();
