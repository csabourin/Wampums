/**
 * Announce successful writes to the unit's other open sessions.
 *
 * Each SPA session joins its unit's Socket.IO room (`org-<id>`, see
 * services/socket.js). When a write under /api/v1 succeeds, the room receives
 * `data-changed` with the path written, and each session drops the cached data
 * that change made stale. The session that made the write names its own
 * connection in the X-Live-Sync-Client header and is left out; it receives
 * the unit's new `sync-state` instead, so it knows it has seen this change.
 * Every announcement carries the unit's version (services/liveSyncState.js).
 *
 * Only the path is sent — no body, no query string — so nothing reaches a
 * session that its own reads would not reveal.
 *
 * Writes that are not announced still count, so a reconnecting session knows
 * it may have missed them: a route that changes another unit names it in
 * `res.locals.liveSyncOrganizationIds` (that unit's version moves on), and a
 * write no unit can be named for, such as a public page, moves the shared
 * version every unit compares.
 */
const logger = require('../config/logger');
const socketService = require('../services/socket');
const { recordChange, recordSharedChange, syncStateFor } = require('../services/liveSyncState');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const API_V1_PREFIX = '/api/v1/';
const CLIENT_HEADER = 'x-live-sync-client';
const DATA_CHANGED_EVENT = 'data-changed';
const SYNC_STATE_EVENT = 'sync-state';

/** Socket.IO ids are short base64url strings; anything else is ignored. */
const SOCKET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** POST endpoints that only read, and resources whose writes are private to the caller. */
const SILENT_PATHS = [
  /^\/api\/v1\/users\/permissions\/check$/,
  /^\/api\/v1\/transfers\/preview$/,
  /^\/api\/v1\/ai(\/|$)/,
];

/** Signed-out writes that change no unit's data, and happen all the time. */
const UNCOUNTED_PATHS = [
  /^\/(api\/v1\/auth|api\/auth|public)\/(login|verify-2fa|verify-session|logout|request-reset|reset-password(\/describe)?)$/,
  /^\/api\/v1\/logout$/,
  /^\/api\/v1\/public\/contact-demo$/,
];

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

/**
 * @param {import('express').Request} req
 * @returns {string|null} The API path written, when it should be announced
 */
function announcedPath(req) {
  const path = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  if (!path.startsWith(API_V1_PREFIX)) {
    return null;
  }
  return SILENT_PATHS.some((pattern) => pattern.test(path)) ? null : path;
}

/**
 * @param {import('express').Request} req
 * @returns {boolean} Whether a signed-out write may have changed some unit's data
 */
function isSharedChange(req) {
  const path = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  return !UNCOUNTED_PATHS.some((pattern) => pattern.test(path))
    && !SILENT_PATHS.some((pattern) => pattern.test(path));
}

/**
 * Count changes a route made to units other than the writer's.
 * @param {import('express').Response} res
 * @param {number|string|undefined} organizationId - The writer's unit
 */
function countOtherUnits(res, organizationId) {
  const others = Array.isArray(res.locals?.liveSyncOrganizationIds) ? res.locals.liveSyncOrganizationIds : [];
  new Set(others.map(String))
    .forEach((other) => {
      if (other && other !== String(organizationId)) {
        recordChange(other);
      }
    });
}

/**
 * Express middleware; attach before the routes.
 */
function liveSyncBroadcaster(req, res, next) {
  if (!WRITE_METHODS.has(req.method)) {
    return next();
  }

  res.on('finish', () => {
    if (res.statusCode < HTTP_OK_MIN || res.statusCode > HTTP_OK_MAX) {
      return;
    }
    // Set by `authenticate`: public and unauthenticated writes are not announced.
    const organizationId = req.user?.organizationId;
    const path = announcedPath(req);
    countOtherUnits(res, organizationId);
    if (!organizationId) {
      if (isSharedChange(req)) {
        recordSharedChange();
      }
      return;
    }
    if (!path) {
      return;
    }

    try {
      const io = socketService.getIO();
      const roomName = `org-${organizationId}`;
      const version = recordChange(organizationId);
      let room = io.to(roomName);
      const originId = req.get(CLIENT_HEADER);
      if (originId && SOCKET_ID_PATTERN.test(originId)) {
        room = room.except(originId);
        // The header comes from the client: only a session of this unit hears back.
        const origin = io.sockets?.sockets?.get(originId);
        if (origin?.rooms?.has(roomName)) {
          origin.emit(SYNC_STATE_EVENT, syncStateFor(organizationId));
        }
      }
      room.emit(DATA_CHANGED_EVENT, { path, version });
    } catch (error) {
      // Never let the announcement affect a write that already succeeded.
      logger.warn(`Live sync announcement failed for ${path}: ${error.message}`);
    }
  });

  return next();
}

module.exports = { liveSyncBroadcaster, announcedPath };
