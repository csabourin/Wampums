/**
 * OutboxManager.js
 *
 * Manages the outbox queue for offline change tracking.
 * Provides ordered retrieval respecting entity dependencies,
 * retry logic, and outbox cleanup after successful sync.
 */

import db, { isTempId } from '../data/OfflineDatabase.js';
import { debugLog, debugError, debugWarn } from '../utils/DebugUtils.js';

/**
 * Topological sync push order.
 * Entities earlier in this list are pushed first to satisfy FK constraints.
 */
const SYNC_ORDER = [
  'groups',
  'participants',
  'activities',
  'attendance',
  'honors',
  'badge_progress',
  'medication_requirements',
  'medication_distributions',
  'carpool_offers',
  'carpool_assignments',
];

/**
 * Maximum retry count before marking an entry as permanently failed.
 */
const MAX_RETRIES = 5;

export class OutboxManager {
  /**
   * Get all pending outbox entries in correct sync order.
   * Respects topological entity ordering and timestamp within each entity type.
   *
   * @returns {Promise<Array>} Ordered outbox entries
   */
  async getPendingOrdered() {
    const entries = await db._outbox
      .where('status')
      .equals('pending')
      .toArray();

    // Sort by sync order, then by timestamp within each entity type
    entries.sort((a, b) => {
      const orderA = SYNC_ORDER.indexOf(a.entityType);
      const orderB = SYNC_ORDER.indexOf(b.entityType);
      const posA = orderA === -1 ? SYNC_ORDER.length : orderA;
      const posB = orderB === -1 ? SYNC_ORDER.length : orderB;

      if (posA !== posB) return posA - posB;
      return a.timestamp - b.timestamp;
    });

    return entries;
  }

  /**
   * Get the count of pending outbox entries.
   * @returns {Promise<number>}
   */
  async getPendingCount() {
    return db._outbox.where('status').equals('pending').count();
  }

  /**
   * Get all outbox entries (any status) for debugging.
   * @returns {Promise<Array>}
   */
  async getAll() {
    return db._outbox.orderBy('timestamp').toArray();
  }

  /**
   * Mark an outbox entry as in-progress.
   * @param {number} localId
   * @returns {Promise<void>}
   */
  async markInProgress(localId) {
    await db._outbox.update(localId, { status: 'in_progress' });
  }

  /**
   * Mark an outbox entry as synced (success).
   * @param {number} localId
   * @param {*} serverResponse - Optional server response data
   * @returns {Promise<void>}
   */
  async markSynced(localId, serverResponse = null) {
    await db._outbox.update(localId, {
      status: 'synced',
      serverResponse,
    });
  }

  /**
   * Mark an outbox entry as failed with error info.
   * @param {number} localId
   * @param {string} errorMessage
   * @returns {Promise<void>}
   */
  async markFailed(localId, errorMessage) {
    const entry = await db._outbox.get(localId);
    if (!entry) return;

    const newRetryCount = (entry.retryCount || 0) + 1;
    const newStatus = newRetryCount >= MAX_RETRIES ? 'failed' : 'pending';

    await db._outbox.update(localId, {
      status: newStatus,
      retryCount: newRetryCount,
      lastError: errorMessage,
    });

    if (newRetryCount >= MAX_RETRIES) {
      debugWarn(`OutboxManager: Entry ${localId} permanently failed after ${MAX_RETRIES} retries`);
    }
  }

  /**
   * Mark an entry as having a conflict.
   * @param {number} localId
   * @param {Object} serverVersion - The server's version of the entity
   * @returns {Promise<void>}
   */
  async markConflict(localId, serverVersion) {
    const entry = await db._outbox.get(localId);
    if (!entry) return;

    await db.transaction('rw', [db._outbox, db._conflicts], async () => {
      await db._outbox.update(localId, { status: 'conflict' });

      await db._conflicts.add({
        entityType: entry.entityType,
        entityId: entry.entityId,
        localVersion: entry.payload,
        serverVersion,
        outboxLocalId: localId,
        detectedAt: Date.now(),
        resolvedAt: 0,
      });
    });
  }

  /**
   * Reset in-progress entries back to pending.
   * Called on startup to recover from interrupted syncs.
   * @returns {Promise<number>} Number of entries reset
   */
  async resetInProgress() {
    const inProgress = await db._outbox
      .where('status')
      .equals('in_progress')
      .toArray();

    if (inProgress.length > 0) {
      await db._outbox
        .where('status')
        .equals('in_progress')
        .modify({ status: 'pending' });

      debugLog(`OutboxManager: Reset ${inProgress.length} in-progress entries to pending`);
    }

    return inProgress.length;
  }

  /**
   * Purge synced entries older than the given age.
   * @param {number} maxAgeMs - Maximum age in milliseconds (default: 7 days)
   * @returns {Promise<number>} Number of entries purged
   */
  async purgeSynced(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;

    const toDelete = await db._outbox
      .where('status')
      .equals('synced')
      .filter((entry) => entry.timestamp < cutoff)
      .primaryKeys();

    if (toDelete.length > 0) {
      await db._outbox.bulkDelete(toDelete);
      debugLog(`OutboxManager: Purged ${toDelete.length} synced entries`);
    }

    return toDelete.length;
  }

  /**
   * Check if an outbox entry's dependencies are satisfied.
   * A dependency is satisfied if:
   * - It has a server ID mapping (was already synced), OR
   * - It does not use a temp ID
   *
   * @param {Object} entry - Outbox entry
   * @returns {Promise<boolean>}
   */
  async areDependenciesSatisfied(entry) {
    if (!entry.dependencies || entry.dependencies.length === 0) {
      return true;
    }

    for (const dep of entry.dependencies) {
      if (dep.tempId) {
        const mapping = await db._idMap
          .where('[entityType+tempId]')
          .equals([dep.entityType, dep.tempId])
          .first();

        if (!mapping) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Replace temp IDs in an outbox entry's payload with server IDs
   * using the _idMap.
   *
   * @param {Object} entry - Outbox entry
   * @returns {Promise<Object>} Entry with resolved IDs in payload
   */
  async resolvePayloadIds(entry) {
    if (!entry.payload) return entry;

    const resolved = { ...entry, payload: { ...entry.payload } };

    // Resolve the entity's own ID if it's a temp
    if (isTempId(entry.entityId)) {
      const mapping = await db._idMap
        .where('[entityType+tempId]')
        .equals([entry.entityType, entry.entityId])
        .first();

      if (mapping) {
        resolved.entityId = mapping.serverId;
        resolved.payload.id = mapping.serverId;
      }
    }

    // Resolve FK references in payload
    const fkFields = {
      participant_id: 'participants',
      group_id: 'groups',
      activity_id: 'activities',
      badge_template_id: 'badge_templates',
      medication_requirement_id: 'medication_requirements',
      carpool_offer_id: 'carpool_offers',
      honor_id: 'honors',
    };

    for (const [field, entityType] of Object.entries(fkFields)) {
      const value = resolved.payload[field];
      if (value && isTempId(value)) {
        const mapping = await db._idMap
          .where('[entityType+tempId]')
          .equals([entityType, value])
          .first();

        if (mapping) {
          resolved.payload[field] = mapping.serverId;
        }
      }
    }

    return resolved;
  }

  /**
   * Get outbox entries grouped by entity type for observability.
   * @returns {Promise<Object>} Map of entityType -> count
   */
  async getStatusSummary() {
    const all = await db._outbox.toArray();
    const summary = {};

    for (const entry of all) {
      const key = `${entry.entityType}:${entry.status}`;
      summary[key] = (summary[key] || 0) + 1;
    }

    return summary;
  }
}

export const outboxManager = new OutboxManager();
