require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server: SocketIO } = require("socket.io");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { check, validationResult } = require("express-validator");
const winston = require("winston");
const path = require("path");
const fs = require("fs");
const swaggerUi = require("swagger-ui-express");
const swaggerSpecs = require("./config/swagger");
const meetingSectionDefaults = require("./config/meeting_sections.json");
const { success, error: errorResponse } = require("./middleware/response");
const {
  respondWithOrganizationFallback,
  OrganizationNotFoundError,
  getCurrentOrganizationId,
  verifyOrganizationMembership,
  jsonResponse,
  handleError,
  verifyJWT
} = require("./utils/api-helpers");
const WhatsAppBaileysService = require("./services/whatsapp-baileys");

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

// Trust proxy "true" is often safer in PaaS/Cloud environments where the number of hops is variable
// Use "true" if the app is not directly publicly accessible (e.g. behind Replit/Heroku/AWS LB)
app.set("trust proxy", true);

// Determine if we're in production mode
const isProduction = process.env.NODE_ENV === "production";

// Debug logging utilities
const { debugLog } = require("./utils/DebugUtils");

// Configure logging before database and error handlers
const logDirectory = path.join(process.cwd(), "logs");
try {
  fs.mkdirSync(logDirectory, { recursive: true });
} catch (mkdirError) {
  console.error("Unable to create log directory", mkdirError);
}

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({
      filename: path.join(logDirectory, "error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(logDirectory, "combined.log"),
    }),
  ],
});

// Compression middleware
let compression;
try {
  compression = require("compression");
  app.use(compression());
} catch (e) {
  logger.info(
    "Compression not available. Install with: npm install compression",
  );
}

app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

// Enable strong ETags for better caching and bandwidth reduction
app.set("etag", "strong");

// Security headers with Content Security Policy
const connectSrc = [
  "'self'",
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com",
  "https://*.supabase.co", // Supabase storage for equipment photos
  "https://demo.wampums.app", // Demo API
  "http://localhost:5173", // Development Vite
  "http://127.0.0.1:5173", // Development Vite (IPv4)
];

// Allow the configured API base URL when defined so the SPA can call remote APIs under strict CSP
const apiBaseUrl = process.env.API_BASE_URL || process.env.VITE_API_BASE_URL;
if (apiBaseUrl) {
  try {
    connectSrc.push(new URL(apiBaseUrl).origin);
  } catch (e) {
    console.warn("Invalid API_BASE_URL for CSP connectSrc", e);
  }
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"], // Note: Consider removing unsafe-inline and using nonces in production
        scriptSrcElem: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
        fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc,
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'", "https://*.replit.dev", "https://*.repl.co", "https://*.replit.com"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    xFrameOptions: false, // Disabled - using CSP frame-ancestors instead for Replit webview support
  }),
);

// CORS configuration - supports multiple domains, subdomains, React Native, and dev environments
// Flexible but secure: validates against patterns while allowing dynamic subdomains and dev tools
const corsOptions = {
  origin: function (origin, callback) {
    // IMPORTANT: Allow requests with no origin (React Native apps, Postman, mobile apps)
    // React Native apps don't send an Origin header
    if (!origin) {
      // Note: Intentionally not logging "no origin" requests to reduce log noise
      return callback(null, true);
    }

    // Parse allowed origin patterns from environment variable
    // Supports:
    // - Exact matches: https://wampums.app
    // - Wildcard subdomains: *.wampums.app (matches any.subdomain.wampums.app)
    // - Port wildcards: localhost:* (matches localhost:5173, localhost:3000, etc.)
    // - Multiple patterns: https://wampums.app,*.wampums.app,*.custom-domain.com
    const allowedPatterns = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : isProduction
        ? [
          'https://wampums.app',
          'https://*.wampums.app',
          // Allow localhost for Expo web development in production
          'http://localhost:*',
          'http://127.0.0.1:*'
        ]
        : [
          // Development: localhost with any port (Vite can use random ports)
          'http://localhost:*',
          'http://127.0.0.1:*',
          'https://localhost:*',
          'https://127.0.0.1:*',
          // Replit dynamic domains (includes multi-level subdomains like *.worf.replit.dev)
          'https://*.replit.dev',
          'https://*.worf.replit.dev',
          'https://*.repl.co',
          // Other common dev environments
          'https://*.codesandbox.io',
          'https://*.stackblitz.io',
          'https://*.gitpod.io',
          // Local .test domains (wampums-1.test from config.js)
          'http://*.test',
          'http://*.test:*',
        ];

    // Check if origin matches any allowed pattern
    const isAllowed = allowedPatterns.some(pattern => {
      // Exact match
      if (pattern === origin) {
        return true;
      }

      // Wildcard pattern matching (e.g., *.wampums.app, localhost:*)
      if (pattern.includes('*')) {
        // Handle port wildcards specially (e.g., localhost:*)
        if (pattern.includes(':*')) {
          const basePattern = pattern.replace(':*', '');
          // Match if origin starts with the base and has a port
          if (origin.startsWith(basePattern + ':')) {
            return true;
          }
        }

        // Regular wildcard pattern matching
        // Escape special regex characters except *
        const regexPattern = pattern
          .replace(/\./g, '\\.')  // Escape dots
          .replace(/\*/g, '.*');  // Convert * to .*

        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(origin);
      }

      return false;
    });

    if (isAllowed) {
      debugLog && debugLog(`[CORS] Request from ${origin} - ALLOWED`);
      callback(null, true);
    } else {
      logger.warn('[CORS] Request blocked from origin:', origin, '| Allowed patterns:', allowedPatterns);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,  // Allow credentials (cookies, authorization headers)
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// ============================================
// RATE LIMITING WITH MEMORY CLEANUP
// ============================================

// Named constants for configuration
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;
const RATE_LIMITER_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Custom MemoryStore wrapper with periodic cleanup
// Prevents unbounded memory growth from accumulated IP entries
/**
 * CleanableMemoryStore - Rate limiter memory store with automatic expiration cleanup
 *
 * Implements a Map-based store for express-rate-limit that periodically cleans up
 * expired entries to prevent unbounded memory growth. Each entry has an associated
 * reset time, and entries are considered expired when the reset time has passed.
 *
 * This solves a common memory leak in rate limiting where old IPs accumulate
 * indefinitely. The cleanup() method should be called periodically (e.g., every 5 minutes)
 * to remove expired entries.
 *
 * @class CleanableMemoryStore
 * @param {number} windowMs - Time window for rate limiting in milliseconds (e.g., 15 * 60 * 1000 for 15 minutes)
 *
 * @example
 * const store = new CleanableMemoryStore(15 * 60 * 1000);
 * setInterval(() => store.cleanup(), 5 * 60 * 1000);
 */
class CleanableMemoryStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.hits = new Map();
    this.resetTime = new Map();
  }

  /**
   * Increment the hit count for a key
   * @param {string} key - The key to increment (usually IP address)
   * @returns {Promise<{totalHits: number, resetTime: Date}>} Current hits and reset time
   */
  async increment(key) {
    const now = Date.now();
    const resetTimeValue = this.resetTime.get(key);

    // If entry expired, reset it
    if (resetTimeValue && now > resetTimeValue) {
      this.hits.delete(key);
      this.resetTime.delete(key);
    }

    const currentHits = (this.hits.get(key) || 0) + 1;
    this.hits.set(key, currentHits);

    if (!this.resetTime.has(key)) {
      this.resetTime.set(key, now + this.windowMs);
    }

    return {
      totalHits: currentHits,
      resetTime: new Date(this.resetTime.get(key))
    };
  }

  /**
   * Decrement the hit count for a key (for skipSuccessfulRequests)
   * @param {string} key - The key to decrement
   * @returns {Promise<void>}
   */
  async decrement(key) {
    const currentHits = this.hits.get(key) || 0;
    if (currentHits > 0) {
      this.hits.set(key, currentHits - 1);
    }
  }

  /**
   * Reset a specific key (remove it from the store)
   * @param {string} key - The key to reset
   * @returns {Promise<void>}
   */
  async resetKey(key) {
    this.hits.delete(key);
    this.resetTime.delete(key);
  }

  /**
   * Get the current hit count for a key
   * @param {string} key - The key to retrieve
   * @returns {Promise<{totalHits: number, resetTime: Date}|undefined>} Hit info or undefined if not found or expired
   */
  async get(key) {
    const now = Date.now();
    const resetTimeValue = this.resetTime.get(key);

    // If entry expired, return undefined
    if (resetTimeValue && now > resetTimeValue) {
      this.hits.delete(key);
      this.resetTime.delete(key);
      return undefined;
    }

    const totalHits = this.hits.get(key);
    if (totalHits === undefined) {
      return undefined;
    }

    return {
      totalHits,
      resetTime: new Date(this.resetTime.get(key))
    };
  }

  /**
   * Clean up expired entries to free memory
   * Should be called periodically to prevent unbounded growth
   * @returns {number} Number of entries removed
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, resetTime] of this.resetTime) {
      if (now > resetTime) {
        this.hits.delete(key);
        this.resetTime.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get the current number of entries in the store
   * @returns {number} Number of active entries
   */
  get size() {
    return this.hits.size;
  }

  /**
   * Clear all entries from the store
   * @returns {void}
   */
  clear() {
    this.hits.clear();
    this.resetTime.clear();
  }
}

// Create stores for each rate limiter
const generalStore = new CleanableMemoryStore(15 * 60 * 1000);
const authStore = new CleanableMemoryStore(15 * 60 * 1000);
const passwordResetStore = new CleanableMemoryStore(60 * 60 * 1000);

// Rate limiting configuration - relaxed limits for development
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 100 : 10000, // 100 in production, 10000 in development
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  store: generalStore,
  validate: {
    trustProxy: false
  }
});

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 5 : 1000, // 5 in production, 1000 in development
  message:
    "Too many login attempts from this IP, please try again after 15 minutes.",
  standardHeaders: true,
  legacyHeaders: false,
  store: authStore,
  skipSuccessfulRequests: false,
});

// Moderate rate limiter for password reset
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isProduction ? 3 : 100, // 3 in production, 100 in development
  message:
    "Too many password reset requests from this IP, please try again after an hour.",
  standardHeaders: true,
  legacyHeaders: false,
  store: passwordResetStore,
});

// Periodic cleanup of rate limiter stores (every 5 minutes)
// Prevents memory growth from expired entries
const rateLimiterCleanupInterval = setInterval(() => {
  const generalCleaned = generalStore.cleanup();
  const authCleaned = authStore.cleanup();
  const passwordResetCleaned = passwordResetStore.cleanup();

  const totalCleaned = generalCleaned + authCleaned + passwordResetCleaned;
  if (totalCleaned > 0) {
    logger.debug(`Rate limiter cleanup: removed ${totalCleaned} expired entries`, {
      general: { cleaned: generalCleaned, remaining: generalStore.size },
      auth: { cleaned: authCleaned, remaining: authStore.size },
      passwordReset: { cleaned: passwordResetCleaned, remaining: passwordResetStore.size }
    });
  }
}, RATE_LIMITER_CLEANUP_INTERVAL_MS); // Run every 5 minutes

// Prevent cleanup interval from keeping the process alive during shutdown
rateLimiterCleanupInterval.unref();

// Apply general rate limiter to all routes
app.use(generalLimiter);

// Serve static files
// In production, serve from dist folder (Vite build output)
// In development, serve from root (Vite dev server handles the rest)
const staticDir = isProduction ? path.join(__dirname, "dist") : __dirname;
const landingDir = path.join(__dirname, "landing");
const landingHosts = new Set(["wampums.app", "www.wampums.app"]);
const ROBOTS_CACHE_SECONDS = 86400;
const ROBOTS_STALE_SECONDS = 604800;
const ROBOTS_DISALLOW_PATHS = [
  "/api/",
  "/api-docs",
  "/public/login",
  "/public/register",
  "/login",
  "/dashboard",
  "/parent-dashboard",
  "/attendance",
  "/manage_groups",
  "/manage_participants",
  "/manage_points",
  "/manage_honors",
  "/manage_badges",
  "/forms",
  "/form-builder",
  "/import",
  "/notifications",
  "/reports",
  "/budgets",
  "/finance",
  "/resources",
  "/calendars",
  "/fundraisers",
];

const setStaticCacheHeaders = (res, filepath) => {
  // Aggressive caching for production builds (1 year for hashed files)
  if (
    isProduction &&
    filepath.includes("-") &&
    (filepath.endsWith(".js") || filepath.endsWith(".css"))
  ) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  // Extended caching for static assets (30 days = 2592000 seconds)
  else if (
    filepath.endsWith(".js") ||
    filepath.endsWith(".css") ||
    filepath.endsWith(".png") ||
    filepath.endsWith(".jpg") ||
    filepath.endsWith(".webp")
  ) {
    res.setHeader("Cache-Control", "public, max-age=2592000");
  }
};

/**
 * Build a robots.txt document tailored to the inbound host.
 *
 * @param {string} hostname - Hostname from the request.
 * @param {string | undefined} forwardedProto - Optional x-forwarded-proto header value.
 * @returns {string} Plaintext robots.txt content.
 */
const buildRobotsTxt = (hostname, forwardedProto) => {
  const normalizedHost = (hostname || "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/\.+$/, "");
  const activeHost = normalizedHost || "wampums.app";
  const forwardedScheme = (forwardedProto || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const protocol = ["https", "http"].includes(forwardedScheme)
    ? forwardedScheme
    : isProduction
      ? "https"
      : "http";
  const sitemapUrl = `${protocol}://${activeHost}/sitemap.xml`;
  const disallowBlock = ROBOTS_DISALLOW_PATHS.map(
    (pathRule) => `Disallow: ${pathRule}`,
  ).join("\n");

  return [
    "User-agent: *",
    "Allow: /",
    disallowBlock,
    `Sitemap: ${sitemapUrl}`,
  ].join("\n");
};

logger.info(`Serving static files from: ${staticDir}`);
logger.info(`Environment: ${isProduction ? "production" : "development"}`);

// Host-specific static serving for the landing page to keep assets available at the root
app.use((req, res, next) => {
  if (landingHosts.has(req.hostname)) {
    return express.static(landingDir, { setHeaders: setStaticCacheHeaders })(
      req,
      res,
      next,
    );
  }
  return next();
});

// Serve shared static assets and translations in production builds
// These are referenced by absolute paths (e.g., /assets/images/... and /lang/*.json)
app.use(
  "/assets",
  express.static(path.join(__dirname, "assets"), {
    setHeaders: setStaticCacheHeaders,
  }),
);
app.use(
  "/lang",
  express.static(path.join(__dirname, "lang"), {
    setHeaders: setStaticCacheHeaders,
  }),
);

app.use(express.static(staticDir, { setHeaders: setStaticCacheHeaders }));

app.use(express.static(staticDir, { setHeaders: setStaticCacheHeaders }));

// Database connection configuration
const { pool } = require("./config/database");

// Make pool available to middleware via app.locals
app.locals.pool = pool;

// Handle uncaught exceptions
// These indicate serious programming errors that leave the application in an undefined state
process.on("uncaughtException", (err) => {
  logger.error("FATAL: Uncaught Exception - Application will shut down", {
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  });
  console.error("FATAL: Uncaught Exception:", err);

  // Give the logger time to write, then exit
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
// These should be treated as critical errors in production
process.on("unhandledRejection", (reason, promise) => {
  logger.error(
    "FATAL: Unhandled Promise Rejection - Application will shut down",
    {
      reason: reason,
      promise: promise,
      timestamp: new Date().toISOString(),
    },
  );
  console.error(
    "FATAL: Unhandled Promise Rejection at:",
    promise,
    "reason:",
    reason,
  );

  // In production, exit on unhandled rejections
  // Let a process manager (PM2, systemd) restart the application
  if (isProduction) {
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
});

// ============================================
// GRACEFUL SHUTDOWN HANDLER
// ============================================
// Handles SIGTERM/SIGINT for clean server shutdown
// Cleans up all services to prevent memory leaks and zombie connections

let isShuttingDown = false;

/**
 * Graceful shutdown handler
 *
 * Orchestrates a controlled shutdown sequence when the server receives a termination signal
 * (SIGTERM/SIGINT). This ensures that all resources are properly cleaned up and prevents
 * memory leaks and zombie connections.
 *
 * Shutdown sequence:
 * 1. Stop accepting new connections (close HTTP server)
 * 2. Close Socket.io connections
 * 3. Shutdown WhatsApp service
 * 4. Shutdown Google Chat service
 * 5. Close database pool
 * 6. Clear rate limiter stores and stop cleanup interval
 *
 * If shutdown takes longer than GRACEFUL_SHUTDOWN_TIMEOUT_MS (30 seconds), the process
 * is forcefully terminated to prevent hanging.
 *
 * @async
 * @param {string} signal - The signal received ('SIGTERM' or 'SIGINT')
 * @returns {Promise<void>}
 * @throws Will exit the process with code 1 if shutdown fails or times out
 */
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    logger.warn(`Shutdown already in progress, ignoring ${signal}`);
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  console.log(`\n[${signal}] Starting graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    console.error(`Graceful shutdown timed out after ${GRACEFUL_SHUTDOWN_TIMEOUT_MS / 1000}s, forcing exit`);
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

  try {
    // 1. Stop accepting new connections
    if (server.listening) {
      await new Promise((resolve) => {
        server.close((err) => {
          if (err) {
            logger.error('Error closing HTTP server:', err);
          } else {
            logger.info('HTTP server closed');
          }
          resolve();
        });
      });
    }

    // 2. Close Socket.io connections
    if (io) {
      await new Promise((resolve) => {
        io.close((err) => {
          if (err) {
            logger.error('Error closing Socket.io:', err);
          } else {
            logger.info('Socket.io closed');
          }
          resolve();
        });
      });
    }

    // 3. Shutdown WhatsApp service (defined later in the file)
    if (typeof whatsappService !== 'undefined' && whatsappService?.shutdown) {
      await whatsappService.shutdown();
      logger.info('WhatsApp service shutdown complete');
    }

    // 4. Shutdown Google Chat service (defined later in the file)
    if (typeof googleChatService !== 'undefined' && googleChatService?.shutdown) {
      googleChatService.shutdown();
      logger.info('Google Chat service shutdown complete');
    }

    // 5. Close database pool
    if (pool) {
      await pool.end();
      logger.info('Database pool closed');
    }

    // 6. Clear rate limiter stores and stop cleanup interval
    clearInterval(rateLimiterCleanupInterval);
    generalStore.clear();
    authStore.clear();
    passwordResetStore.clear();
    logger.info('Rate limiter stores cleared');

    clearTimeout(shutdownTimeout);
    logger.info('Graceful shutdown complete');
    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    clearTimeout(shutdownTimeout);
    logger.error('Error during graceful shutdown:', error);
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Validate JWT secret is configured
// Support legacy environment variable name `JWT_SECRET` for backward compatibility
const jwtKey = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;

if (!jwtKey) {
  console.error(
    "FATAL ERROR: JWT_SECRET_KEY or JWT_SECRET environment variable is not set.",
  );
  console.error(
    "Please configure a secure JWT secret in your environment variables.",
  );
  console.error(
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
  );
  process.exit(1);
}

// ============================================
// API DOCUMENTATION (Swagger/OpenAPI)
// ============================================

/**
 * @swagger
 * /:
 *   get:
 *     summary: Serve the main application
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: Returns the application HTML
 */
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpecs, {
    explorer: true,
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Wampums API Documentation",
  }),
);

// API documentation JSON
app.get("/api-docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpecs);
});

logger.info("📚 API Documentation available at: /api-docs");

// Register legacy action-based API early to avoid conflicts with modular /api routers


// ============================================
// MODULAR ROUTE IMPORTS
// ============================================

// Import all route modules
const authRoutes = require("./routes/auth")(pool, logger);
const organizationsRoutes = require("./routes/organizations")(pool, logger);
const usersRoutes = require("./routes/users")(pool, logger);
const participantsRoutes = require("./routes/participants")(pool);
const groupsRoutes = require("./routes/groups")(pool);
const attendanceRoutes = require("./routes/attendance")(pool, logger);
const honorsRoutes = require("./routes/honors")(pool, logger);
const pointsRoutes = require("./routes/points")(pool, logger);
const badgesRoutes = require("./routes/badges")(pool, logger);
const formsRoutes = require("./routes/forms")(pool, logger);
const formBuilderRoutes = require("./routes/formBuilder")(pool, logger);
const guardiansRoutes = require("./routes/guardians")(pool, logger);
const meetingsRoutes = require("./routes/meetings")(pool, logger);
const notificationsRoutes = require("./routes/notifications")(pool, logger);
const calendarsRoutes = require("./routes/calendars")(pool, logger);
const fundraisersRoutes = require("./routes/fundraisers")(pool, logger);
const reportsRoutes = require("./routes/reports")(pool, logger);
const dashboardsRoutes = require("./routes/dashboards")(pool, logger);
const publicRoutes = require("./routes/public")(pool, logger);
const importRoutes = require("./routes/import")(pool, logger);
const financeRoutes = require("./routes/finance")(pool, logger);
const stripeRoutes = require("./routes/stripe")(pool, logger);
const budgetsRoutes = require("./routes/budgets")(pool, logger);
const externalRevenueRoutes = require("./routes/external-revenue")(
  pool,
  logger,
);
const resourcesRoutes = require("./routes/resources")(pool);
const localGroupsRoutes = require("./routes/localGroups")(pool);
const userProfileRoutes = require("./routes/userProfile")(pool, logger);
const rolesRoutes = require("./routes/roles")(pool, logger);

// Initialize WhatsApp Baileys Service (must be before routes that use it)
const whatsappService = new WhatsAppBaileysService(pool);
whatsappService.setSocketIO(io);

// Initialize Google Chat Service
const GoogleChatService = require("./services/google-chat");
const googleChatService = new GoogleChatService(pool);

// Initialize routes that depend on WhatsApp and Google Chat services
const whatsappBaileysRoutes = require("./routes/whatsapp-baileys")(
  pool,
  logger,
  whatsappService,
);
const announcementsRoutes = require("./routes/announcements")(
  pool,
  logger,
  whatsappService,
  googleChatService,
);
const googleChatRoutes = require("./routes/google-chat")(pool, logger);
const medicationRoutes = require("./routes/medication")(pool, logger);
const activitiesRoutes = require("./routes/activities")(pool);
const carpoolsRoutes = require("./routes/carpools")(pool);
const aiRoutes = require("./routes/ai");
const isAiBudgetMigrated = true; // Flag to indicate migration is planned/done


// ============================================
// MOUNT MODULAR ROUTES
// ============================================

// Authentication Routes (handles /public/login, /api/auth/*)
// Endpoints: login, register, request-reset, reset-password, verify-session, logout
app.use("/", authRoutes);
logger.info("✅ Authentication routes loaded");
logger.info("   - POST /public/login");
logger.info("   - POST /api/auth/register");
logger.info("   - POST /api/auth/request-reset");
logger.info("   - POST /api/auth/reset-password");
logger.info("   - POST /api/auth/verify-session");
logger.info("   - POST /api/auth/logout");

// Organization Routes (handles /api/organization-*, /public/get_organization_id)
// Endpoints: organization-jwt, get_organization_id, organization-settings, organizations, register-for-organization, switch-organization
app.use("/api", organizationsRoutes);
app.use("/public", organizationsRoutes);
logger.info("✅ Organization routes loaded");
logger.info("   - GET /api/organization-jwt");
logger.info("   - GET /public/get_organization_id");
logger.info("   - GET /api/organization-settings");
logger.info("   - POST /api/organizations");
logger.info("   - POST /api/register-for-organization");
logger.info("   - POST /api/switch-organization");

// User Management Routes (handles /api/users, /api/pending-users, /api/animateurs, etc.)
// Endpoints: users, pending-users, animateurs, parent-users, user-children, approve-user, update-user-role, link-user-participants, associate-user-participant, permissions/check
app.use("/api", usersRoutes);
logger.info("✅ User management routes loaded");
logger.info("   - GET /api/users");
logger.info("   - GET /api/pending-users");
logger.info("   - GET /api/animateurs");
logger.info("   - GET /api/parent-users");
logger.info("   - GET /api/user-children");
logger.info("   - POST /api/approve-user");
logger.info("   - POST /api/update-user-role");
logger.info("   - POST /api/link-user-participants");
logger.info("   - POST /api/associate-user-participant");
logger.info("   - POST /api/permissions/check");

// User Profile Routes (handles /api/v1/users/me/*)
// Endpoints: users/me (GET), users/me/name (PATCH), users/me/email (PATCH), users/me/password (PATCH)
app.use("/api", userProfileRoutes);
logger.info("✅ User profile routes loaded");
logger.info("   - GET /api/v1/users/me");
logger.info("   - PATCH /api/v1/users/me/name");
logger.info("   - PATCH /api/v1/users/me/email");
logger.info("   - PATCH /api/v1/users/me/password");

// Role Management Routes (handles /api/roles, /api/permissions, etc.)
// Endpoints: roles (GET, POST, DELETE), permissions (GET), users/:id/roles (GET, PUT)
// Role Management Routes (handles /api/roles, /api/permissions, etc.)
// Endpoints: roles (GET, POST, DELETE), permissions (GET), users/:id/roles (GET, PUT)
app.use("/", rolesRoutes);
logger.info("✅ Role management routes loaded");

// AI Routes
app.use("/api/ai", aiRoutes);
logger.info("✅ AI routes loaded");
logger.info("   - POST /api/ai/text");
logger.info("   - POST /api/ai/receipt");
logger.info("   - GET /api/ai/budget");
logger.info("   - GET /api/roles");
logger.info("   - POST /api/roles");
logger.info("   - DELETE /api/roles/:roleId");
logger.info("   - GET /api/roles/:roleId/permissions");
logger.info("   - POST /api/roles/:roleId/permissions");
logger.info("   - DELETE /api/roles/:roleId/permissions/:permissionId");
logger.info("   - GET /api/permissions");
logger.info("   - GET /api/users/:userId/roles");
logger.info("   - PUT /api/users/:userId/roles");

// AI Routes
app.use("/api/ai", aiRoutes);
logger.info("✅ AI routes loaded");
logger.info("   - POST /api/ai/text");
logger.info("   - POST /api/ai/receipt");
logger.info("   - GET /api/ai/budget");

// Meeting Routes (handles /api/reunion-preparation, /api/reunion-dates, /api/next-meeting-info, etc.)
// Endpoints: reunion-preparation, save-reunion-preparation, reunion-dates, next-meeting-info, get_reminder, reminder, save_reminder, activites-rencontre
// IMPORTANT: Must be mounted before participants routes to prevent /:id route from catching reunion-preparation
app.use("/api", meetingsRoutes);
logger.info("✅ Meetings routes loaded");
logger.info("   - GET /api/reunion-preparation");
logger.info("   - POST /api/save-reunion-preparation");
logger.info("   - GET /api/reunion-dates");
logger.info("   - GET /api/next-meeting-info");
logger.info("   - GET /api/get_reminder");
logger.info("   - GET /api/reminder");
logger.info("   - POST /api/save_reminder");
logger.info("   - GET /api/activites-rencontre");

// Fundraiser Entry Routes (handles /api/calendars, /api/calendars/:id, /api/participant-calendar)
// Uses fundraiser_entries database table
// Endpoints: calendars (GET/PUT), calendars/:id/payment, participant-calendar
// IMPORTANT: Must be mounted before participants routes to prevent /:id route from catching calendars
app.use("/api", calendarsRoutes);
logger.info("✅ Fundraiser entry routes loaded");
logger.info("   - GET /api/calendars");
logger.info("   - PUT /api/calendars/:id");
logger.info("   - PUT /api/calendars/:id/payment");
logger.info("   - GET /api/participant-calendar");

// Fundraiser Routes (handles /api/fundraisers)
// Endpoints: fundraisers (GET/POST), fundraisers/:id (GET/PUT), fundraisers/:id/archive
app.use("/api", fundraisersRoutes);
logger.info("✅ Fundraiser routes loaded");
logger.info("   - GET /api/fundraisers");
logger.info("   - POST /api/fundraisers");
logger.info("   - GET /api/fundraisers/:id");
logger.info("   - PUT /api/fundraisers/:id");
logger.info("   - PUT /api/fundraisers/:id/archive");

// Form Routes (handles /api/form-submission, /api/save-form-submission, /api/form-types, etc.)
// Endpoints: form-submission, save-form-submission, organization-form-formats, form-types, form-structure, form-submissions-list, form-submissions, risk-acceptance, health-forms
// IMPORTANT: Must be mounted before participants routes to prevent /:id route from catching organization-form-formats
app.use("/api", formsRoutes);
logger.info("✅ Forms routes loaded");
logger.info("   - GET /api/form-submission");
logger.info("   - POST /api/save-form-submission");
logger.info("   - GET /api/organization-form-formats");
logger.info("   - GET /api/form-types");
logger.info("   - GET /api/form-structure");
logger.info("   - GET /api/form-submissions-list");
logger.info("   - GET /api/form-submissions");
logger.info("   - GET /api/risk-acceptance");
logger.info("   - POST /api/risk-acceptance");
logger.info("   - POST /api/health-forms");

// Form Builder Routes (handles admin form format management)
// Endpoints: form-formats (CRUD), user-organizations, translations
app.use("/api", formBuilderRoutes);
logger.info("✅ Form Builder routes loaded");
logger.info("   - GET /api/form-formats");
logger.info("   - GET /api/form-formats/:id");
logger.info("   - POST /api/form-formats");
logger.info("   - PUT /api/form-formats/:id");
logger.info("   - DELETE /api/form-formats/:id");
logger.info("   - GET /api/user-organizations");
logger.info("   - GET /api/translations/keys");
logger.info("   - POST /api/translations");
logger.info("   - POST /api/form-formats/:sourceOrgId/:formType/copy");

// Report Routes (handles various report endpoints)
// Endpoints: mailing-list, health-report, attendance-report, missing-documents-report, health-contact-report, allergies-report, medication-report, vaccine-report, leave-alone-report, media-authorization-report, honors-report, points-report, parent-contact-list
// IMPORTANT: Must be mounted before participants routes to prevent /:id route from catching report endpoints
app.use("/api", reportsRoutes);
logger.info("✅ Report routes loaded");
logger.info("   - GET /api/mailing-list");
logger.info("   - GET /api/health-report");
logger.info("   - GET /api/attendance-report");
logger.info("   - GET /api/missing-documents-report");
logger.info("   - GET /api/health-contact-report");
logger.info("   - GET /api/allergies-report");
logger.info("   - GET /api/medication-report");
logger.info("   - GET /api/vaccine-report");
logger.info("   - GET /api/leave-alone-report");
logger.info("   - GET /api/media-authorization-report");
logger.info("   - GET /api/honors-report");
logger.info("   - GET /api/points-report");
logger.info("   - GET /api/parent-contact-list");

// Dashboard Routes (handles /api/initial-data, /api/parent-dashboard)
// Endpoints: initial-data, parent-dashboard
// IMPORTANT: Must be mounted before participants routes
app.use("/api", dashboardsRoutes);
logger.info("✅ Dashboard routes loaded");
logger.info("   - GET /api/initial-data");
logger.info("   - GET /api/parent-dashboard");

// Badge Routes (handles /api/badge-progress, /api/pending-badges, /api/save-badge-progress, etc.)
// Endpoints: badge-progress, pending-badges, save-badge-progress, approve-badge, reject-badge, badge-summary, badge-history, current-stars, badge-system-settings
// IMPORTANT: Must be mounted before participants routes
app.use("/api", badgesRoutes);
logger.info("✅ Badges routes loaded");
logger.info("   - GET /api/badge-progress");
logger.info("   - GET /api/pending-badges");
logger.info("   - POST /api/save-badge-progress");
logger.info("   - POST /api/approve-badge");
logger.info("   - POST /api/reject-badge");
logger.info("   - GET /api/badge-summary");
logger.info("   - GET /api/badge-history");
logger.info("   - GET /api/current-stars");
logger.info("   - GET /api/badge-system-settings");
logger.info("   - PUT /api/badge-progress/:id");

// Guardian Routes (handles /api/guardians, /api/save-guardian, /api/remove-guardian)
// Endpoints: guardians, save-guardian, remove-guardian
// IMPORTANT: Must be mounted before participants routes
app.use("/api", guardiansRoutes);
logger.info("✅ Guardians routes loaded");
logger.info("   - GET /api/guardians");
logger.info("   - POST /api/save-guardian");
logger.info("   - DELETE /api/remove-guardian");

// Notification Routes (handles /api/send-notification, /api/push-subscription)
// Endpoints: send-notification, push-subscription
app.use("/api", notificationsRoutes);
logger.info("✅ Notifications routes loaded");
logger.info("   - POST /api/send-notification");
logger.info("   - POST /api/push-subscription");
logger.info("   - POST /api/v1/push-subscription");

// Announcement Routes (handles /api/v1/announcements)
app.use("/api", announcementsRoutes);
logger.info("✅ Announcements routes loaded");
logger.info("   - POST /api/v1/announcements");
logger.info("   - GET /api/v1/announcements");

// WhatsApp Baileys Routes (handles /api/v1/whatsapp/baileys/*)
app.use("/api", whatsappBaileysRoutes);
logger.info("✅ WhatsApp Baileys routes loaded");
logger.info("   - POST /api/v1/whatsapp/baileys/connect");
logger.info("   - POST /api/v1/whatsapp/baileys/disconnect");
logger.info("   - GET /api/v1/whatsapp/baileys/status");
logger.info("   - POST /api/v1/whatsapp/baileys/test");

// Google Chat Routes (handles /api/google-chat/*)
app.use("/api", googleChatRoutes);
logger.info("✅ Google Chat routes loaded");
logger.info("   - POST /api/google-chat/config");
logger.info("   - GET /api/google-chat/config");
logger.info("   - POST /api/google-chat/spaces");
logger.info("   - GET /api/google-chat/spaces");
logger.info("   - POST /api/google-chat/send-message");
logger.info("   - POST /api/google-chat/broadcast");
logger.info("   - GET /api/google-chat/messages");

// Honors Routes (handles /api/honors, /api/award-honor, /api/honors-history, /api/recent-honors)
// Endpoints: honors, award-honor, honors-history, honors-report, recent-honors
app.use("/api", honorsRoutes);
logger.info("✅ Honors routes loaded");
logger.info("   - GET /api/honors");
logger.info("   - POST /api/award-honor");
logger.info("   - GET /api/honors-history");
logger.info("   - GET /api/recent-honors");

// Points Routes (handles /api/points-data, /api/update-points, /api/points-leaderboard)
// Endpoints: points-data, update-points, points-leaderboard, points-report
app.use("/api", pointsRoutes);
logger.info("✅ Points routes loaded");
logger.info("   - GET /api/points-data");
logger.info("   - POST /api/update-points");
logger.info("   - GET /api/points-leaderboard");

// Attendance Routes (handles /api/attendance, /api/attendance-dates, /api/update-attendance)
// Endpoints: attendance, attendance-dates, update-attendance
app.use("/api/v1/attendance", attendanceRoutes);
app.use("/api/attendance", attendanceRoutes);
logger.info("✅ Attendance routes loaded");
logger.info("   - GET /api/attendance");
logger.info("   - GET /api/attendance-dates");
logger.info("   - POST /api/update-attendance");

// Group Routes (handles /api/v1/groups CRUD operations)
// NOTE: Legacy /api mount removed to prevent /:id catch-all from intercepting other routes
app.use("/api/v1/groups", groupsRoutes);
logger.info("✅ Group routes loaded");
logger.info("   - GET /api/v1/groups");
logger.info("   - GET /api/v1/groups/:id");
logger.info("   - POST /api/v1/groups");
logger.info("   - PUT /api/v1/groups/:id");
logger.info("   - DELETE /api/v1/groups/:id");

// Local Group Routes (handles /api/v1/local-groups)
app.use("/api/v1/local-groups", localGroupsRoutes);
logger.info("✅ Local group routes loaded");
logger.info("   - GET /api/v1/local-groups");
logger.info("   - GET /api/v1/local-groups/memberships");
logger.info("   - POST /api/v1/local-groups/memberships");
logger.info("   - DELETE /api/v1/local-groups/memberships/:localGroupId");

// Public Routes (handles /api/translations, /api/news)
// Endpoints: translations, news
// IMPORTANT: Must be mounted before participants routes to remain accessible
app.use("/api", publicRoutes);
logger.info("✅ Public routes loaded");
logger.info("   - GET /api/translations");
logger.info("   - GET /api/news");

// Import Routes (handles /api/import-sisc for CSV imports)
// Admin-only endpoints for bulk data import
app.use("/api", importRoutes);
logger.info("✅ Import routes loaded");
logger.info("   - POST /api/import-sisc");

// Finance Routes (handles fee definitions, participant fees, payments, and finance reports)
app.use("/api", financeRoutes);
logger.info("✅ Finance routes loaded");
logger.info("   - CRUD /api/v1/finance/fee-definitions");
logger.info("   - CRUD /api/v1/finance/participant-fees");

// Stripe Payment Routes (handles payment intents and webhooks)
app.use("/api", stripeRoutes);
logger.info("✅ Stripe payment routes loaded");
logger.info("   - POST /api/v1/stripe/create-payment-intent");
logger.info("   - POST /api/v1/stripe/webhook");
logger.info("   - GET /api/v1/stripe/payment-status/:paymentIntentId");
logger.info("   - GET /api/v1/finance/reports/summary");

// Budget Routes (handles budget categories, items, expenses, and budget reports)
app.use("/api", budgetsRoutes);
logger.info("✅ Budget routes loaded");
logger.info("   - CRUD /api/v1/budget/categories");
logger.info("   - CRUD /api/v1/budget/items");
logger.info("   - CRUD /api/v1/budget/expenses");
logger.info("   - GET /api/v1/budget/reports/summary");
logger.info("   - GET /api/v1/expenses/summary");
logger.info("   - GET /api/v1/expenses/monthly");
logger.info("   - POST /api/v1/expenses/bulk");
logger.info("   - GET /api/v1/revenue/dashboard");
logger.info("   - GET /api/v1/revenue/by-source");
logger.info("   - GET /api/v1/revenue/by-category");
logger.info("   - GET /api/v1/revenue/comparison");

// External Revenue Routes (handles external donations, sponsorships, grants)
app.use("/api", externalRevenueRoutes);
logger.info("✅ External Revenue routes loaded");
logger.info("   - CRUD /api/v1/revenue/external");
logger.info("   - GET /api/v1/revenue/external/summary");

// Resource and permission slip routes
app.use("/api/v1/resources", resourcesRoutes);
logger.info("✅ Resource routes loaded");
logger.info("   - GET /api/v1/resources/equipment");
logger.info("   - POST /api/v1/resources/equipment");
logger.info("   - GET /api/v1/resources/equipment/reservations");
logger.info("   - POST /api/v1/resources/equipment/reservations");
logger.info("   - PATCH /api/v1/resources/equipment/reservations/:id");
logger.info("   - GET /api/v1/resources/permission-slips");
logger.info("   - POST /api/v1/resources/permission-slips");
logger.info("   - PATCH /api/v1/resources/permission-slips/:id/sign");
logger.info("   - GET /api/v1/resources/status/dashboard");

// Medication management routes
app.use("/api", medicationRoutes);
logger.info("✅ Medication routes loaded");
logger.info("   - GET /api/v1/medication/requirements");
logger.info("   - POST /api/v1/medication/requirements");
logger.info("   - PUT /api/v1/medication/requirements/:id");
logger.info("   - GET /api/v1/medication/fiche-medications");
logger.info("   - GET /api/v1/medication/participant-medications");
logger.info("   - GET /api/v1/medication/distributions");
logger.info("   - POST /api/v1/medication/distributions");
logger.info("   - PATCH /api/v1/medication/distributions/:id");

// Activity and carpool management routes
app.use("/api/v1/activities", activitiesRoutes);
logger.info("✅ Activity routes loaded");
logger.info("   - GET /api/v1/activities");
logger.info("   - GET /api/v1/activities/:id");
logger.info("   - POST /api/v1/activities");
logger.info("   - PUT /api/v1/activities/:id");
logger.info("   - DELETE /api/v1/activities/:id");
logger.info("   - GET /api/v1/activities/:id/participants");

app.use("/api/v1/carpools", carpoolsRoutes);
logger.info("✅ Carpool routes loaded");
logger.info("   - GET /api/v1/carpools/activity/:activityId");
logger.info("   - GET /api/v1/carpools/my-offers");
logger.info("   - POST /api/v1/carpools/offers");
logger.info("   - PUT /api/v1/carpools/offers/:id");
logger.info("   - DELETE /api/v1/carpools/offers/:id");
logger.info("   - POST /api/v1/carpools/assignments");
logger.info("   - DELETE /api/v1/carpools/assignments/:id");
logger.info("   - GET /api/v1/carpools/my-children-assignments");
logger.info("   - GET /api/v1/carpools/activity/:activityId/unassigned");

// Participant Routes (handles /api/participants, /api/participant-details, /api/save-participant, etc.)
// Endpoints: participants, participant-details, save-participant, update-participant-group, link-participant-to-organization, participants-with-users, link-user-participants, participants-with-documents
// IMPORTANT: Must be mounted LAST among /api routes because it has a catch-all /:id route that will match any path
app.use("/api/v1/participants", participantsRoutes);
app.use("/api", participantsRoutes);
logger.info("✅ Participant routes loaded");
logger.info("   - GET /api/participants");
logger.info("   - GET /api/participant-details");
logger.info("   - POST /api/save-participant");
logger.info("   - POST /api/update-participant-group");
logger.info("   - POST /api/link-participant-to-organization");
logger.info("   - GET /api/participants-with-users");
logger.info("   - POST /api/link-user-participants");
logger.info("   - GET /api/participants-with-documents");

// ============================================
// CORE APPLICATION ROUTES
// ============================================

// Health check endpoint for deployment (responds immediately, no auth required)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Robots.txt optimized for multi-tenant subdomains
app.get("/robots.txt", (req, res) => {
  const robotsContent = buildRobotsTxt(
    req.hostname,
    req.headers["x-forwarded-proto"],
  );
  res
    .type("text/plain")
    .set({
      "Cache-Control": `public, max-age=${ROBOTS_CACHE_SECONDS}, stale-while-revalidate=${ROBOTS_STALE_SECONDS}`,
      "X-Robots-Tag": "index, follow",
    })
    .send(robotsContent);
});

// Serve index.html for root route
app.get("/", (req, res) => {
  const isLandingHost = landingHosts.has(req.hostname);
  const indexPath = isLandingHost
    ? path.join(landingDir, "index.html")
    : isProduction
      ? path.join(__dirname, "dist", "index.html")
      : path.join(__dirname, "index.html");

  // Prevent caching of index.html to ensure PWA updates work properly
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(indexPath);
});


// ============================================
// GLOBAL ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  if (err instanceof OrganizationNotFoundError) {
    return respondWithOrganizationFallback(res);
  }

  logger.error("Unhandled error:", err);
  return res
    .status(500)
    .json({ success: false, message: "internal_server_error" });
});

// ============================================
// SPA CATCH-ALL ROUTE
// ============================================
// Serve index.html for all non-API routes
// This must be the last route handler
app.get("*", (req, res) => {
  // Don't catch API routes or static files
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/api-docs") ||
    req.path.match(
      /\.(js|css|png|jpg|jpeg|gif|heif|heic|svg|ico|woff|woff2|ttf|eot|webp|json)$/i,
    )
  ) {
    return res
      .status(404)
      .json({ success: false, message: "Endpoint not found" });
  }

  const indexPath = isProduction
    ? path.join(__dirname, "dist", "index.html")
    : path.join(__dirname, "index.html");
  // Prevent caching of index.html to ensure PWA updates work properly
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(indexPath);
});

// ============================================
// SOCKET.IO SETUP
// ============================================

// Socket.io authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }

  try {
    const { verifyJWT } = require("./utils/api-helpers");
    const payload = verifyJWT(token);

    if (!payload || !payload.user_id) {
      return next(new Error("Authentication error: Invalid token"));
    }

    socket.userId = payload.user_id;
    socket.organizationId = payload.organizationId;
    next();
  } catch (error) {
    next(new Error("Authentication error: " + error.message));
  }
});

// Socket.io connection handler
io.on("connection", (socket) => {
  logger.info(
    `Socket.io client connected: ${socket.id}, user: ${socket.userId}, org: ${socket.organizationId}`,
  );

  // Join organization room for targeted broadcasts
  if (socket.organizationId) {
    socket.join(`org-${socket.organizationId}`);
    logger.info(
      `Socket ${socket.id} joined room: org-${socket.organizationId}`,
    );
  }

  // Handle disconnection
  socket.on("disconnect", () => {
    logger.info(`Socket.io client disconnected: ${socket.id}`);
  });
});

// ============================================
// START SERVER
// ============================================

if (require.main === module) {
  server.listen(PORT, HOST, async () => {
    console.log(`Server running on ${HOST}:${PORT}`);
    console.log(`Socket.io enabled for real-time WhatsApp QR codes`);

    // Restore WhatsApp connections on server restart
    try {
      await whatsappService.restoreConnections();
      console.log("WhatsApp connections restored");
    } catch (error) {
      logger.error("Error restoring WhatsApp connections:", error);
    }

    // Register shutdown handlers after all services are initialized
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  });
}

module.exports = app;
