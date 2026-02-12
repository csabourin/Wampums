/**
 * SyncEngine.js
 *
 * Centralized, testable sync engine with ordered phases:
 *   1. Connectivity + auth check
 *   2. Pull remote changes (delta preferred)
 *   3. Merge + conflict resolution
 *   4. Push outbox in correct order
 *   5. Final reconciliation (ID mapping, relationship repair)
 *
 * Tolerates mid-sync interruption and resumes safely.
 */

import db from '../data/OfflineDatabase.js';
import { repositories } from '../data/Repository.js';
import { outboxManager } from './OutboxManager.js';
import { idMapper } from './IdMapper.js';
import { debugLog, debugError, debugWarn } from '../utils/DebugUtils.js';
import { CONFIG } from '../config.js';
import { makeApiRequest, API } from '../api/api-core.js';

/**
 * Sync phase identifiers for observability.
 */
const PHASE = {
  IDLE: 'idle',
  CHECK: 'check',
  PULL: 'pull',
  MERGE: 'merge',
  PUSH: 'push',
  RECONCILE: 'reconcile',
  COMPLETE: 'complete',
  ERROR: 'error',
};

/**
 * API endpoint mappings for each entity type.
 */
const ENTITY_API = {
  groups: { list: 'v1/groups', single: 'v1/groups' },
  participants: { list: 'v1/participants', single: 'v1/participants' },
  activities: { list: 'v1/activities', single: 'v1/activities' },
  attendance: { list: 'v1/attendance', single: 'v1/attendance' },
  honors: { list: 'v1/honors', single: 'v1/honors' },
  badge_templates: { list: 'v1/badges/settings', single: null },
  badge_progress: { list: 'v1/badges/badge-progress', single: 'v1/badges/badge-progress' },
  medication_requirements: { list: 'v1/medication/requirements', single: 'v1/medication/requirements' },
  medication_distributions: { list: 'v1/medication/distributions', single: 'v1/medication/distributions' },
  carpool_offers: { list: 'v1/carpools/my-offers', single: 'v1/carpools' },
  carpool_assignments: { list: 'v1/carpools/my-children-assignments', single: 'v1/carpools' },
};

/**
 * Entity types to pull during sync (in dependency order for upsert).
 */
const PULL_ORDER = [
  'groups',
  'participants',
  'activities',
  'badge_templates',
  'attendance',
  'honors',
  'badge_progress',
  'medication_requirements',
  'medication_distributions',
  'carpool_offers',
  'carpool_assignments',
];

/**
 * Entity types that are read-only offline (never pushed).
 */
const READ_ONLY_ENTITIES = new Set(['badge_templates', 'points']);

export class SyncEngine {
  constructor() {
    this.phase = PHASE.IDLE;
    this.isSyncing = false;
    this.abortController = null;
    this.metrics = {
      lastSyncAt: null,
      lastSyncDuration: 0,
      pullCount: 0,
      pushCount: 0,
      conflictsDetected: 0,
      errors: [],
    };
  }

  /**
   * Initialize the sync engine.
   * Resets interrupted entries and restores state from meta.
   * @returns {Promise<void>}
   */
  async init() {
    // Reset any in-progress outbox entries from interrupted syncs
    const reset = await outboxManager.resetInProgress();
    if (reset > 0) {
      debugLog(`SyncEngine: Recovered ${reset} interrupted outbox entries`);
    }

    // Load last sync timestamp
    const meta = await db._syncMeta.get('lastSync');
    if (meta) {
      this.metrics.lastSyncAt = meta.value;
    }

    debugLog('SyncEngine: Initialized', { lastSyncAt: this.metrics.lastSyncAt });
  }

  /**
   * Run a full sync cycle.
   * Safe to call multiple times - will skip if already syncing.
   *
   * @param {Object} [options]
   * @param {boolean} [options.fullRefresh] - Force full data pull
   * @param {string[]} [options.entityTypes] - Limit to specific entity types
   * @returns {Promise<SyncResult>}
   */
  async sync(options = {}) {
    if (this.isSyncing) {
      debugLog('SyncEngine: Sync already in progress, skipping');
      return { success: false, reason: 'already_syncing' };
    }

    const syncStart = Date.now();
    this.isSyncing = true;
    this.abortController = new AbortController();
    const correlationId = crypto.randomUUID ? crypto.randomUUID() : `sync_${Date.now()}`;

    debugLog(`SyncEngine: Starting sync [${correlationId}]`);
    this._dispatchEvent('syncStarted', { correlationId });

    try {
      // Phase 1: Connectivity + Auth Check
      this._setPhase(PHASE.CHECK);
      await this._checkConnectivityAndAuth();

      // Phase 2: Pull remote changes
      this._setPhase(PHASE.PULL);
      const pullResult = await this._pullRemoteChanges(options);

      // Phase 3: Merge + Conflict resolution
      this._setPhase(PHASE.MERGE);
      const mergeResult = await this._mergeAndResolveConflicts();

      // Phase 4: Push outbox
      this._setPhase(PHASE.PUSH);
      const pushResult = await this._pushOutbox();

      // Phase 5: Reconciliation
      this._setPhase(PHASE.RECONCILE);
      await this._reconcile();

      // Update sync metadata
      const syncEnd = Date.now();
      this.metrics.lastSyncAt = syncEnd;
      this.metrics.lastSyncDuration = syncEnd - syncStart;
      this.metrics.pullCount = pullResult.count;
      this.metrics.pushCount = pushResult.synced;
      this.metrics.conflictsDetected = mergeResult.conflicts;

      await db._syncMeta.put({ key: 'lastSync', value: syncEnd });

      this._setPhase(PHASE.COMPLETE);
      debugLog(`SyncEngine: Sync complete [${correlationId}]`, {
        duration: this.metrics.lastSyncDuration,
        pulled: pullResult.count,
        pushed: pushResult.synced,
        conflicts: mergeResult.conflicts,
        failed: pushResult.failed,
      });

      this._dispatchEvent('syncCompleted', {
        correlationId,
        metrics: { ...this.metrics },
      });

      return {
        success: true,
        pulled: pullResult.count,
        pushed: pushResult.synced,
        conflicts: mergeResult.conflicts,
        failed: pushResult.failed,
        duration: this.metrics.lastSyncDuration,
      };
    } catch (error) {
      this._setPhase(PHASE.ERROR);
      debugError(`SyncEngine: Sync failed [${correlationId}]`, error);

      this.metrics.errors.push({
        timestamp: Date.now(),
        message: error.message,
        phase: this.phase,
      });

      // Keep only last 10 errors
      if (this.metrics.errors.length > 10) {
        this.metrics.errors = this.metrics.errors.slice(-10);
      }

      this._dispatchEvent('syncFailed', {
        correlationId,
        error: error.message,
        phase: this.phase,
      });

      return {
        success: false,
        error: error.message,
        phase: this.phase,
      };
    } finally {
      this.isSyncing = false;
      this.abortController = null;
      // Preserve terminal phase (COMPLETE/ERROR) for observers; only reset
      // to IDLE if sync was aborted or interrupted before reaching a terminal state.
      if (this.phase !== PHASE.COMPLETE && this.phase !== PHASE.ERROR) {
        this._setPhase(PHASE.IDLE);
      }
    }
  }

  /**
   * Abort an in-progress sync.
   */
  abort() {
    if (this.abortController) {
      this.abortController.abort();
      debugLog('SyncEngine: Sync aborted');
    }
  }

  // ==========================================
  // PHASE 1: Connectivity + Auth Check
  // ==========================================

  async _checkConnectivityAndAuth() {
    if (!navigator.onLine) {
      throw new Error('Device is offline');
    }

    const token = localStorage.getItem(CONFIG.STORAGE_KEYS.JWT_TOKEN);
    if (!token) {
      throw new Error('No authentication token');
    }

    // Quick connectivity test with a lightweight endpoint
    try {
      // Use makeApiRequest for HEAD check - it handles auth and org headers
      await makeApiRequest('v1/organizations/organization-settings', {
        method: 'HEAD',
        signal: this.abortController?.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (error.message.includes('401') || error.message.includes('expired')) {
        throw new Error('Authentication expired');
      }
      throw new Error(`Connectivity check failed: ${error.message}`);
    }

    debugLog('SyncEngine: Connectivity and auth check passed');
  }

  // ==========================================
  // PHASE 2: Pull Remote Changes
  // ==========================================

  async _pullRemoteChanges(options = {}) {
    const token = localStorage.getItem(CONFIG.STORAGE_KEYS.JWT_TOKEN);
    const organizationId = localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_ORGANIZATION_ID);
    let totalPulled = 0;

    const entitiesToPull = options.entityTypes
      ? PULL_ORDER.filter((e) => options.entityTypes.includes(e))
      : PULL_ORDER;

    for (const entityType of entitiesToPull) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Sync aborted');
      }

      const apiConfig = ENTITY_API[entityType];
      if (!apiConfig || !apiConfig.list) continue;

      try {
        // Use makeApiRequest - it handles auth, org headers, and base URL
        const result = await makeApiRequest(apiConfig.list, {
          signal: this.abortController?.signal,
        });

        // makeApiRequest already handles response.json() and handleResponse logic
        let data = result.data || result;

        // Handle various response shapes
        if (Array.isArray(data)) {
          // Direct array
        } else if (data && typeof data === 'object') {
          // Some endpoints return { templates: [...] } or similar
          const arrayKey = Object.keys(data).find((k) => Array.isArray(data[k]));
          if (arrayKey) {
            data = data[arrayKey];
          } else {
            data = [data];
          }
        }

        if (Array.isArray(data) && data.length > 0) {
          const repo = repositories[entityType];
          if (repo) {
            await repo.bulkUpsert(data);
            totalPulled += data.length;
            debugLog(`SyncEngine: Pulled ${data.length} ${entityType}`);
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        debugWarn(`SyncEngine: Error pulling ${entityType}:`, error.message);
      }
    }

    return { count: totalPulled };
  }

  // ==========================================
  // PHASE 3: Merge + Conflict Resolution
  // ==========================================

  async _mergeAndResolveConflicts() {
    // Pull data overwrites non-dirty local data (handled by bulkUpsert/replaceAll).
    // Dirty local data is preserved and will be pushed.
    // Explicit conflicts (409 from server) are detected during push phase.
    // This phase handles pre-push conflict detection using per-entity strategies.

    let conflictsDetected = 0;

    for (const [entityType, repo] of Object.entries(repositories)) {
      const dirtyRecords = await repo.table
        .filter((e) => e._dirty === true)
        .toArray();

      for (const local of dirtyRecords) {
        if (!local._serverUpdatedAt || !local._localUpdatedAt) continue;
        if (new Date(local._serverUpdatedAt) <= new Date(local._localUpdatedAt)) continue;

        // Server version is newer than our local edit — apply conflict strategy
        const strategy = repo.conflictStrategy;

        if (strategy === 'lww') {
          // Last-write-wins: local edit will overwrite server on push; no conflict recorded
          debugLog(`SyncEngine: LWW for ${entityType}:${local.id}, local push will win`);
        } else if (strategy === 'create_wins') {
          // Append-only entities: creates never conflict
          debugLog(`SyncEngine: create_wins for ${entityType}:${local.id}, skipping`);
        } else if (strategy === 'field_merge' || strategy === 'user_resolution') {
          // Queue for user resolution — store in _conflicts
          conflictsDetected++;
          await db._conflicts.add({
            entityType,
            entityId: local.id,
            localVersion: local,
            serverVersion: { updated_at: local._serverUpdatedAt },
            outboxLocalId: null,
            detectedAt: Date.now(),
            resolvedAt: 0,
          });
          debugWarn(
            `SyncEngine: Conflict (${strategy}) for ${entityType}:${local.id} ` +
            `(local: ${local._localUpdatedAt}, server: ${local._serverUpdatedAt})`
          );
        }
      }
    }

    return { conflicts: conflictsDetected };
  }

  // ==========================================
  // PHASE 4: Push Outbox
  // ==========================================

  async _pushOutbox() {
    const entries = await outboxManager.getPendingOrdered();
    let synced = 0;
    let failed = 0;
    let skipped = 0;

    const token = localStorage.getItem(CONFIG.STORAGE_KEYS.JWT_TOKEN);
    const organizationId = localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_ORGANIZATION_ID);

    for (const entry of entries) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Sync aborted');
      }

      // Skip read-only entities
      if (READ_ONLY_ENTITIES.has(entry.entityType)) {
        await outboxManager.markSynced(entry.localId);
        skipped++;
        continue;
      }

      // Check dependencies
      const depsSatisfied = await outboxManager.areDependenciesSatisfied(entry);
      if (!depsSatisfied) {
        debugLog(`SyncEngine: Skipping ${entry.entityType}:${entry.entityId} - dependencies not met`);
        skipped++;
        continue;
      }

      // Resolve temp IDs in payload
      const resolved = await outboxManager.resolvePayloadIds(entry);

      try {
        await outboxManager.markInProgress(entry.localId);

        const result = await this._pushSingleEntry(resolved, token, organizationId);

        if (result.success) {
          await outboxManager.markSynced(entry.localId, result.data);

          // If this was a create with temp ID, record the mapping
          if (entry.operation === 'create' && entry.tempId && result.data) {
            const serverId = result.data.id || result.data[entry.entityType.slice(0, -1) + '_id'];
            if (serverId) {
              await idMapper.addMapping(entry.entityType, entry.tempId, serverId);
              await idMapper.repairReferences(entry.entityType, entry.tempId, serverId);
            }
          }

          synced++;
        } else if (result.conflict) {
          await outboxManager.markConflict(entry.localId, result.serverVersion);
          failed++;
        } else {
          await outboxManager.markFailed(entry.localId, result.error);
          failed++;
        }
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        await outboxManager.markFailed(entry.localId, error.message);
        failed++;
        debugError(`SyncEngine: Push failed for ${entry.entityType}:${entry.entityId}`, error);
      }
    }

    return { synced, failed, skipped };
  }

  /**
   * Push a single outbox entry to the server.
   * @returns {Promise<{success: boolean, data?: Object, conflict?: boolean, serverVersion?: Object, error?: string}>}
   */
  async _pushSingleEntry(entry, token, organizationId) {
    const apiConfig = ENTITY_API[entry.entityType];
    if (!apiConfig) {
      return { success: false, error: `No API config for ${entry.entityType}` };
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    let url;
    let method;
    let body = null;

    switch (entry.operation) {
      case 'create': {
        url = new URL(`/api/${apiConfig.list}`, CONFIG.API_BASE_URL);
        method = 'POST';
        // Strip internal fields from payload
        const createPayload = this._stripInternalFields(entry.payload);
        if (organizationId) createPayload.organization_id = parseInt(organizationId, 10);
        // Remove temp ID - let server assign
        delete createPayload.id;
        body = JSON.stringify(createPayload);
        break;
      }
      case 'update': {
        const entityId = entry.entityId;
        url = new URL(`/api/${apiConfig.single || apiConfig.list}/${entityId}`, CONFIG.API_BASE_URL);
        method = 'PATCH';
        body = JSON.stringify(this._stripInternalFields(entry.payload));
        break;
      }
      case 'delete': {
        const deleteId = entry.entityId;
        url = new URL(`/api/${apiConfig.single || apiConfig.list}/${deleteId}`, CONFIG.API_BASE_URL);
        method = 'DELETE';
        break;
      }
      default:
        return { success: false, error: `Unknown operation: ${entry.operation}` };
    }

    if (organizationId) {
      url.searchParams.set('organization_id', organizationId);
    }

    // Add correlation ID header for server-side deduplication
    headers['X-Correlation-Id'] = entry.correlationId;

    const response = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: this.abortController?.signal,
    });

    if (response.ok) {
      const responseData = response.status === 204 ? null : await response.json();
      return {
        success: true,
        data: responseData?.data || responseData,
      };
    }

    if (response.status === 409) {
      // Conflict
      const conflictData = await response.json().catch(() => ({}));
      return {
        success: false,
        conflict: true,
        serverVersion: conflictData.data || conflictData,
      };
    }

    const errorBody = await response.text().catch(() => '');
    return {
      success: false,
      error: `HTTP ${response.status}: ${errorBody}`,
    };
  }

  // ==========================================
  // PHASE 5: Reconciliation
  // ==========================================

  async _reconcile() {
    // Clean up synced outbox entries
    await outboxManager.purgeSynced();

    // Clean up old ID mappings
    await idMapper.purgeOldMappings();

    debugLog('SyncEngine: Reconciliation complete');
  }

  // ==========================================
  // HELPERS
  // ==========================================

  /**
   * Strip internal tracking fields before sending to server.
   */
  _stripInternalFields(payload) {
    if (!payload) return payload;
    const clean = { ...payload };
    delete clean._dirty;
    delete clean._localUpdatedAt;
    delete clean._serverUpdatedAt;
    delete clean._syncVersion;
    return clean;
  }

  /**
   * Set the current sync phase and dispatch event.
   */
  _setPhase(phase) {
    this.phase = phase;
    this._dispatchEvent('syncPhaseChanged', { phase });
  }

  /**
   * Dispatch a custom event on the window.
   */
  _dispatchEvent(name, detail) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  /**
   * Get current sync metrics for observability.
   * @returns {Object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      phase: this.phase,
      isSyncing: this.isSyncing,
    };
  }
}

export const syncEngine = new SyncEngine();
