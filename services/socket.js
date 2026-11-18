const { Server: SocketIO } = require('socket.io');
const logger = require('../config/logger');
const { verifyJWT } = require('../utils/api-helpers');
const { isAllowedOrigin, allowSocketRequest } = require('../config/cors');
const { syncStateFor } = require('./liveSyncState');
const { loadMembership } = require('../middleware/auth');
const presence = require('./onlinePresence');

/** Sent to administrators: how many accounts of their unit are online. */
const ONLINE_COUNT_EVENT = 'online-count';
/** Who may see that count (migration 092). */
const VIEW_ONLINE_PERMISSION = 'users.view_online';

/**
 * @param {number|string} organizationId - Unit
 * @returns {string} Room of the unit's connections allowed to see its count
 */
function onlineRoom(organizationId) {
  return `org-${organizationId}-online`;
}

/**
 * Tell the unit's administrators the new count.
 * @param {number|string} organizationId - Unit
 * @returns {void}
 */
function broadcastOnlineCount(organizationId) {
  io.to(onlineRoom(organizationId)).emit(ONLINE_COUNT_EVENT, { count: presence.onlineCount(organizationId) });
}

/**
 * Count a connection among the unit's accounts online, once its membership is
 * confirmed by the authorization engine: the token alone is a snapshot. An
 * administrator's connection also joins the room told the count.
 * @param {import('pg').Pool} pool - Database pool
 * @param {Object} socket - Authenticated connection
 * @returns {Promise<void>}
 */
async function trackPresence(pool, socket) {
  const { organizationId, userId } = socket;
  const membership = await loadMembership(userId, pool, organizationId);
  // Closed while the membership loaded, or no longer a member: not counted.
  if (socket.presenceClosed || !membership.active) {
    return;
  }
  socket.presenceCounted = true;
  const isNewAccount = presence.addConnection(organizationId, userId);
  if (membership.permissions.includes(VIEW_ONLINE_PERMISSION)) {
    socket.join(onlineRoom(organizationId));
    socket.emit(ONLINE_COUNT_EVENT, { count: presence.onlineCount(organizationId) });
  }
  if (isNewAccount) {
    broadcastOnlineCount(organizationId);
  }
}

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
        trackPresence(pool, socket)
          .catch((error) => logger.warn(`Online presence unavailable: ${error.message}`));
      }
    }

    socket.on('disconnect', () => {
      logger.info(`Socket.io disconnected: ${socket.id}`);
      socket.presenceClosed = true;
      if (socket.presenceCounted && presence.removeConnection(socket.organizationId, socket.userId)) {
        broadcastOnlineCount(socket.organizationId);
      }
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
