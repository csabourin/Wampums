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
import { pageReadAnyOf, setLiveSyncClientId } from './LiveSyncState.js';

const DATA_CHANGED_EVENT = 'data-changed';
const TOKEN_STORAGE_KEY = 'jwtToken';

/** Wait for a burst of changes (a leader awarding points) to settle before redrawing. */
const REFRESH_DEBOUNCE_MS = 1500;
/** How often to check again whether the person has finished editing. */
const REFRESH_RETRY_MS = 5000;
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
 * @returns {string} Path and query of the screen on display
 */
function currentLocation() {
  return `${window.location.pathname}${window.location.search}`;
}

class LiveDataSync {
  constructor() {
    this.socket = null;
    this.connectedToken = null;
    this.hasConnectedBefore = false;
    this.redrawTimer = null;
    this.redrawLocation = null;
    this.reconnectTimer = null;
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
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.socket?.disconnect();
    this.socket = null;
    this.hasConnectedBefore = false;
    setLiveSyncClientId(null);
  }

  handleConnect() {
    setLiveSyncClientId(this.socket.id);
    debugLog('Live sync connected:', this.socket.id);

    // Changes made while disconnected were never announced to this session.
    if (this.hasConnectedBefore && isLiveSyncActive()) {
      applyInvalidation(planFullRefresh())
        .then((invalidation) => this.redrawIfShown(invalidation))
        .catch((error) => debugWarn('Live sync catch-up failed:', error));
    }
    this.hasConnectedBefore = true;
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
    const path = typeof payload?.path === 'string' ? payload.path : null;
    if (!path || !isLiveSyncActive()) {
      return;
    }
    debugLog('Live sync: data changed elsewhere', path);
    this.redrawIfShown(await invalidateForWrite(path));
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
    // Imported here: app.js loads this module, so a static import would be circular.
    const { app } = await import('../../app.js');
    const router = app?.router;
    if (!router) {
      return;
    }
    // The router keeps the screen where it was scrolled.
    await router.route(currentLocation());
  }
}

export const liveDataSync = new LiveDataSync();
