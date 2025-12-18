/**
 * WhatsApp Database Auth State Provider
 *
 * Provides database-backed authentication state storage for Baileys WhatsApp connections.
 * This replaces file-based storage (useMultiFileAuthState) with PostgreSQL JSONB storage.
 *
 * Benefits:
 * - Better for cloud platforms with ephemeral file systems
 * - Easier backups and disaster recovery
 * - Scales better with multiple organizations
 * - No file system clutter (no 800+ pre-key files)
 */

const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');

/**
 * Create database-backed auth state for Baileys
 * @param {number} organizationId - Organization ID
 * @param {Object} pool - PostgreSQL connection pool
 * @returns {Promise<Object>} Auth state object with state and saveCreds function
 */
async function useDatabaseAuthState(organizationId, pool) {
  /**
   * Safely revive serialized Baileys data (handles Buffer payloads)
   * @param {Object|string|null} value - Stored JSON/JSONB value
   * @param {Object} fallback - Default value when parsing fails
   * @returns {Object} Revived object ready for Baileys
   */
  const reviveBaileysJson = (value, fallback) => {
    if (!value) return fallback;

    try {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      return JSON.parse(serialized, BufferJSON.reviver);
    } catch (error) {
      console.error(`Error reviving Baileys JSON for org ${organizationId}:`, error);
      return fallback;
    }
  };

  /**
   * Serialize Baileys objects while preserving Buffer fields
   * @param {Object} value - Value to serialize
   * @returns {string} JSON string with Buffer-safe serialization
   */
  const serializeBaileysJson = (value) => JSON.stringify(value, BufferJSON.replacer);

  /**
   * Load auth state from database
   * @returns {Promise<Object>} Auth state with creds and keys
   */
  const loadState = async () => {
    try {
      const result = await pool.query(
        `SELECT auth_creds, auth_keys FROM whatsapp_baileys_connections
         WHERE organization_id = $1`,
        [organizationId]
      );

      if (result.rows.length === 0) {
        // No existing state - initialize new credentials
        return {
          creds: initAuthCreds(),
          keys: makeKeyStore({})
        };
      }

      const { auth_creds, auth_keys } = result.rows[0];

      // Parse stored credentials with BufferJSON to handle Buffer objects
      const creds = reviveBaileysJson(auth_creds, initAuthCreds());
      const keys = reviveBaileysJson(auth_keys, {});

      return {
        creds,
        keys: makeKeyStore(keys)
      };
    } catch (error) {
      console.error(`Error loading auth state for org ${organizationId}:`, error);
      // Return fresh state if loading fails
      return {
        creds: initAuthCreds(),
        keys: makeKeyStore({})
      };
    }
  };

  /**
   * Save credentials to database
   * @param {Object} creds - Credentials object to save
   */
  const saveCredsToDatabase = async (creds) => {
    try {
      const serializedCreds = serializeBaileysJson(creds);

      await pool.query(
        `INSERT INTO whatsapp_baileys_connections (organization_id, auth_creds, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (organization_id)
         DO UPDATE SET
           auth_creds = $2,
           updated_at = NOW()`,
        [organizationId, serializedCreds]
      );
    } catch (error) {
      console.error(`Error saving creds for org ${organizationId}:`, error);
      throw error;
    }
  };

  /**
   * Create key store interface compatible with Baileys
   * @param {Object} initialKeys - Initial keys object
   * @returns {Object} Key store with get/set methods
   */
  const makeKeyStore = (initialKeys) => {
    // Keep a reference that can be updated
    let keysCache = initialKeys;

    return {
      get: async (type, ids) => {
        const data = {};
        const keys = keysCache[type] || {};

        for (const id of ids) {
          let value = keys[id];
          if (value !== undefined) {
            if (typeof value === 'string') {
              value = JSON.parse(value, BufferJSON.reviver);
            } else {
              value = JSON.parse(JSON.stringify(value), BufferJSON.reviver);
            }
            data[id] = value;
          }
        }

        return data;
      },
      set: async (data) => {
        // Update in-memory cache first
        for (const type in data) {
          if (!keysCache[type]) {
            keysCache[type] = {};
          }
          for (const id in data[type]) {
            const value = data[type][id];
            if (value === null || value === undefined) {
              delete keysCache[type][id];
            } else {
              keysCache[type][id] = value;
            }
          }
        }

        // Then save to database (single query with all keys)
        try {
          const serializedKeys = serializeBaileysJson(keysCache);

          await pool.query(
            `INSERT INTO whatsapp_baileys_connections (organization_id, auth_keys, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (organization_id)
               DO UPDATE SET
                 auth_keys = $2,
                 updated_at = NOW()`,
            [organizationId, serializedKeys]
          );
        } catch (error) {
          console.error(`Error saving keys for org ${organizationId}:`, error);
          throw error;
        }
      }
    };
  };

  // Load initial state
  const state = await loadState();

  return {
    state,
    saveCreds: saveCredsToDatabase
  };
}

module.exports = {
  useDatabaseAuthState
};
