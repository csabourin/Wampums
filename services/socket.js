const { Server: SocketIO } = require('socket.io');
const logger = require('../config/logger');
const { verifyJWT } = require('../utils/api-helpers');
const { isAllowedOrigin, allowSocketRequest } = require('../config/cors');
const { syncStateFor } = require('./liveSyncState');

let io;

/**
 * Initialize Socket.IO
 * 
 * @param {http.Server} server - The HTTP server instance
 * @param {import('pg').Pool} [pool] - Database pool, for the live-sync state
 * @returns {SocketIO} The Socket.IO server instance
 */
function init(server, pool) {
  io = new SocketIO(server, {
    // Same allow-list as the HTTP API; allowRequest also covers WebSocket
    // upgrades, which CORS does not.
    cors: {
      origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
      methods: ['GET', 'POST'],
    },
    allowRequest: allowSocketRequest,
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    try {
      const payload = verifyJWT(token);

      if (!payload || !payload.user_id) {
        return next(new Error('Authentication error: Invalid token'));
      }

      socket.userId = payload.user_id || payload.userId;
      socket.organizationId = payload.organization_id || payload.organizationId;
      next();
    } catch (error) {
      next(new Error(`Authentication error: ${  error.message}`));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    logger.info(`Socket.io connected: ${socket.id}, user: ${socket.userId}, org: ${socket.organizationId}`);

    if (socket.organizationId) {
      socket.join(`org-${socket.organizationId}`);
      // Lets a reconnecting session tell whether it missed any change. Marked
      // as the connection's, since a write's acknowledgement can arrive first.
      if (pool) {
        syncStateFor(pool, socket.organizationId)
          .then((state) => socket.emit('sync-state', { ...state, connection: true }))
          .catch((error) => logger.warn(`Live sync state unavailable: ${error.message}`));
      }
    }

    socket.on('disconnect', () => {
      logger.info(`Socket.io disconnected: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Get the active Socket.IO instance
 * 
 * @returns {SocketIO}
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized!');
  }
  return io;
}

module.exports = { init, getIO };
