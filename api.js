require("dotenv").config();
const createApp = require("./config/app");
const logger = require("./config/logger");
const { pool } = require("./config/database");
const serviceManager = require("./services/manager");

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

const { app, server, io } = createApp();

/**
 * Handle graceful shutdown
 * 
 * @param {string} signal - The signal received ('SIGTERM' or 'SIGINT')
 */
async function gracefulShutdown(signal) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  // 1. Stop accepting new requests
  server.close(async () => {
    logger.info("HTTP server closed.");

    // 2. Close database pool
    try {
      await pool.end();
      logger.info("Database pool closed.");
    } catch (err) {
      logger.error("Error closing database pool:", err);
    }

    // 3. Final cleanup
    logger.info("Graceful shutdown complete.");
    process.exit(0);
  });

  // Force shutdown after 10s
  setTimeout(() => {
    logger.error("Could not close connections in time, forcefully shutting down");
    process.exit(1);
  }, 10000);
}

// Start Server
if (require.main === module) {
  server.listen(PORT, HOST, async () => {
    logger.info(`🚀 Server running on ${HOST}:${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Restore long-running services
    await serviceManager.restore();

    // Register shutdown handlers
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  });
}

// Export app for testing, server and io for cleanup
module.exports = app;
Object.assign(module.exports, { server, io });
