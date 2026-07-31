/**
 * Stale client recovery.
 *
 * When the app moves to a new host, or a deploy replaces the hashed asset
 * filenames, some browsers keep serving a previously cached app shell from the
 * service worker. That shell then asks for JS chunks that no longer exist and
 * the app fails to start — the user sees a blank page or an endless spinner
 * and has no way to fix it short of clearing site data by hand.
 *
 * Two safety nets live here:
 *
 *  1. `checkForStaleClient()` compares the server's build id against the one
 *     this client booted with. A mismatch triggers a full purge and reload.
 *  2. `installChunkErrorRecovery()` catches dynamic-import failures, which is
 *     what a mismatched shell actually produces at runtime, and purges too.
 *
 * Both funnel into `purgeAndReload()`, which is guarded so a client can never
 * end up in a reload loop.
 */

import { CONFIG } from '../../config.js';
import { debugLog, debugError, debugWarn } from '../../utils/DebugUtils.js';

/** Build id this client booted with. */
const BUILD_ID_KEY = 'wampums.client.buildId';
/** Marks that a recovery reload already happened; prevents reload loops. */
const RECOVERY_FLAG_KEY = 'wampums.client.recovering';
/** How long a single recovery attempt stays "in progress", in milliseconds. */
const RECOVERY_WINDOW_MS = 60 * 1000;
/** Give up on the version probe rather than delaying boot indefinitely. */
const VERSION_PROBE_TIMEOUT_MS = 8000;

const CHUNK_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'unable to preload css',
];

/**
 * Read the build id this client last booted with.
 *
 * @returns {string|null} Stored build id, or null when unknown.
 */
function readStoredBuildId() {
  try {
    return localStorage.getItem(BUILD_ID_KEY);
  } catch (error) {
    debugLog('Cannot read stored build id:', error);
    return null;
  }
}

/**
 * Persist the build id this client is now running.
 *
 * @param {string} buildId - Build id reported by the server.
 * @returns {void}
 */
function writeStoredBuildId(buildId) {
  try {
    localStorage.setItem(BUILD_ID_KEY, buildId);
  } catch (error) {
    debugLog('Cannot persist build id:', error);
  }
}

/**
 * Whether a recovery reload is already in flight.
 *
 * Recovery is recorded with a timestamp rather than a bare flag so that a
 * genuinely new mismatch later in the session can still trigger a reload.
 *
 * @returns {boolean} True when a recovery started within the guard window.
 */
function isRecoveryInProgress() {
  try {
    const startedAt = Number(sessionStorage.getItem(RECOVERY_FLAG_KEY));
    if (!startedAt) return false;
    return Date.now() - startedAt < RECOVERY_WINDOW_MS;
  } catch (error) {
    debugLog('Cannot read recovery flag:', error);
    return false;
  }
}

/**
 * Record that a recovery reload is starting.
 *
 * @returns {void}
 */
function markRecoveryStarted() {
  try {
    sessionStorage.setItem(RECOVERY_FLAG_KEY, String(Date.now()));
  } catch (error) {
    debugLog('Cannot persist recovery flag:', error);
  }
}

/**
 * Unregister every service worker and delete every Cache Storage bucket.
 *
 * IndexedDB is deliberately left alone: it holds the offline mutation outbox
 * and cached API data, and discarding it could lose a leader's unsynced work.
 * The problem being fixed is stale *code*, not stale data.
 *
 * @returns {Promise<void>} Resolves once the purge attempt finishes.
 */
export async function purgeClientCaches() {
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) => registration.unregister()),
      );
      debugLog(`Unregistered ${registrations.length} service worker(s)`);
    } catch (error) {
      debugError('Failed to unregister service workers:', error);
    }
  }

  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      debugLog(`Deleted ${keys.length} cache bucket(s)`);
    } catch (error) {
      debugError('Failed to delete caches:', error);
    }
  }
}

/**
 * Purge stale client code and reload, at most once per guard window.
 *
 * @param {string} reason - Why recovery was triggered; logged for support.
 * @returns {Promise<boolean>} True when a reload was initiated.
 */
export async function purgeAndReload(reason) {
  if (isRecoveryInProgress()) {
    debugWarn(`Stale client recovery already in progress, not retrying (${reason})`);
    return false;
  }

  markRecoveryStarted();
  debugWarn(`Recovering stale client: ${reason}`);

  await purgeClientCaches();
  window.location.reload();
  return true;
}

/**
 * Ask the server which build it is serving.
 *
 * The request deliberately bypasses every cache layer: a stale answer would
 * defeat the check. The timestamp query parameter guarantees a cache miss even
 * in an old service worker that keys entries by URL.
 *
 * @returns {Promise<{version: string, buildId: string}|null>} Server build, or
 *   null when it cannot be determined (offline, timeout, unexpected shape).
 */
async function fetchServerBuild() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERSION_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${CONFIG.API_BASE_URL}/api/v1/app-version?t=${Date.now()}`,
      {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      debugLog('Version probe returned', response.status);
      return null;
    }

    const payload = await response.json();
    const data = payload?.data || payload;
    const buildId = data?.build_id;

    if (!buildId) {
      debugLog('Version probe returned no build id');
      return null;
    }

    return { version: data.version || CONFIG.VERSION, buildId };
  } catch (error) {
    // Offline or unreachable is normal for a PWA; nothing to recover from.
    debugLog('Version probe failed:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compare this client's build against the server's and recover if they differ.
 *
 * On a first run the server build is simply recorded, so an existing user is
 * not reloaded just for having no stored value.
 *
 * @returns {Promise<boolean>} True when a recovery reload was initiated.
 */
export async function checkForStaleClient() {
  const serverBuild = await fetchServerBuild();
  if (!serverBuild) return false;

  const storedBuildId = readStoredBuildId();

  if (!storedBuildId) {
    writeStoredBuildId(serverBuild.buildId);
    debugLog('Recorded initial build id:', serverBuild.buildId);
    return false;
  }

  if (storedBuildId === serverBuild.buildId) {
    return false;
  }

  // Record the new build before reloading so the reloaded client sees a match
  // and does not attempt recovery again.
  writeStoredBuildId(serverBuild.buildId);

  return await purgeAndReload(
    `build changed ${storedBuildId} -> ${serverBuild.buildId}`,
  );
}

/**
 * Whether an error looks like a failed dynamic import of a missing chunk.
 *
 * @param {unknown} error - Error or rejection reason to inspect.
 * @returns {boolean} True when the message matches a known chunk failure.
 */
function isChunkLoadError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Recover automatically when the app shell references chunks that no longer
 * exist, which is what a stale cached client produces at runtime.
 *
 * @returns {void}
 */
export function installChunkErrorRecovery() {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    purgeAndReload('vite preload error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) {
      purgeAndReload('dynamic import failure');
    }
  });

  window.addEventListener('error', (event) => {
    if (isChunkLoadError(event.error || event.message)) {
      purgeAndReload('dynamic import failure');
    }
  });
}
