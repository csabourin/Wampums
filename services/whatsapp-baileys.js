/**
 * WhatsApp Baileys Service
 *
 * Handles WhatsApp connection using Baileys (unofficial WhatsApp Web API)
 * Allows Scout Leaders to connect their personal WhatsApp accounts via QR code
 *
 * IMPORTANT: This uses an unofficial API. Follow these safety rules:
 * 1. No mass broadcasts - Add random delays (2-5 seconds) between messages
 * 2. Contact lists only - Only send to people who have the number saved
 * 3. Warm up new numbers - Use manually for a few days before automation
 * 4. Respect rate limits - Max ~1000 messages per day per number
 */

const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const winston = require('winston');
const { useDatabaseAuthState } = require('./whatsapp-database-auth');
const util = require('util');

const WHATSAPP_LOG_LEVEL = process.env.WHATSAPP_LOG_LEVEL || 'info';
const WHATSAPP_LOG_FILE = process.env.WHATSAPP_LOG_FILE || 'whatsapp-baileys.log';
const ENABLE_WHATSAPP_CONSOLE_LOGS = process.env.WHATSAPP_CONSOLE_LOGS !== 'false';

// Configure logger (keeping defaults lightweight to avoid event-loop thrashing)
const loggerTransports = [
  new winston.transports.File({ filename: WHATSAPP_LOG_FILE, level: WHATSAPP_LOG_LEVEL })
];

if (ENABLE_WHATSAPP_CONSOLE_LOGS) {
  loggerTransports.push(new winston.transports.Console({ format: winston.format.simple(), level: WHATSAPP_LOG_LEVEL }));
}

const logger = winston.createLogger({
  level: WHATSAPP_LOG_LEVEL,
  format: winston.format.json(),
  transports: loggerTransports,
});

// Add trace method for Baileys compatibility
// Baileys expects logger.trace() but Winston doesn't have it by default
logger.trace = (...args) => logger.debug(...args);

/**
 * WhatsApp Baileys Service Class
 * Manages WhatsApp connections for multiple organizations
 */
class WhatsAppBaileysService {
  constructor(pool) {
    this.pool = pool;
    this.connections = new Map(); // organizationId -> connection object
    this.messageQueue = new Map(); // organizationId -> message queue
    this.io = null; // Socket.io instance (will be set later)
    this.cachedBaileysVersion = null; // Cache Baileys version lookup to avoid repeated network calls
    this.baileysVersionPromise = null; // Track in-flight version fetches
    this.reconnectAttempts = new Map(); // organizationId -> { count, lastAttempt }
  }

  /**
   * Get the WhatsApp Web version Baileys should target.
   * Cached to avoid repeated remote lookups which can slow server startup.
   * @returns {Promise<number[]|null>} Version tuple or null when unavailable
   */
  async getBaileysVersion() {
    if (this.cachedBaileysVersion) {
      return this.cachedBaileysVersion;
    }

    if (this.baileysVersionPromise) {
      return this.baileysVersionPromise;
    }

    this.baileysVersionPromise = (async () => {
      try {
        const { version } = await fetchLatestBaileysVersion();
        this.cachedBaileysVersion = version;
        logger.info(`Fetched latest Baileys version: ${version.join('.')}`);
        return version;
      } catch (error) {
        logger.warn('Failed to fetch latest Baileys version; using built-in default', error);
        return this.cachedBaileysVersion; // May be null, allowing Baileys to use its default
      } finally {
        this.baileysVersionPromise = null;
      }
    })();

    return this.baileysVersionPromise;
  }

  /**
   * Set Socket.io instance for real-time QR code delivery
   * @param {SocketIO} io - Socket.io instance
   */
  setSocketIO(io) {
    this.io = io;
    logger.info('Socket.io instance attached to WhatsApp service');
  }

  /**
   * Initialize WhatsApp connection for an organization
   * @param {number} organizationId - Organization ID
   * @param {string} userId - User ID initiating the connection
   * @returns {Promise<boolean>} Success status
   */
  async initializeConnection(organizationId, userId) {
    try {
      logger.info(`Initializing WhatsApp connection for organization ${organizationId}`);

      // Check if already connected OR connection attempt in progress (prevent zombie processes)
      if (this.connections.has(organizationId)) {
        const existingConnection = this.connections.get(organizationId);
        if (existingConnection.isConnected) {
          logger.info(`Organization ${organizationId} already connected`);
          return true;
        }
        if (existingConnection.sock && !existingConnection.sock.ws?.isClosed) {
          logger.info(`Organization ${organizationId} connection already in progress, preventing zombie process`);
          return true;
        }
        // Clean up stale/closed connection
        logger.info(`Cleaning up stale connection for organization ${organizationId}`);
        try {
          if (existingConnection.sock) {
            existingConnection.sock.end();
          }
        } catch (e) {
          // Socket might already be closed, ignore errors
        }
        this.connections.delete(organizationId);
      }

      // Load or create auth state from database
      const { state, saveCreds } = await useDatabaseAuthState(organizationId, this.pool);

      // Get latest Baileys version for compatibility (cached to avoid repeated lookups)
      const version = await this.getBaileysVersion();

      // Create WhatsApp socket
      const sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        logger: logger,
        browser: ['Wampums', 'Chrome', '10.0'], // Custom browser name
        getMessage: async (key) => {
          // Implement message retrieval if needed
          return { conversation: '' };
        }
      });

      // Store connection info
      this.connections.set(organizationId, {
        sock,
        isConnected: false,
        organizationId,
        userId,
        qrCode: null,
      });

      // Handle QR code generation
      sock.ev.on('connection.update', async (update) => {
        await this.handleConnectionUpdate(organizationId, update, saveCreds);
      });

      // Handle credentials update
      sock.ev.on('creds.update', saveCreds);

      // Handle messages (optional - for receiving messages)
      sock.ev.on('messages.upsert', async ({ messages }) => {
        logger.info(`Received ${messages.length} messages for org ${organizationId}`);
        // Handle incoming messages if needed
      });

      return true;
    } catch (error) {
      logger.error(`Error initializing WhatsApp connection for org ${organizationId}:`, error);
      throw error;
    }
  }

  /**
   * Handle connection status updates
   * @param {number} organizationId - Organization ID
   * @param {object} update - Connection update object
   * @param {function} saveCreds - Save credentials function
   */
  async handleConnectionUpdate(organizationId, update, saveCreds) {
    const { connection, lastDisconnect, qr } = update;
    const connectionObj = this.connections.get(organizationId);

    if (!connectionObj) return;

    // QR code generated - send to frontend
    if (qr) {
      logger.info(`QR code generated for organization ${organizationId}`);

      try {
        // Generate QR code as data URL for frontend display
        const qrDataURL = await qrcode.toDataURL(qr);
        connectionObj.qrCode = qrDataURL;

        // Emit QR code via Socket.io
        if (this.io) {
          this.io.to(`org-${organizationId}`).emit('whatsapp-qr', {
            qrCode: qrDataURL,
            organizationId,
          });
          logger.info(`QR code emitted via Socket.io for org ${organizationId}`);
        }

        // Also display in terminal for debugging
        console.log('\n=== WhatsApp QR Code ===');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('========================\n');
      } catch (error) {
        logger.error(`Error generating QR code for org ${organizationId}:`, error);
      }
    }

    // Connection opened - save to database
    if (connection === 'open') {
      logger.info(`WhatsApp connected successfully for organization ${organizationId}`);
      connectionObj.isConnected = true;

      // Reset reconnect attempts on successful connection
      this.reconnectAttempts.delete(organizationId);

      try {
        // Get phone number from connection
        const phoneNumber = connectionObj.sock.user?.id?.split(':')[0] || null;

        // Save connection status to database
        await this.pool.query(
          `INSERT INTO whatsapp_baileys_connections
           (organization_id, is_connected, connected_phone_number, last_connected_at, updated_at)
           VALUES ($1, TRUE, $2, NOW(), NOW())
           ON CONFLICT (organization_id)
           DO UPDATE SET
             is_connected = TRUE,
             connected_phone_number = EXCLUDED.connected_phone_number,
             last_connected_at = NOW(),
             updated_at = NOW()`,
          [organizationId, phoneNumber ? `+${phoneNumber}` : null]
        );

        // Emit success event via Socket.io
        if (this.io) {
          this.io.to(`org-${organizationId}`).emit('whatsapp-connected', {
            success: true,
            phoneNumber: phoneNumber ? `+${phoneNumber}` : null,
            organizationId,
          });
        }

        logger.info(`Connection saved to database for org ${organizationId}, phone: ${phoneNumber}`);
      } catch (error) {
        logger.error(`Error saving connection to database for org ${organizationId}:`, error);
      }
    }

    // Connection closed - handle reconnection
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
      const disconnectMessage = lastDisconnect?.error?.message || '';
      const handshakeFailure = disconnectMessage.includes('processHandshake') || disconnectMessage.includes("reading 'public'");

      // Error 515 (Stream Errored) is often temporary - WhatsApp may have multiple connections with same session
      // This should trigger reconnection WITHOUT clearing credentials
      const isTemporaryError = statusCode === 515;

      // Error 401 (Connection Failure) means credentials are unauthorized - clear credentials
      const credentialRejection = statusCode === 401;

      // Error 440 (conflict/replaced) means another session has replaced this one
      // Do NOT auto-reconnect - this creates an infinite reconnection loop
      const isConflictError = statusCode === 440 || disconnectMessage.includes('conflict');

      // Maximum reconnection attempts to prevent infinite loops
      const MAX_RECONNECT_ATTEMPTS = 5;

      // Should reconnect for temporary errors (515), connection issues, but NOT for logout/bad session/conflict
      const shouldReconnect = (statusCode !== DisconnectReason.loggedOut &&
        statusCode !== DisconnectReason.badSession &&
        statusCode !== undefined &&
        !handshakeFailure &&
        !credentialRejection &&
        !isConflictError) || isTemporaryError;

      logger.info(
        `Connection closed for org ${organizationId}. Reconnect: ${shouldReconnect}. Status: ${statusCode}${isTemporaryError ? ' (temporary error - will reconnect)' : ''}${credentialRejection ? ' (credential rejection)' : ''}${isConflictError ? ' (conflict - session replaced, NOT reconnecting)' : ''}`,
        { lastDisconnect: util.inspect(lastDisconnect, { depth: 3 }) }
      );

      if (shouldReconnect) {
        // Get or initialize reconnect attempts
        const reconnectInfo = this.reconnectAttempts.get(organizationId) || { count: 0, lastAttempt: 0 };
        const now = Date.now();
        const timeSinceLastAttempt = now - reconnectInfo.lastAttempt;

        // Reset counter if it's been more than 5 minutes since last attempt
        if (timeSinceLastAttempt > 5 * 60 * 1000) {
          reconnectInfo.count = 0;
        }

        reconnectInfo.count++;
        reconnectInfo.lastAttempt = now;
        this.reconnectAttempts.set(organizationId, reconnectInfo);

        // Stop reconnecting after MAX_RECONNECT_ATTEMPTS to prevent resource exhaustion
        if (reconnectInfo.count > MAX_RECONNECT_ATTEMPTS) {
          logger.warn(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached for org ${organizationId}. Stopping auto-reconnect.`);
          this.reconnectAttempts.delete(organizationId);
          connectionObj.isConnected = false;
          
          // Emit event so UI can show manual reconnect option
          if (this.io) {
            this.io.to(`org-${organizationId}`).emit('whatsapp-disconnected', {
              organizationId,
              reason: 'max_reconnect_attempts',
            });
          }
          return;
        }

        // Exponential backoff: 3s, 6s, 12s, 24s, 48s (max)
        const baseDelay = 3000;
        const maxDelay = 48000;
        const backoffDelay = Math.min(baseDelay * Math.pow(2, reconnectInfo.count - 1), maxDelay);

        logger.info(`Reconnecting org ${organizationId} (attempt ${reconnectInfo.count}/${MAX_RECONNECT_ATTEMPTS}) in ${backoffDelay}ms`);

        // Reconnect automatically with existing credentials (without deleting keys)
        setTimeout(() => {
          this.initializeConnection(organizationId, connectionObj.userId);
        }, backoffDelay);
        return;
      }

      // Reset reconnect attempts on permanent disconnection
      this.reconnectAttempts.delete(organizationId);

      // Logged out, bad session, handshake failure, conflict, or credential rejection - clean up
      connectionObj.isConnected = false;

      // For conflict errors, don't clear credentials - just stop reconnecting
      if (isConflictError) {
        logger.info(`Conflict detected for org ${organizationId}. Session replaced by another device. Not clearing credentials.`);
        if (this.io) {
          this.io.to(`org-${organizationId}`).emit('whatsapp-disconnected', {
            organizationId,
            reason: 'conflict_replaced',
          });
        }
        return;
      }

      try {
        await this.clearAuthState(organizationId);

        // Emit disconnection event
        if (this.io) {
          this.io.to(`org-${organizationId}`).emit('whatsapp-disconnected', {
            organizationId,
            reason: credentialRejection ? 'credential_rejected' : handshakeFailure ? 'handshake_failed' : statusCode === DisconnectReason.loggedOut ? 'logged_out' : 'invalid_session',
          });
        }

        // Automatically generate fresh QR for credential rejection or handshake failure
        if ((credentialRejection || handshakeFailure) && connectionObj.userId) {
          logger.info(`Generating fresh QR code for org ${organizationId} after ${credentialRejection ? 'credential rejection' : 'handshake failure'}`);
          setTimeout(() => {
            this.initializeConnection(organizationId, connectionObj.userId);
          }, 1000);
        }
      } catch (error) {
        logger.error(`Error updating disconnection in database for org ${organizationId}:`, error);
      }
    }
  }

  /**
   * Disconnect WhatsApp for an organization
   * @param {number} organizationId - Organization ID
   * @returns {Promise<boolean>} Success status
   */
  async disconnect(organizationId) {
    try {
      logger.info(`Disconnecting WhatsApp for organization ${organizationId}`);

      const connectionObj = this.connections.get(organizationId);
      if (!connectionObj) {
        logger.warn(`No connection found for organization ${organizationId}`);
        return false;
      }

      // MEMORY LEAK FIX: Remove all event listeners before logout
      if (connectionObj.sock) {
        try {
          connectionObj.sock.ev.removeAllListeners();
        } catch (e) {
          // Ignore if already removed
        }
        await connectionObj.sock.logout();
      }

      // Remove from connections map
      this.connections.delete(organizationId);

      // Clear auth data from database and mark as disconnected
      await this.clearAuthState(organizationId);
      logger.info(`Auth data cleared from database for org ${organizationId}`);

      logger.info(`WhatsApp disconnected successfully for organization ${organizationId}`);
      return true;
    } catch (error) {
      logger.error(`Error disconnecting WhatsApp for org ${organizationId}:`, error);
      throw error;
    }
  }

  /**
   * Send WhatsApp message with rate limiting
   * @param {number} organizationId - Organization ID
   * @param {string} phoneNumber - Recipient phone number in E.164 format
   * @param {string} message - Message text
   * @returns {Promise<{success: boolean, error?: string}>} Result with success status and optional error message
   */
  async sendMessage(organizationId, phoneNumber, message) {
    try {
      const connectionObj = this.connections.get(organizationId);

      if (!connectionObj || !connectionObj.isConnected) {
        logger.warn(`WhatsApp not connected for organization ${organizationId}`);
        return { 
          success: false, 
          error: 'WhatsApp is not connected. Please reconnect via QR code.' 
        };
      }

      // Format phone number for WhatsApp (remove + and add @s.whatsapp.net)
      const formattedNumber = phoneNumber.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

      // Add random delay to avoid rate limiting (2-5 seconds)
      const delay = Math.floor(Math.random() * 3000) + 2000;
      await new Promise(resolve => setTimeout(resolve, delay));

      // Send message with comprehensive error handling
      try {
        await connectionObj.sock.sendMessage(formattedNumber, { text: message });
        logger.info(`Message sent successfully to ${phoneNumber} for org ${organizationId}`);
        return { success: true };
      } catch (sendError) {
        logger.error(`Baileys error sending message for org ${organizationId}:`, sendError);
        
        // Parse Baileys-specific errors
        const errorMessage = sendError.message || String(sendError);
        
        // Session expired or corrupted
        if (errorMessage.includes('tctoken') || 
            errorMessage.includes('session') || 
            errorMessage.includes('invalid children') ||
            errorMessage.includes('not open')) {
          
          logger.warn(`WhatsApp session corrupted for org ${organizationId}, clearing connection`);
          
          // Clear the corrupted session
          try {
            await this.clearAuthState(organizationId);
            this.connections.delete(organizationId);
          } catch (cleanupError) {
            logger.error(`Error cleaning up corrupted session for org ${organizationId}:`, cleanupError);
          }
          
          return { 
            success: false, 
            error: 'WhatsApp session expired or corrupted. Please disconnect and reconnect via QR code.' 
          };
        }
        
        // Rate limiting
        if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
          return { 
            success: false, 
            error: 'WhatsApp rate limit reached. Please wait before sending more messages.' 
          };
        }
        
        // Invalid phone number
        if (errorMessage.includes('jid') || errorMessage.includes('invalid number')) {
          return { 
            success: false, 
            error: 'Invalid phone number format. Use international format (e.g., +15551234567).' 
          };
        }
        
        // Generic Baileys error
        return { 
          success: false, 
          error: `Failed to send message: ${errorMessage.substring(0, 100)}` 
        };
      }
    } catch (error) {
      logger.error(`Unexpected error in sendMessage for org ${organizationId}:`, error);
      return { 
        success: false, 
        error: 'An unexpected error occurred. Please try again or reconnect WhatsApp.' 
      };
    }
  }

  /**
   * Check if organization has active WhatsApp connection
   * @param {number} organizationId - Organization ID
   * @returns {Promise<boolean>} Connection status
   */
  async isConnected(organizationId) {
    const connectionObj = this.connections.get(organizationId);
    if (connectionObj && connectionObj.isConnected) {
      return true;
    }

    // Check database
    try {
      const result = await this.pool.query(
        `SELECT is_connected FROM whatsapp_baileys_connections
         WHERE organization_id = $1`,
        [organizationId]
      );

      const dbConnected = result.rows.length > 0 && result.rows[0].is_connected;

      if (dbConnected && !connectionObj) {
        // Database says connected but runtime has no socket; clear state to allow fresh QR
        logger.warn(`Stale WhatsApp connection state detected for org ${organizationId}; clearing auth state`);
        await this.clearAuthState(organizationId);
        return false;
      }

      return dbConnected;
    } catch (error) {
      logger.error(`Error checking connection status for org ${organizationId}:`, error);
      return false;
    }
  }

  /**
   * Get connection info for an organization
   * @param {number} organizationId - Organization ID
   * @returns {Promise<object|null>} Connection info
   */
  async getConnectionInfo(organizationId) {
    try {
      const result = await this.pool.query(
        `SELECT * FROM whatsapp_baileys_connections
         WHERE organization_id = $1`,
        [organizationId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const dbInfo = result.rows[0];
      const connectionObj = this.connections.get(organizationId);

      return {
        isConnected: dbInfo.is_connected,
        connectedPhoneNumber: dbInfo.connected_phone_number,
        lastConnectedAt: dbInfo.last_connected_at,
        lastDisconnectedAt: dbInfo.last_disconnected_at,
        qrCode: connectionObj?.qrCode || null,
      };
    } catch (error) {
      logger.error(`Error getting connection info for org ${organizationId}:`, error);
      return null;
    }
  }

  /**
   * Restore existing connections on server restart
   * @returns {Promise<void>}
   */
  async restoreConnections() {
    try {
      logger.info('Restoring WhatsApp connections from database...');

      const result = await this.pool.query(
        `SELECT organization_id FROM whatsapp_baileys_connections
         WHERE is_connected = TRUE`
      );

      for (const row of result.rows) {
        const organizationId = row.organization_id;
        logger.info(`Restoring connection for organization ${organizationId}`);

        try {
          await this.initializeConnection(organizationId, 'system');
        } catch (error) {
          logger.error(`Failed to restore connection for org ${organizationId}:`, error);
        }
      }

      logger.info(`Restored ${result.rows.length} WhatsApp connections`);
    } catch (error) {
      logger.error('Error restoring WhatsApp connections:', error);
    }
  }

  /**
   * Disconnect socket and remove connection object
   * Private helper to avoid code duplication between clearAuthState and cleanupOrganization
   * @private
   * @param {number} organizationId - Organization ID
   */
  _disconnectSocket(organizationId) {
    if (this.connections.has(organizationId)) {
      const connectionObj = this.connections.get(organizationId);
      if (connectionObj.sock) {
        try {
          // MEMORY LEAK FIX: Remove all event listeners before closing
          connectionObj.sock.ev.removeAllListeners();
          connectionObj.sock.end();
        } catch (e) {
          // Socket might already be closed, ignore errors
        }
      }
      this.connections.delete(organizationId);
    }
  }

  /**
   * Clear stored WhatsApp authentication state to force a fresh pairing
   * @param {number} organizationId - Organization ID
   * @returns {Promise<void>}
   */
  async clearAuthState(organizationId) {
    try {
      await this.pool.query(
        `UPDATE whatsapp_baileys_connections
         SET is_connected = FALSE,
             last_disconnected_at = NOW(),
             auth_creds = '{}',
             auth_keys = '{}',
             updated_at = NOW()
         WHERE organization_id = $1`,
        [organizationId]
      );

      // Use private helper to disconnect socket
      this._disconnectSocket(organizationId);

      // Also clean up reconnect attempts and message queue for this org
      this.reconnectAttempts.delete(organizationId);
      this.messageQueue.delete(organizationId);
    } catch (error) {
      logger.error(`Error clearing WhatsApp auth state for org ${organizationId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up all data for an organization (call when org is deleted)
   * @param {number} organizationId - Organization ID
   * @returns {Promise<void>}
   */
  async cleanupOrganization(organizationId) {
    logger.info(`Cleaning up WhatsApp data for organization ${organizationId}`);

    // Reuse auth + connection cleanup logic to ensure consistent behavior
    try {
      await this.clearAuthState(organizationId);
    } catch (error) {
      // Log but don't re-throw to ensure cleanup continues
      logger.warn(`Warning during auth state cleanup for org ${organizationId}:`, error);
    }

    logger.info(`WhatsApp cleanup complete for organization ${organizationId}`);
  }

  /**
   * Graceful shutdown - clean up all connections
   * Call this when the server is shutting down
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('WhatsApp Baileys service shutting down...');

    // Close all active connections
    for (const [organizationId, connectionObj] of this.connections) {
      try {
        if (connectionObj.sock) {
          connectionObj.sock.ev.removeAllListeners();
          connectionObj.sock.end();
        }
        logger.info(`Closed WhatsApp connection for org ${organizationId}`);
      } catch (error) {
        logger.error(`Error closing WhatsApp connection for org ${organizationId}:`, error);
      }
    }

    // Clear all Maps
    this.connections.clear();
    this.messageQueue.clear();
    this.reconnectAttempts.clear();

    logger.info('WhatsApp Baileys service shutdown complete');
  }
}

module.exports = WhatsAppBaileysService;
