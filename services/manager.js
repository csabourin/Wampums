const WhatsAppBaileysService = require("./whatsapp-baileys");
const GoogleChatService = require("./google-chat");
const MedicationReminderService = require("./medication-reminders");
const socketService = require("./socket");
const logger = require("../config/logger");
const { isTestEnvironment } = require("../test/test-helpers");

let whatsappService;
let googleChatService;
let medicationReminderService;

/**
 * Initialize all application services
 * 
 * @param {import('pg').Pool} pool - The database connection pool
 */
async function init(pool) {
    // Skip service initialization in test environment
    if (isTestEnvironment()) {
        logger.info("Skipping service initialization in test environment");
        return;
    }

    logger.info("Initializing services...");

    // 1. WhatsApp Baileys Service
    whatsappService = new WhatsAppBaileysService(pool);

    // Connect to Socket.IO if available
    try {
        const io = socketService.getIO();
        whatsappService.setSocketIO(io);
    } catch (error) {
        logger.warn("Socket.IO not available for WhatsApp service during initialization");
    }

    // 2. Google Chat Service
    googleChatService = new GoogleChatService(pool);

    // 3. Medication Reminder Service
    medicationReminderService = new MedicationReminderService(pool, logger);
    medicationReminderService.start();

    logger.info("✅ Services initialized");
}

/**
 * Get the WhatsApp service instance
 * @returns {WhatsAppBaileysService}
 */
function getWhatsAppService() {
    return whatsappService;
}

/**
 * Get the Google Chat service instance
 * @returns {GoogleChatService}
 */
function getGoogleChatService() {
    return googleChatService;
}

/**
 * Restore service state (e.g. WhatsApp connections)
 */
async function restore() {
    if (whatsappService) {
        try {
            await whatsappService.restoreConnections();
            logger.info("WhatsApp connections restored");
        } catch (error) {
            logger.error("Error restoring WhatsApp connections:", error);
        }
    }
}

/**
 * Stop all background services (called during graceful shutdown)
 */
function shutdown() {
    if (medicationReminderService) {
        medicationReminderService.stop();
    }
}

module.exports = {
    init,
    restore,
    shutdown,
    getWhatsAppService,
    getGoogleChatService,
};
