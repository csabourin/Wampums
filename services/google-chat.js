/**
 * Google Chat Service
 *
 * Handles Google Chat integration for sending announcements to Google Chat Spaces.
 * Supports both broadcast to a single space (recommended for 300+ members) and
 * direct messages (DMs) to individual users.
 *
 * RECOMMENDED APPROACH FOR LARGE GROUPS (300+ members):
 * 1. Create a Google Group (e.g., tous@monasso.org) in Google Admin Console
 * 2. Add all 300 members to this Google Group
 * 3. Create a Google Chat Space and add the Google Group as a member
 * 4. Your bot sends 1 message to the Space, all members receive it
 *
 * This approach avoids rate limits and is much more efficient than 300 individual DMs.
 *
 * API QUOTAS:
 * - Creating new DM spaces: ~60 per minute
 * - Sending messages: Generally sufficient for broadcast use case
 * - For 300 DMs: Would take ~5 minutes with rate limiting
 *
 * @see https://developers.google.com/chat/api/guides/v1/messages/create
 */

const { chat } = require('@googleapis/chat');
const { GoogleAuth } = require('google-auth-library');
const winston = require('winston');
const path = require('path');

const GOOGLE_CHAT_LOG_LEVEL = process.env.GOOGLE_CHAT_LOG_LEVEL || 'info';
const GOOGLE_CHAT_LOG_FILE = process.env.GOOGLE_CHAT_LOG_FILE || 'google-chat.log';
const ENABLE_GOOGLE_CHAT_CONSOLE_LOGS = process.env.GOOGLE_CHAT_CONSOLE_LOGS !== 'false';

// Configure logger
const loggerTransports = [
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', GOOGLE_CHAT_LOG_FILE),
    level: GOOGLE_CHAT_LOG_LEVEL
  })
];

if (ENABLE_GOOGLE_CHAT_CONSOLE_LOGS) {
  loggerTransports.push(
    new winston.transports.Console({
      format: winston.format.simple(),
      level: GOOGLE_CHAT_LOG_LEVEL
    })
  );
}

const logger = winston.createLogger({
  level: GOOGLE_CHAT_LOG_LEVEL,
  format: winston.format.json(),
  transports: loggerTransports,
});

/**
 * Google Chat Service Class
 * Manages Google Chat connections and message delivery for multiple organizations
 */
class GoogleChatService {
  constructor(pool) {
    this.pool = pool;
    this.clients = new Map(); // organizationId -> authenticated chat client
    this.messageQueue = new Map(); // organizationId -> message queue
  }

  /**
   * Get or create an authenticated Google Chat client for an organization
   * @param {number} organizationId - Organization ID
   * @returns {Promise<chat_v1.Chat>} Authenticated Google Chat client
   */
  async getClient(organizationId) {
    // Return cached client if available
    if (this.clients.has(organizationId)) {
      return this.clients.get(organizationId);
    }

    try {
      // Fetch service account credentials from database
      const credentialsResult = await this.pool.query(
        `SELECT credentials_json, service_account_email
         FROM google_chat_config
         WHERE organization_id = $1 AND is_active = true`,
        [organizationId]
      );

      if (credentialsResult.rows.length === 0) {
        throw new Error(`No active Google Chat configuration found for organization ${organizationId}`);
      }

      const { credentials_json, service_account_email } = credentialsResult.rows[0];

      // Parse credentials if stored as string
      const credentials = typeof credentials_json === 'string'
        ? JSON.parse(credentials_json)
        : credentials_json;

      // Create Google Auth client
      const auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/chat.bot']
      });

      // Create Google Chat client
      const chatClient = chat({
        version: 'v1',
        auth
      });

      // Cache the client
      this.clients.set(organizationId, chatClient);

      logger.info(`Google Chat client created for organization ${organizationId} with service account ${service_account_email}`);

      return chatClient;
    } catch (error) {
      logger.error(`Failed to create Google Chat client for organization ${organizationId}:`, error);
      throw error;
    }
  }

  /**
   * Send a message to a Google Chat Space
   * @param {number} organizationId - Organization ID
   * @param {string} spaceId - Google Chat Space ID (format: 'spaces/AAAAxxxxxxx')
   * @param {string} messageText - Plain text message
   * @param {Object} [cardMessage] - Optional Card message for rich formatting
   * @returns {Promise<Object>} Message creation response
   */
  async sendMessageToSpace(organizationId, spaceId, messageText, cardMessage = null) {
    try {
      const chatClient = await this.getClient(organizationId);

      const messageBody = {
        text: messageText
      };

      // Add card formatting if provided
      if (cardMessage) {
        messageBody.cardsV2 = cardMessage;
      }

      const response = await chatClient.spaces.messages.create({
        parent: spaceId,
        requestBody: messageBody
      });

      logger.info(`Message sent to space ${spaceId} for organization ${organizationId}`);

      return response.data;
    } catch (error) {
      logger.error(`Failed to send message to space ${spaceId}:`, error);
      throw error;
    }
  }

  /**
   * Send broadcast message to the organization's default announcement space
   * This is the recommended approach for reaching all 300 members with a single API call
   * @param {number} organizationId - Organization ID
   * @param {string} subject - Message subject/title
   * @param {string} messageText - Message content
   * @returns {Promise<Object>} Message creation response
   */
  async sendBroadcast(organizationId, subject, messageText) {
    try {
      // Fetch the default broadcast space for this organization
      const spaceResult = await this.pool.query(
        `SELECT space_id, space_name
         FROM google_chat_spaces
         WHERE organization_id = $1 AND is_broadcast_space = true AND is_active = true`,
        [organizationId]
      );

      if (spaceResult.rows.length === 0) {
        throw new Error(`No broadcast space configured for organization ${organizationId}. Please configure a broadcast space first.`);
      }

      const { space_id, space_name } = spaceResult.rows[0];

      // Create a formatted card message for better presentation
      const cardMessage = [
        {
          cardId: 'announcement-card',
          card: {
            header: {
              title: subject,
              subtitle: 'Annonce de votre organisation'
            },
            sections: [
              {
                widgets: [
                  {
                    textParagraph: {
                      text: messageText
                    }
                  }
                ]
              }
            ]
          }
        }
      ];

      const fullMessage = `**${subject}**\n\n${messageText}`;

      const response = await this.sendMessageToSpace(
        organizationId,
        space_id,
        fullMessage,
        cardMessage
      );

      // Log the broadcast in database
      await this.pool.query(
        `INSERT INTO google_chat_messages (organization_id, space_id, message_id, subject, message_text, sent_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [organizationId, space_id, response.name, subject, messageText]
      );

      logger.info(`Broadcast sent to space ${space_name} (${space_id}) for organization ${organizationId}`);

      return {
        success: true,
        spaceId: space_id,
        spaceName: space_name,
        messageId: response.name,
        membersReached: 'all'
      };
    } catch (error) {
      logger.error(`Failed to send broadcast for organization ${organizationId}:`, error);
      throw error;
    }
  }

  /**
   * Send direct messages to individual users (NOT RECOMMENDED for 300+ users)
   * Use sendBroadcast instead for better performance and to avoid rate limits
   * @param {number} organizationId - Organization ID
   * @param {Array<string>} userEmails - Array of user email addresses
   * @param {string} subject - Message subject
   * @param {string} messageText - Message content
   * @returns {Promise<Object>} Results with success/failure counts
   */
  async sendDirectMessages(organizationId, userEmails, subject, messageText) {
    logger.warn(`Sending ${userEmails.length} direct messages for organization ${organizationId}. Consider using broadcast space for better performance.`);

    const chatClient = await this.getClient(organizationId);
    const results = {
      successful: 0,
      failed: 0,
      errors: []
    };

    // Rate limiting: Google Chat allows ~60 DM creations per minute
    const DELAY_MS = 1000; // 1 second delay between messages to stay under limits

    for (const email of userEmails) {
      try {
        // Create or find DM space with user
        const dmSpace = await chatClient.spaces.create({
          requestBody: {
            spaceType: 'DIRECT_MESSAGE',
            // Note: Google Chat API will automatically create DM with the specified user
            displayName: email
          }
        });

        const spaceId = dmSpace.data.name;

        // Send message to DM space
        await this.sendMessageToSpace(organizationId, spaceId, `**${subject}**\n\n${messageText}`);

        results.successful++;

        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      } catch (error) {
        logger.error(`Failed to send DM to ${email}:`, error);
        results.failed++;
        results.errors.push({ email, error: error.message });
      }
    }

    logger.info(`Direct messages sent for organization ${organizationId}: ${results.successful} successful, ${results.failed} failed`);

    return results;
  }

  /**
   * List all spaces for an organization
   * @param {number} organizationId - Organization ID
   * @returns {Promise<Array>} List of spaces
   */
  async listSpaces(organizationId) {
    try {
      const chatClient = await this.getClient(organizationId);

      const response = await chatClient.spaces.list({
        pageSize: 100
      });

      return response.data.spaces || [];
    } catch (error) {
      logger.error(`Failed to list spaces for organization ${organizationId}:`, error);
      throw error;
    }
  }

  /**
   * Get space details
   * @param {number} organizationId - Organization ID
   * @param {string} spaceId - Space ID
   * @returns {Promise<Object>} Space details
   */
  async getSpace(organizationId, spaceId) {
    try {
      const chatClient = await this.getClient(organizationId);

      const response = await chatClient.spaces.get({
        name: spaceId
      });

      return response.data;
    } catch (error) {
      logger.error(`Failed to get space ${spaceId} for organization ${organizationId}:`, error);
      throw error;
    }
  }

  /**
   * Clear cached client (useful when credentials are updated)
   * @param {number} organizationId - Organization ID
   */
  clearClient(organizationId) {
    this.clients.delete(organizationId);
    logger.info(`Cleared cached Google Chat client for organization ${organizationId}`);
  }
}

module.exports = GoogleChatService;
