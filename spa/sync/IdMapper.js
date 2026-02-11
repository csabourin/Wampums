/**
 * IdMapper.js
 *
 * Manages temporary-to-server ID mappings for offline-created entities.
 * When an entity is created offline, it gets a temp ID (temp_*).
 * After sync, the server assigns a real ID. This module:
 * - Stores the mapping
 * - Repairs FK references in dependent entities
 * - Cleans up old mappings
 */

import db, { isTempId } from '../data/OfflineDatabase.js';
import { debugLog } from '../utils/DebugUtils.js';

/**
 * FK field to entity type mapping.
 * Used to know which stores to scan for FK repairs.
 */
const FK_REGISTRY = {
  participant_id: {
    entityType: 'participants',
    dependentStores: [
      'attendance',
      'honors',
      'points',
      'badge_progress',
      'medication_requirements',
      'medication_distributions',
      'carpool_assignments',
    ],
  },
  group_id: {
    entityType: 'groups',
    dependentStores: ['participants'],
  },
  activity_id: {
    entityType: 'activities',
    dependentStores: ['carpool_offers'],
  },
  badge_template_id: {
    entityType: 'badge_templates',
    dependentStores: ['badge_progress'],
  },
  medication_requirement_id: {
    entityType: 'medication_requirements',
    dependentStores: ['medication_distributions'],
  },
  carpool_offer_id: {
    entityType: 'carpool_offers',
    dependentStores: ['carpool_assignments'],
  },
  honor_id: {
    entityType: 'honors',
    dependentStores: ['points'],
  },
};

export class IdMapper {
  /**
   * Record a temp-to-server ID mapping.
   *
   * @param {string} entityType - Store name (e.g., 'participants')
   * @param {string} tempId - The temporary ID
   * @param {number|string} serverId - The server-assigned ID
   * @returns {Promise<void>}
   */
  async addMapping(entityType, tempId, serverId) {
    // Check for existing mapping to prevent duplicates
    const existing = await db._idMap
      .where('[entityType+tempId]')
      .equals([entityType, tempId])
      .first();

    if (existing) {
      debugLog(`IdMapper: Mapping already exists for ${entityType}:${tempId} -> ${serverId}`);
      return;
    }

    await db._idMap.add({
      entityType,
      tempId,
      serverId,
      createdAt: Date.now(),
      syncedAt: Date.now(),
    });

    debugLog(`IdMapper: Added mapping ${entityType}:${tempId} -> ${serverId}`);
  }

  /**
   * Get the server ID for a temp ID.
   *
   * @param {string} entityType
   * @param {string} tempId
   * @returns {Promise<number|string|null>}
   */
  async getServerId(entityType, tempId) {
    const mapping = await db._idMap
      .where('[entityType+tempId]')
      .equals([entityType, tempId])
      .first();

    return mapping ? mapping.serverId : null;
  }

  /**
   * Get the temp ID for a server ID.
   *
   * @param {string} entityType
   * @param {number|string} serverId
   * @returns {Promise<string|null>}
   */
  async getTempId(entityType, serverId) {
    const mapping = await db._idMap
      .where('[entityType+serverId]')
      .equals([entityType, serverId])
      .first();

    return mapping ? mapping.tempId : null;
  }

  /**
   * After a temp ID is mapped to a server ID, repair all FK references
   * in dependent entity stores and update the entity's own primary key.
   *
   * @param {string} entityType - The entity type that was just synced
   * @param {string} tempId - The old temp ID
   * @param {number|string} serverId - The new server ID
   * @returns {Promise<{repairedCount: number}>}
   */
  async repairReferences(entityType, tempId, serverId) {
    let repairedCount = 0;

    // 1. Update the entity itself: replace temp ID with server ID
    const store = db[entityType];
    if (store) {
      const entity = await store.get(tempId);
      if (entity) {
        entity.id = serverId;
        entity._dirty = false;
        await store.put(entity);
        await store.delete(tempId);
        repairedCount++;
        debugLog(`IdMapper: Replaced PK ${entityType}:${tempId} -> ${serverId}`);
      }
    }

    // 2. Find all FK fields that reference this entity type
    for (const [fkField, config] of Object.entries(FK_REGISTRY)) {
      if (config.entityType !== entityType) continue;

      // Scan each dependent store for records referencing the temp ID
      for (const depStoreName of config.dependentStores) {
        const depStore = db[depStoreName];
        if (!depStore) continue;

        // Find records with the temp ID in the FK field
        const records = await depStore
          .where(fkField)
          .equals(tempId)
          .toArray();

        for (const record of records) {
          record[fkField] = serverId;
          await depStore.put(record);
          repairedCount++;
        }

        if (records.length > 0) {
          debugLog(
            `IdMapper: Repaired ${records.length} ${fkField} refs in ${depStoreName}: ${tempId} -> ${serverId}`
          );
        }
      }
    }

    // 3. Update outbox entries that reference this temp ID
    const outboxEntries = await db._outbox
      .where('entityType')
      .equals(entityType)
      .filter((e) => e.entityId === tempId)
      .toArray();

    for (const entry of outboxEntries) {
      await db._outbox.update(entry.localId, { entityId: serverId });
      repairedCount++;
    }

    // Also update dependency references in other outbox entries
    const allPending = await db._outbox
      .where('status')
      .equals('pending')
      .toArray();

    for (const entry of allPending) {
      if (!entry.dependencies || entry.dependencies.length === 0) continue;

      let changed = false;
      const updatedDeps = entry.dependencies.map((dep) => {
        if (dep.entityType === entityType && dep.tempId === tempId) {
          changed = true;
          return { ...dep, resolved: true, serverId };
        }
        return dep;
      });

      if (changed) {
        await db._outbox.update(entry.localId, { dependencies: updatedDeps });
      }
    }

    return { repairedCount };
  }

  /**
   * Resolve an ID: if it's a temp ID, return the server ID; otherwise return as-is.
   *
   * @param {string} entityType
   * @param {*} id
   * @returns {Promise<*>}
   */
  async resolveId(entityType, id) {
    if (!isTempId(id)) return id;
    const serverId = await this.getServerId(entityType, id);
    return serverId !== null ? serverId : id;
  }

  /**
   * Purge old ID mappings to save space.
   * @param {number} maxAgeMs - Maximum age in ms (default: 30 days)
   * @returns {Promise<number>} Number purged
   */
  async purgeOldMappings(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;

    const toDelete = await db._idMap
      .filter((m) => m.syncedAt < cutoff)
      .primaryKeys();

    if (toDelete.length > 0) {
      await db._idMap.bulkDelete(toDelete);
      debugLog(`IdMapper: Purged ${toDelete.length} old mappings`);
    }

    return toDelete.length;
  }

  /**
   * Get all current mappings (for debugging/observability).
   * @returns {Promise<Array>}
   */
  async getAllMappings() {
    return db._idMap.toArray();
  }
}

export const idMapper = new IdMapper();
