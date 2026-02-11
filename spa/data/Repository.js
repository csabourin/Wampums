/**
 * Repository.js
 *
 * Generic Repository/DAO layer providing offline-first CRUD operations.
 * All UI reads/writes go through repositories - no direct DB calls elsewhere.
 *
 * Each repository instance is bound to a single entity store and encapsulates:
 * - Local reads from Dexie
 * - Local writes with automatic outbox event creation
 * - Temp ID generation for offline creates
 * - Query filtering by organization_id
 */

import db, { generateTempId, generateCorrelationId, isTempId } from './OfflineDatabase.js';
import { debugLog } from '../utils/DebugUtils.js';

/**
 * @typedef {Object} RepositoryOptions
 * @property {string} storeName - Dexie store name (e.g., 'participants')
 * @property {string} idField - Primary key field name (default: 'id')
 * @property {boolean} useIntegerId - Whether server IDs are integers (default: true)
 * @property {string} conflictStrategy - 'lww' | 'field_merge' | 'user_resolution' | 'create_wins'
 */

export class Repository {
  /**
   * @param {RepositoryOptions} options
   */
  constructor(options) {
    this.storeName = options.storeName;
    this.idField = options.idField || 'id';
    this.useIntegerId = options.useIntegerId !== false;
    this.conflictStrategy = options.conflictStrategy || 'lww';
  }

  /**
   * Get the Dexie table for this repository.
   * @returns {import('dexie').Table}
   */
  get table() {
    return db[this.storeName];
  }

  // =============================
  // READ OPERATIONS (local-first)
  // =============================

  /**
   * Get a single entity by ID.
   * @param {number|string} id
   * @returns {Promise<Object|undefined>}
   */
  async getById(id) {
    return this.table.get(id);
  }

  /**
   * Get all entities for an organization.
   * @param {number} organizationId
   * @returns {Promise<Array>}
   */
  async getAllByOrganization(organizationId) {
    return this.table.where('organization_id').equals(organizationId).toArray();
  }

  /**
   * Get all entities (no filter).
   * @returns {Promise<Array>}
   */
  async getAll() {
    return this.table.toArray();
  }

  /**
   * Query entities with a Dexie where clause.
   * @param {string} index - Index name
   * @param {*} value - Value to match
   * @returns {Promise<Array>}
   */
  async getByIndex(index, value) {
    return this.table.where(index).equals(value).toArray();
  }

  /**
   * Query with compound index.
   * @param {string} index - Compound index name e.g. '[participant_id+date]'
   * @param {Array} values - Values matching the compound key
   * @returns {Promise<Array>}
   */
  async getByCompoundIndex(index, values) {
    return this.table.where(index).equals(values).toArray();
  }

  /**
   * Count entities matching a filter.
   * @param {string} index
   * @param {*} value
   * @returns {Promise<number>}
   */
  async countByIndex(index, value) {
    return this.table.where(index).equals(value).count();
  }

  // =============================
  // WRITE OPERATIONS (with outbox)
  // =============================

  /**
   * Create a new entity locally and record in outbox.
   * Assigns a temp ID if offline-created.
   *
   * @param {Object} data - Entity data (without ID for new entities)
   * @param {Object} [options]
   * @param {boolean} [options.isServerData] - True if this is data from the server (no outbox entry)
   * @returns {Promise<Object>} The created entity with its ID
   */
  async create(data, options = {}) {
    const { isServerData = false } = options;

    const entity = { ...data };

    // Assign temp ID for offline creates
    if (!entity[this.idField]) {
      entity[this.idField] = generateTempId();
    }

    // Set sync metadata
    if (!isServerData) {
      entity._dirty = true;
      entity._localUpdatedAt = Date.now();
    }
    entity._syncVersion = entity._syncVersion || 0;

    await db.transaction('rw', [this.table, db._outbox], async () => {
      await this.table.put(entity);

      if (!isServerData) {
        await db._outbox.add({
          correlationId: generateCorrelationId(),
          entityType: this.storeName,
          entityId: entity[this.idField],
          tempId: isTempId(entity[this.idField]) ? entity[this.idField] : null,
          operation: 'create',
          timestamp: Date.now(),
          payload: entity,
          dependencies: this._extractDependencies(entity),
          status: 'pending',
          retryCount: 0,
          lastError: null,
          serverResponse: null,
        });
      }
    });

    debugLog(`Repository[${this.storeName}]: Created`, entity[this.idField]);
    return entity;
  }

  /**
   * Update an existing entity locally and record in outbox.
   *
   * @param {number|string} id - Entity ID
   * @param {Object} patch - Fields to update
   * @param {Object} [options]
   * @param {boolean} [options.isServerData] - True if from server
   * @returns {Promise<Object>} Updated entity
   */
  async update(id, patch, options = {}) {
    const { isServerData = false } = options;

    let updatedEntity;

    await db.transaction('rw', [this.table, db._outbox], async () => {
      const existing = await this.table.get(id);
      if (!existing) {
        throw new Error(`${this.storeName}[${id}] not found for update`);
      }

      updatedEntity = { ...existing, ...patch };

      if (!isServerData) {
        updatedEntity._dirty = true;
        updatedEntity._localUpdatedAt = Date.now();
      } else {
        updatedEntity._dirty = false;
      }

      await this.table.put(updatedEntity);

      if (!isServerData) {
        await db._outbox.add({
          correlationId: generateCorrelationId(),
          entityType: this.storeName,
          entityId: id,
          tempId: isTempId(id) ? id : null,
          operation: 'update',
          timestamp: Date.now(),
          payload: patch,
          dependencies: this._extractDependencies(updatedEntity),
          status: 'pending',
          retryCount: 0,
          lastError: null,
          serverResponse: null,
        });
      }
    });

    debugLog(`Repository[${this.storeName}]: Updated`, id);
    return updatedEntity;
  }

  /**
   * Delete an entity locally and record in outbox.
   *
   * @param {number|string} id - Entity ID
   * @param {Object} [options]
   * @param {boolean} [options.isServerData] - True if from server
   * @returns {Promise<void>}
   */
  async remove(id, options = {}) {
    const { isServerData = false } = options;

    await db.transaction('rw', [this.table, db._outbox], async () => {
      // For temp IDs (never synced), just delete locally and remove outbox entries
      if (isTempId(id)) {
        await this.table.delete(id);
        await db._outbox.where({ entityType: this.storeName, entityId: id }).delete();
        return;
      }

      await this.table.delete(id);

      if (!isServerData) {
        await db._outbox.add({
          correlationId: generateCorrelationId(),
          entityType: this.storeName,
          entityId: id,
          tempId: null,
          operation: 'delete',
          timestamp: Date.now(),
          payload: null,
          dependencies: [],
          status: 'pending',
          retryCount: 0,
          lastError: null,
          serverResponse: null,
        });
      }
    });

    debugLog(`Repository[${this.storeName}]: Deleted`, id);
  }

  // =============================
  // BULK OPERATIONS (server data)
  // =============================

  /**
   * Bulk upsert entities from server (no outbox entries).
   * Used during sync pull phase.
   *
   * @param {Array<Object>} entities
   * @returns {Promise<void>}
   */
  async bulkUpsert(entities) {
    if (!entities || entities.length === 0) return;

    const prepared = entities.map((e) => ({
      ...e,
      _dirty: false,
      _syncVersion: (e._syncVersion || 0) + 1,
    }));

    await this.table.bulkPut(prepared);
    debugLog(`Repository[${this.storeName}]: Bulk upserted ${prepared.length} entities`);
  }

  /**
   * Replace all entities for an organization (full refresh from server).
   *
   * @param {number} organizationId
   * @param {Array<Object>} entities
   * @returns {Promise<void>}
   */
  async replaceAllForOrganization(organizationId, entities) {
    await db.transaction('rw', this.table, async () => {
      // Delete existing for this org (preserving dirty local records)
      const existing = await this.table
        .where('organization_id')
        .equals(organizationId)
        .toArray();

      const dirtyIds = new Set(
        existing.filter((e) => e._dirty).map((e) => e[this.idField])
      );

      // Delete non-dirty records
      const toDelete = existing
        .filter((e) => !dirtyIds.has(e[this.idField]))
        .map((e) => e[this.idField]);

      if (toDelete.length > 0) {
        await this.table.bulkDelete(toDelete);
      }

      // Upsert server data (skip dirty local records)
      const toUpsert = entities
        .filter((e) => !dirtyIds.has(e[this.idField]))
        .map((e) => ({ ...e, _dirty: false, _syncVersion: (e._syncVersion || 0) + 1 }));

      if (toUpsert.length > 0) {
        await this.table.bulkPut(toUpsert);
      }
    });

    debugLog(`Repository[${this.storeName}]: Replaced for org ${organizationId}, ${entities.length} entities`);
  }

  /**
   * Clear all data in this store.
   * @returns {Promise<void>}
   */
  async clear() {
    await this.table.clear();
    debugLog(`Repository[${this.storeName}]: Cleared`);
  }

  // =============================
  // HELPER METHODS
  // =============================

  /**
   * Extract dependency references from an entity for outbox ordering.
   * Override in subclasses for entity-specific logic.
   *
   * @param {Object} entity
   * @returns {Array<{entityType: string, id: *}>}
   */
  _extractDependencies(entity) {
    const deps = [];

    // Common FK patterns
    if (entity.participant_id && isTempId(entity.participant_id)) {
      deps.push({ entityType: 'participants', tempId: entity.participant_id });
    }
    if (entity.group_id && isTempId(entity.group_id)) {
      deps.push({ entityType: 'groups', tempId: entity.group_id });
    }
    if (entity.activity_id && isTempId(entity.activity_id)) {
      deps.push({ entityType: 'activities', tempId: entity.activity_id });
    }
    if (entity.badge_template_id && isTempId(entity.badge_template_id)) {
      deps.push({ entityType: 'badge_templates', tempId: entity.badge_template_id });
    }
    if (entity.medication_requirement_id && isTempId(entity.medication_requirement_id)) {
      deps.push({ entityType: 'medication_requirements', tempId: entity.medication_requirement_id });
    }
    if (entity.carpool_offer_id && isTempId(entity.carpool_offer_id)) {
      deps.push({ entityType: 'carpool_offers', tempId: entity.carpool_offer_id });
    }
    if (entity.honor_id && isTempId(entity.honor_id)) {
      deps.push({ entityType: 'honors', tempId: entity.honor_id });
    }

    return deps;
  }
}

// =============================
// PRE-CONFIGURED REPOSITORIES
// =============================

export const participantRepo = new Repository({
  storeName: 'participants',
  conflictStrategy: 'field_merge',
});

export const groupRepo = new Repository({
  storeName: 'groups',
  conflictStrategy: 'lww',
});

export const activityRepo = new Repository({
  storeName: 'activities',
  conflictStrategy: 'lww',
});

export const attendanceRepo = new Repository({
  storeName: 'attendance',
  conflictStrategy: 'lww',
});

export const honorRepo = new Repository({
  storeName: 'honors',
  conflictStrategy: 'create_wins',
});

export const pointsRepo = new Repository({
  storeName: 'points',
  conflictStrategy: 'lww',
});

export const badgeTemplateRepo = new Repository({
  storeName: 'badge_templates',
  conflictStrategy: 'lww',
});

export const badgeProgressRepo = new Repository({
  storeName: 'badge_progress',
  conflictStrategy: 'lww',
});

export const medicationRequirementRepo = new Repository({
  storeName: 'medication_requirements',
  conflictStrategy: 'user_resolution',
});

export const medicationDistributionRepo = new Repository({
  storeName: 'medication_distributions',
  conflictStrategy: 'lww',
});

export const carpoolOfferRepo = new Repository({
  storeName: 'carpool_offers',
  conflictStrategy: 'lww',
});

export const carpoolAssignmentRepo = new Repository({
  storeName: 'carpool_assignments',
  conflictStrategy: 'lww',
});

/**
 * Map of store names to repository instances for programmatic access.
 */
export const repositories = {
  participants: participantRepo,
  groups: groupRepo,
  activities: activityRepo,
  attendance: attendanceRepo,
  honors: honorRepo,
  points: pointsRepo,
  badge_templates: badgeTemplateRepo,
  badge_progress: badgeProgressRepo,
  medication_requirements: medicationRequirementRepo,
  medication_distributions: medicationDistributionRepo,
  carpool_offers: carpoolOfferRepo,
  carpool_assignments: carpoolAssignmentRepo,
};
