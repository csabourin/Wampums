/**
 * The reads a person made on any screen, per account, unit and year, so the
 * everyday preparation (OfflineBaseline) keeps every screen they use ready
 * without signal, including screens added later, with no list to maintain.
 *
 * Only what is needed to repeat a read is kept (endpoint, query, cache key and
 * duration), in localStorage, which sign-out clears (StorageUtils). Network-only
 * reads never reach it (api-core keeps no copy of them).
 */
import { OFFLINE_READS } from '../config/offline-reads.js';
import { debugLog } from './DebugUtils.js';

/** @returns {Object<string, Array<Object>>} Entries by scope */
function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OFFLINE_READS.REGISTRY_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

/** @param {Object<string, Array<Object>>} all */
function writeAll(all) {
  try {
    localStorage.setItem(OFFLINE_READS.REGISTRY_STORAGE_KEY, JSON.stringify(all));
  } catch (error) {
    debugLog('Cannot record offline reads:', error);
  }
}

/** Only entries still within the offline retention, most recent first, capped. */
function keepCurrent(entries, now) {
  return entries
    .filter((entry) => now - Number(entry?.lastUsed || 0) < OFFLINE_READS.RETENTION_MS)
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, OFFLINE_READS.REGISTRY_MAX_ENTRIES);
}

/**
 * Remember a read a screen made.
 * @param {string} scope - Account, unit and year (buildScopedCacheKey(''))
 * @param {{endpoint: string, params?: Object, cacheKey: string, cacheDuration?: number}} read
 * @param {number} [now]
 */
export function noteOfflineRead(scope, { endpoint, params = {}, cacheKey, cacheDuration }, now = Date.now()) {
  if (!scope || !endpoint || !cacheKey) {return;}
  const all = readAll();
  const entries = (all[scope] || []).filter((entry) => entry.cacheKey !== cacheKey);
  entries.push({ endpoint, params, cacheKey, cacheDuration, lastUsed: now });
  all[scope] = keepCurrent(entries, now);
  writeAll(all);
}

/**
 * The reads to keep ready for one scope, most recent first.
 * @param {string} scope
 * @param {number} [now]
 * @returns {Array<{endpoint: string, params: Object, cacheKey: string, cacheDuration?: number}>}
 */
export function listOfflineReads(scope, now = Date.now()) {
  return keepCurrent(readAll()[scope] || [], now);
}
