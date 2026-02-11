/**
 * OfflineDatabase.js
 *
 * Single source of truth for offline storage using Dexie (IndexedDB).
 * Schema mirrors server entities with additional sync infrastructure stores.
 *
 * All reads/writes in the UI go through the Repository layer (see Repository.js),
 * never through direct Dexie calls in feature modules.
 */

import Dexie from 'dexie';
import { debugLog, debugError } from '../utils/DebugUtils.js';

const DB_NAME = 'WampumsOfflineDB';
const DB_VERSION = 1;

/**
 * Create and configure the Dexie database instance.
 * Exported as a singleton.
 */
const db = new Dexie(DB_NAME);

db.version(DB_VERSION).stores({
  // ============================
  // Entity Stores
  // ============================

  // Core entities
  participants: 'id, organization_id, group_id, [organization_id+group_id], _syncVersion',
  groups: 'id, organization_id, _syncVersion',
  activities: 'id, organization_id, activity_date, _syncVersion',

  // Attendance - keyed per participant+date
  attendance: 'id, participant_id, date, [participant_id+date], organization_id, _syncVersion',

  // Recognition
  honors: 'id, participant_id, organization_id, created_at, _syncVersion',
  points: 'id, participant_id, honor_id, _syncVersion',

  // Badges
  badge_templates: 'id, organization_id',
  badge_progress: 'id, participant_id, badge_template_id, status, _syncVersion',

  // Health / Medication (camp-critical)
  medication_requirements: 'id, participant_id, organization_id, _syncVersion',
  medication_distributions: 'id, medication_requirement_id, participant_id, scheduled_for, _syncVersion',

  // Carpools
  carpool_offers: 'id, activity_id, user_id, _syncVersion',
  carpool_assignments: 'id, carpool_offer_id, participant_id, _syncVersion',

  // ============================
  // Sync Infrastructure Stores
  // ============================

  // Outbox: change tracking queue
  _outbox: '++localId, entityType, entityId, operation, timestamp, status, [status+timestamp], correlationId',

  // Temp-to-server ID mapping
  _idMap: '++id, entityType, tempId, serverId, [entityType+tempId], [entityType+serverId]',

  // Sync metadata (last sync time, state, etc.)
  _syncMeta: 'key',

  // Unresolved conflicts
  _conflicts: '++id, entityType, entityId, resolvedAt',
});

/**
 * Generate a temporary ID for offline-created entities.
 * Format: temp_{timestamp}_{random6chars}
 * @returns {string}
 */
export function generateTempId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `temp_${timestamp}_${random}`;
}

/**
 * Check if an ID is a temporary (offline-created) ID.
 * @param {*} id
 * @returns {boolean}
 */
export function isTempId(id) {
  return typeof id === 'string' && id.startsWith('temp_');
}

/**
 * Generate a UUID v4 for correlation IDs.
 * Uses crypto.randomUUID when available, falls back to manual generation.
 * @returns {string}
 */
export function generateCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Delete the offline database entirely.
 * Used on logout to clear all cached data.
 * @returns {Promise<void>}
 */
export async function deleteOfflineDatabase() {
  try {
    await db.delete();
    debugLog('OfflineDatabase: Deleted successfully');
    // Re-open for future use (Dexie requires this after delete)
    await db.open();
  } catch (error) {
    debugError('OfflineDatabase: Failed to delete', error);
    throw error;
  }
}

/**
 * Get database statistics for observability.
 * @returns {Promise<Object>}
 */
export async function getDatabaseStats() {
  try {
    const outboxCount = await db._outbox.count();
    const conflictCount = await db._conflicts.where('resolvedAt').equals(0).count();
    const idMapCount = await db._idMap.count();
    const syncMeta = await db._syncMeta.get('lastSync');

    return {
      outboxPending: outboxCount,
      unresolvedConflicts: conflictCount,
      idMappings: idMapCount,
      lastSyncAt: syncMeta?.value || null,
    };
  } catch (error) {
    debugError('OfflineDatabase: Failed to get stats', error);
    return {
      outboxPending: 0,
      unresolvedConflicts: 0,
      idMappings: 0,
      lastSyncAt: null,
    };
  }
}

export { db };
export default db;
