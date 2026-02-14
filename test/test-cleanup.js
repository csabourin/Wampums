/**
 * Test cleanup utilities
 * 
 * Provides cleanup functions to properly close resources after tests
 * to prevent tests from hanging.
 */

/**
 * Clean up all resources created by requiring api.js
 * This includes HTTP server, Socket.IO, and announcement listeners
 * 
 * @param {Object} app - The app object returned by require('../api')
 * @returns {Promise<void>}
 */
async function cleanupTestResources(app) {
  const promises = [];

  // Close HTTP server
  if (app.server) {
    promises.push(new Promise((resolve) => {
      app.server.close(() => {
        resolve();
      });
    }));
  }

  // Close Socket.IO
  if (app.io) {
    promises.push(new Promise((resolve) => {
      app.io.close(() => {
        resolve();
      });
    }));
  }

  // Close announcement listener
  if (typeof global.__announcementListenerShutdown === 'function') {
    promises.push(global.__announcementListenerShutdown());
  }

  await Promise.all(promises);
}

module.exports = {
  cleanupTestResources
};
