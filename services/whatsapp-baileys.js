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

// Configure logger
const logger = winston.createLogger({
  level: 'debug', // Set to debug to capture trace-level logs from Baileys
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'whatsapp-baileys.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ],
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

      // Check if already connected
      if (this.connections.has(organizationId)) {
        const existingConnection = this.connections.get(organizationId);
        if (existingConnection.isConnected) {
          logger.info(`Organization ${organizationId} already connected`);
          return true;
        }
      }

      // Load or create auth state from database
      const { state, saveCreds } = await useDatabaseAuthState(organizationId, this.pool);

      // Get latest Baileys version for compatibility
      const { version } = await fetchLatestBaileysVersion();

      // Create WhatsApp socket
      const sock = makeWASocket({
        version,
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

      // Error 515 (Stream Errored) means WhatsApp rejected the pairing - credentials are invalid
      // Error 401 (Connection Failure) means credentials are unauthorized
      // These should trigger credential reset, not reconnection
      const credentialRejection = statusCode === 515 || statusCode === 401;

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut &&
        statusCode !== DisconnectReason.badSession &&
        statusCode !== undefined &&
        !handshakeFailure &&
        !credentialRejection;

      logger.info(
        `Connection closed for org ${organizationId}. Reconnect: ${shouldReconnect}. Status: ${statusCode}${credentialRejection ? ' (credential rejection)' : ''}`,
        { lastDisconnect: util.inspect(lastDisconnect, { depth: 3 }) }
      );

      if (shouldReconnect) {
        // Reconnect automatically with existing credentials
        setTimeout(() => {
          this.initializeConnection(organizationId, connectionObj.userId);
        }, 3000);
        return;
      }

      // Logged out, bad session, handshake failure, or credential rejection - clean up and clear credentials
      connectionObj.isConnected = false;

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

      // Logout from WhatsApp
      if (connectionObj.sock) {
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
   * @returns {Promise<boolean>} Success status
   */
  async sendMessage(organizationId, phoneNumber, message) {
    try {
      const connectionObj = this.connections.get(organizationId);

      if (!connectionObj || !connectionObj.isConnected) {
        logger.warn(`WhatsApp not connected for organization ${organizationId}`);
        return false;
      }

      // Format phone number for WhatsApp (remove + and add @s.whatsapp.net)
      const formattedNumber = phoneNumber.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

      // Add random delay to avoid rate limiting (2-5 seconds)
      const delay = Math.floor(Math.random() * 3000) + 2000;
      await new Promise(resolve => setTimeout(resolve, delay));

      // Send message
      await connectionObj.sock.sendMessage(formattedNumber, { text: message });

      logger.info(`Message sent successfully to ${phoneNumber} for org ${organizationId}`);
      return true;
    } catch (error) {
      logger.error(`Error sending WhatsApp message for org ${organizationId}:`, error);
      return false;
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

      if (this.connections.has(organizationId)) {
        this.connections.delete(organizationId);
      }
    } catch (error) {
      logger.error(`Error clearing WhatsApp auth state for org ${organizationId}:`, error);
      throw error;
    }
  }
}

module.exports = WhatsAppBaileysService;
