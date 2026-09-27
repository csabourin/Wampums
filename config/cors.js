/**
 * Which browser origins may call the API and open a Socket.IO connection.
 *
 * Wampums subdomains and local development are allowed from anywhere. A page
 * served by this same host (a unit on its own domain) is always allowed: it is
 * not a cross-origin request.
 */
const ALLOWED_ORIGIN_PATTERNS = [
    /^https:\/\/([a-z0-9-]+\.)?wampums\.app$/,
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
];

/**
 * @param {string|undefined} origin - The request's Origin header
 * @returns {boolean} Whether the origin is on the allow-list
 */
function isAllowedOrigin(origin) {
    return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

/**
 * @param {string|undefined} origin - The request's Origin header
 * @param {string|undefined} host - The request's Host header
 * @returns {boolean} Whether the origin is this very host
 */
function isSameHost(origin, host) {
    if (!origin || !host) {
        return false;
    }
    try {
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}

/**
 * Socket.IO `allowRequest`. The WebSocket upgrade is not subject to CORS, so
 * the origin has to be checked here: otherwise any site could open a
 * connection with a token it obtained. Requests without an Origin (native
 * clients, server-to-server) are allowed, as they are for the HTTP API.
 *
 * @param {import('http').IncomingMessage} req - Handshake request
 * @param {function(string|null, boolean): void} callback - Socket.IO callback
 */
function allowSocketRequest(req, callback) {
    const { origin, host } = req.headers;
    callback(null, !origin || isAllowedOrigin(origin) || isSameHost(origin, host));
}

module.exports = { isAllowedOrigin, allowSocketRequest };
