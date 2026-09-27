/**
 * Announce successful writes to the unit's other open sessions.
 *
 * Each SPA session joins its unit's Socket.IO room (`org-<id>`, see
 * services/socket.js). When a write under /api/v1 succeeds, the room receives
 * `data-changed` with the path written, and each session drops the cached data
 * that change made stale. The session that made the write names its own
 * connection in the X-Live-Sync-Client header and is left out.
 *
 * Only the path is sent — no body, no query string — so nothing reaches a
 * session that its own reads would not reveal.
 */
const logger = require("../config/logger");
const socketService = require("../services/socket");

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const API_V1_PREFIX = "/api/v1/";
const CLIENT_HEADER = "x-live-sync-client";
const DATA_CHANGED_EVENT = "data-changed";

/** Socket.IO ids are short base64url strings; anything else is ignored. */
const SOCKET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** POST endpoints that only read, and resources whose writes are private to the caller. */
const SILENT_PATHS = [
    /^\/api\/v1\/users\/permissions\/check$/,
    /^\/api\/v1\/transfers\/preview$/,
    /^\/api\/v1\/ai(\/|$)/,
];

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

/**
 * @param {import('express').Request} req
 * @returns {string|null} The API path written, when it should be announced
 */
function announcedPath(req) {
    const path = String(req.originalUrl || "").split("?")[0].replace(/\/+$/, "");
    if (!path.startsWith(API_V1_PREFIX)) {
        return null;
    }
    return SILENT_PATHS.some((pattern) => pattern.test(path)) ? null : path;
}

/**
 * Express middleware; attach before the routes.
 */
function liveSyncBroadcaster(req, res, next) {
    if (!WRITE_METHODS.has(req.method)) {
        return next();
    }

    res.on("finish", () => {
        if (res.statusCode < HTTP_OK_MIN || res.statusCode > HTTP_OK_MAX) {
            return;
        }
        // Set by `authenticate`: public and unauthenticated writes are not announced.
        const organizationId = req.user?.organizationId;
        const path = announcedPath(req);
        if (!organizationId || !path) {
            return;
        }

        try {
            let room = socketService.getIO().to(`org-${organizationId}`);
            const originId = req.get(CLIENT_HEADER);
            if (originId && SOCKET_ID_PATTERN.test(originId)) {
                room = room.except(originId);
            }
            room.emit(DATA_CHANGED_EVENT, { path });
        } catch (error) {
            // Never let the announcement affect a write that already succeeded.
            logger.warn(`Live sync announcement failed for ${path}: ${error.message}`);
        }
    });

    return next();
}

module.exports = { liveSyncBroadcaster, announcedPath };
