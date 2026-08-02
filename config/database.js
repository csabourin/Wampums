require("dotenv").config();
const { Pool } = require("pg");
const { resolveDatabaseConnectionString } = require("./database-url");

const connectionString = resolveDatabaseConnectionString();
const configuredHost = process.env.DB_HOST;

/**
 * Determine whether a PostgreSQL connection targets the local machine. Local
 * sockets and loopback connections must not be forced through TLS.
 *
 * @param {string|undefined} value PostgreSQL connection URL
 * @returns {boolean} Whether the URL targets a local server
 */
function isLocalConnection(value) {
    if (!value) {
        return !configuredHost || ["localhost", "127.0.0.1", "::1"].includes(configuredHost);
    }

    try {
        const parsed = new URL(value);
        const socketHost = parsed.searchParams.get("host");
        return !parsed.hostname
            || Boolean(socketHost?.startsWith("/"))
            || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    } catch {
        return false;
    }
}

// Database connection configuration
// SSL is enabled by default. Only disable certificate validation in development if explicitly set.
const poolConfig = {
    ...(connectionString
        ? { connectionString }
        : {
            host: configuredHost,
            port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
        }),
    // Optimize connection pool for performance
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),  // Maximum pool size (default: 20)
    min: parseInt(process.env.DB_POOL_MIN || '5', 10),   // Minimum idle connections (default: 5)
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),  // Close idle connections after 30s
    // 10s, not 2s: the database is reached over the network (Railway private
    // networking), so a new connection includes a TLS handshake. 2s was tuned
    // for a local pooler and caused spurious timeouts under load.
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000', 10),
    // Detect connections dropped by the network. Postgres' own tcp_keepalives_idle
    // is 7200s, so without client-side keepalive a dead socket can sit in the pool
    // for two hours before anyone notices, and gets handed to a request as if live.
    keepAlive: true,
    keepAliveInitialDelayMillis: parseInt(process.env.DB_KEEPALIVE_DELAY || '10000', 10),
    // Allow connections to be reused to reduce overhead
    allowExitOnIdle: false,
};

// Remote managed PostgreSQL connections use TLS. Local sockets and loopback
// connections remain unencrypted because traffic never leaves the machine.
if (!isLocalConnection(connectionString) && process.env.DB_SSL_DISABLED !== "true") {
    poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

// Handle pool errors
pool.on("error", (err) => {
    // Log the message only. Passing the Error object serialises the whole pg
    // Client with it (connection params, TLS socket, timers), turning a single
    // failure into ~80 lines of noise and burying the actual cause.
    console.error(
        `Unexpected error on idle PostgreSQL client: ${err.message}` +
        (err.code ? ` (code ${err.code})` : "")
    );
    // Pool errors are typically non-fatal (e.g., network issues)
    // The pool will handle reconnection automatically
});

module.exports = { pool };
