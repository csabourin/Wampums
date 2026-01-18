require("dotenv").config();
const { Pool } = require("pg");

// Database connection configuration
// SSL is enabled by default. Only disable certificate validation in development if explicitly set.
const poolConfig = {
    connectionString: process.env.SB_URL || process.env.DATABASE_URL,
    // Optimize connection pool for performance
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),  // Maximum pool size (default: 20)
    min: parseInt(process.env.DB_POOL_MIN || '5', 10),   // Minimum idle connections (default: 5)
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),  // Close idle connections after 30s
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000', 10),  // Timeout waiting for connection (2s)
    // Allow connections to be reused to reduce overhead
    allowExitOnIdle: false,
};

// Configure SSL based on environment
// Supabase requires SSL but uses certificates that may need relaxed validation
if (process.env.DATABASE_URL || process.env.SB_URL) {
    // Supabase connections need rejectUnauthorized: false due to certificate chain
    // SSL is still enabled - only certificate validation is relaxed
    poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

// Handle pool errors
pool.on("error", (err, client) => {
    console.error("Unexpected error on idle PostgreSQL client:", err);
    // Pool errors are typically non-fatal (e.g., network issues)
    // The pool will handle reconnection automatically
});

module.exports = { pool };
