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
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const winston = require('winston');
const path = require('path');
const fs = require('fs').promises;

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'whatsapp-baileys.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ],
});

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

      // Create auth directory for this organization
      const authDir = path.join(__dirname, '..', 'whatsapp-sessions', `org-${organizationId}`);
      await fs.mkdir(authDir, { recursive: true });

      // Load or create auth state
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      // Get latest Baileys version for compatibility
      const { version } = await fetchLatestBaileysVersion();

      // Create WhatsApp socket
      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: true, // Also print in terminal for debugging
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
        authDir,
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
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.info(`Connection closed for org ${organizationId}. Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        // Reconnect automatically
        setTimeout(() => {
          this.initializeConnection(organizationId, connectionObj.userId);
        }, 3000);
      } else {
        // Logged out - clean up
        connectionObj.isConnected = false;

        try {
          // Update database
          await this.pool.query(
            `UPDATE whatsapp_baileys_connections
             SET is_connected = FALSE,
                 last_disconnected_at = NOW(),
                 updated_at = NOW()
             WHERE organization_id = $1`,
            [organizationId]
          );

          // Emit disconnection event
          if (this.io) {
            this.io.to(`org-${organizationId}`).emit('whatsapp-disconnected', {
              organizationId,
              reason: 'logged_out',
            });
          }
        } catch (error) {
          logger.error(`Error updating disconnection in database for org ${organizationId}:`, error);
        }
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

      // Update database
      await this.pool.query(
        `UPDATE whatsapp_baileys_connections
         SET is_connected = FALSE,
             last_disconnected_at = NOW(),
             updated_at = NOW()
         WHERE organization_id = $1`,
        [organizationId]
      );

      // Clean up auth directory
      const authDir = path.join(__dirname, '..', 'whatsapp-sessions', `org-${organizationId}`);
      try {
        await fs.rm(authDir, { recursive: true, force: true });
        logger.info(`Auth directory cleaned up for org ${organizationId}`);
      } catch (error) {
        logger.warn(`Could not delete auth directory for org ${organizationId}:`, error.message);
      }

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

      return result.rows.length > 0 && result.rows[0].is_connected;
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
}

module.exports = WhatsAppBaileysService;
