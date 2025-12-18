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
   * Ensure credentials contain all required key pairs so Baileys can complete the handshake.
   * Falls back to fresh creds when any required field is missing.
   * @param {Object} creds - Candidate creds loaded from storage
   * @returns {{creds: Object, refreshed: boolean}} Creds safe for Baileys and flag when regenerated
   */
  const ensureValidCreds = (creds) => {
    const baseCreds = initAuthCreds();
    const merged = {
      ...baseCreds,
      ...creds,
      noiseKey: creds?.noiseKey || baseCreds.noiseKey,
      signedIdentityKey: creds?.signedIdentityKey || baseCreds.signedIdentityKey,
      signedPreKey: creds?.signedPreKey || baseCreds.signedPreKey,
    };

    // NOTE: Baileys v7+ does NOT create an "identityKey" field - only "signedIdentityKey"
    // Previous validation incorrectly checked for identityKey which doesn't exist
    const hasRequiredKeys = Boolean(
      merged?.noiseKey?.private &&
      merged?.noiseKey?.public &&
      merged?.signedIdentityKey?.private &&
      merged?.signedIdentityKey?.public &&
      merged?.signedPreKey?.keyPair?.private &&
      merged?.signedPreKey?.keyPair?.public &&
      typeof merged?.registrationId === 'number'
    );

    if (!hasRequiredKeys) {
      return { creds: baseCreds, refreshed: true };
    }

    return { creds: merged, refreshed: false };
  };

  /**
   * Reset stored WhatsApp credentials/keys for an organization
   * Used when existing rows are malformed so a fresh QR can be generated
   * @param {Object} [freshCreds] - Optional creds payload to persist instead of empty placeholders
   * @returns {Promise<Object>} The creds stored after reset
   */
  const resetAuthRow = async (freshCreds = initAuthCreds()) => {
    console.log(`[RESET AUTH] Resetting auth for org ${organizationId}`);
    console.log(`[RESET AUTH] Fresh creds keys: ${Object.keys(freshCreds).join(', ')}`);
    console.log(`[RESET AUTH] Has noiseKey: ${!!freshCreds.noiseKey}, registrationId: ${freshCreds.registrationId}`);

    const serializedCreds = serializeBaileysJson(freshCreds);

    await pool.query(
      `INSERT INTO whatsapp_baileys_connections (organization_id, auth_creds, auth_keys, is_connected, updated_at, last_disconnected_at)
       VALUES ($1, $2, '{}', FALSE, NOW(), NOW())
       ON CONFLICT (organization_id)
       DO UPDATE SET
         auth_creds = $2,
         auth_keys = '{}',
         is_connected = FALSE,
         updated_at = NOW(),
         last_disconnected_at = NOW()`,
      [organizationId, serializedCreds]
    );

    console.log(`[RESET AUTH] ✅ Saved fresh credentials to database`);

    return freshCreds;
  };

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
        const baseCreds = await resetAuthRow();
        return {
          creds: baseCreds,
          keys: makeKeyStore({})
        };
      }

      const { auth_creds, auth_keys } = result.rows[0];

      // Parse stored credentials with BufferJSON to handle Buffer objects
      const revivedCreds = reviveBaileysJson(auth_creds, initAuthCreds());
      const { creds, refreshed } = ensureValidCreds(revivedCreds);
      const keys = reviveBaileysJson(auth_keys, {});

      if (refreshed) {
        console.warn(`Resetting WhatsApp creds for org ${organizationId} due to missing key material`);
        await resetAuthRow(creds);
      }

      return {
        creds,
        keys: makeKeyStore(keys)
      };
    } catch (error) {
      console.error(`Error loading auth state for org ${organizationId}:`, error);
      // Clear malformed row so a fresh QR can be generated on next init
      try {
        const baseCreds = await resetAuthRow();
        return {
          creds: baseCreds,
          keys: makeKeyStore({})
        };
      } catch (resetError) {
        console.error(`Error resetting malformed auth row for org ${organizationId}:`, resetError);
      }
      // Return fresh state if loading fails
      return {
        creds: initAuthCreds(),
        keys: makeKeyStore({})
      };
    }
  };

  /**
   * Save credentials to database
   * IMPORTANT: Merges updates with existing credentials instead of replacing them
   * The creds.update event only sends changed fields, not the full credentials object
   * @param {Object} creds - Credentials object with updates to save
   */
  const saveCredsToDatabase = async (creds) => {
    try {
      console.log(`[CREDS SAVE] Saving credentials for org ${organizationId}`);
      console.log(`[CREDS SAVE] Update keys: ${Object.keys(creds).join(', ')}`);

      // Load existing credentials from database
      const result = await pool.query(
        `SELECT auth_creds FROM whatsapp_baileys_connections WHERE organization_id = $1`,
        [organizationId]
      );

      let existingCreds = {};
      if (result.rows.length > 0 && result.rows[0].auth_creds) {
        existingCreds = reviveBaileysJson(result.rows[0].auth_creds, {});
        console.log(`[CREDS SAVE] Existing creds keys: ${Object.keys(existingCreds).join(', ')}`);
      } else {
        console.log(`[CREDS SAVE] No existing credentials found`);
      }

      // Merge updates with existing credentials
      // This preserves encryption keys when only the 'me' field is updated during pairing
      const mergedCreds = {
        ...existingCreds,
        ...creds
      };
      console.log(`[CREDS SAVE] Merged creds keys: ${Object.keys(mergedCreds).join(', ')}`);
      console.log(`[CREDS SAVE] Has noiseKey: ${!!mergedCreds.noiseKey}, Has me: ${!!mergedCreds.me}`);

      const serializedCreds = serializeBaileysJson(mergedCreds);

      await pool.query(
        `INSERT INTO whatsapp_baileys_connections (organization_id, auth_creds, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (organization_id)
         DO UPDATE SET
           auth_creds = $2,
           updated_at = NOW()`,
        [organizationId, serializedCreds]
      );

      console.log(`[CREDS SAVE] ✅ Successfully saved merged credentials`);
    } catch (error) {
      console.error(`[CREDS SAVE] ❌ Error saving creds for org ${organizationId}:`, error);
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
