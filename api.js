require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { check, validationResult } = require('express-validator');
const winston = require('winston');
const path = require('path');
const fs = require('fs').promises;
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
const { success, error: errorResponse } = require('./middleware/response');
const { respondWithOrganizationFallback, OrganizationNotFoundError } = require('./utils/api-helpers');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

// Determine if we're in production mode
const isProduction = process.env.NODE_ENV === 'production';

// Compression middleware
let compression;
try {
  compression = require('compression');
  app.use(compression());
} catch (e) {
  logger.info('Compression not available. Install with: npm install compression');
}

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Enable strong ETags for better caching and bandwidth reduction
app.set('etag', 'strong');

// Security headers with Content Security Policy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"], // Note: Consider removing unsafe-inline and using nonces in production
      scriptSrcElem: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://cdnjs.cloudflare.com"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: [
        "'self'",
        "https://cdn.jsdelivr.net",
        "https://cdnjs.cloudflare.com",
      ],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

app.use(cors());

// Rate limiting configuration - relaxed limits for development
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 100 : 10000, // 100 in production, 10000 in development
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 5 : 1000, // 5 in production, 1000 in development
  message: 'Too many login attempts from this IP, please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Moderate rate limiter for password reset
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isProduction ? 3 : 100, // 3 in production, 100 in development
  message: 'Too many password reset requests from this IP, please try again after an hour.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiter to all routes
app.use(generalLimiter);

// Configure logging before database and error handlers
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Serve static files
// In production, serve from dist folder (Vite build output)
// In development, serve from root (Vite dev server handles the rest)
const staticDir = isProduction ? path.join(__dirname, 'dist') : __dirname;

logger.info(`Serving static files from: ${staticDir}`);
logger.info(`Environment: ${isProduction ? 'production' : 'development'}`);

app.use(express.static(staticDir, {
  setHeaders: (res, filepath) => {
    // Aggressive caching for production builds (1 year for hashed files)
    if (isProduction && (filepath.includes('-') && (filepath.endsWith('.js') || filepath.endsWith('.css')))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    // Extended caching for static assets (30 days = 2592000 seconds)
    else if (filepath.endsWith('.js') || filepath.endsWith('.css') || filepath.endsWith('.png') || filepath.endsWith('.jpg') || filepath.endsWith('.webp')) {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
  }
}));

// Database connection configuration
// SSL is enabled by default. Only disable certificate validation in development if explicitly set.
const poolConfig = {
  connectionString: process.env.SB_URL || process.env.DATABASE_URL
};

// Configure SSL based on environment
// Supabase requires SSL but uses certificates that may need relaxed validation
if (process.env.DATABASE_URL || process.env.SB_URL) {
  // Supabase connections need rejectUnauthorized: false due to certificate chain
  // SSL is still enabled - only certificate validation is relaxed
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

// Make pool available to middleware via app.locals
app.locals.pool = pool;

// Handle pool errors
pool.on('error', (err, client) => {
  logger.error('Unexpected error on idle PostgreSQL client:', err);
  // Pool errors are typically non-fatal (e.g., network issues)
  // The pool will handle reconnection automatically
});

// Handle uncaught exceptions
// These indicate serious programming errors that leave the application in an undefined state
process.on('uncaughtException', (err) => {
  logger.error('FATAL: Uncaught Exception - Application will shut down', {
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  });
  console.error('FATAL: Uncaught Exception:', err);

  // Give the logger time to write, then exit
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
// These should be treated as critical errors in production
process.on('unhandledRejection', (reason, promise) => {
  logger.error('FATAL: Unhandled Promise Rejection - Application will shut down', {
    reason: reason,
    promise: promise,
    timestamp: new Date().toISOString()
  });
  console.error('FATAL: Unhandled Promise Rejection at:', promise, 'reason:', reason);

  // In production, exit on unhandled rejections
  // Let a process manager (PM2, systemd) restart the application
  if (isProduction) {
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
});

// Validate JWT secret is configured
// Support legacy environment variable name `JWT_SECRET` for backward compatibility
const jwtKey = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;

if (!jwtKey) {
  console.error('FATAL ERROR: JWT_SECRET_KEY or JWT_SECRET environment variable is not set.');
  console.error('Please configure a secure JWT secret in your environment variables.');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}

// Helper function to get current organization ID from request
async function getCurrentOrganizationId(req) {
  // Try to get from header first
  if (req.headers['x-organization-id']) {
    return parseInt(req.headers['x-organization-id'], 10);
  }

  // Try to get from hostname/domain mapping
  const hostname = req.hostname;

  try {
    const result = await pool.query(
      'SELECT organization_id FROM organization_domains WHERE domain = $1',
      [hostname]
    );

    if (result.rows.length > 0) {
      return result.rows[0].organization_id;
    }
  } catch (error) {
    logger.error('Error getting organization ID:', error);
  }

  // Default to organization ID 1 if not found
  return 1;
}

// Helper function to get user ID from token
function getUserIdFromToken(token) {
  try {
    const decoded = jwt.verify(token, jwtKey);
    return decoded.user_id;
  } catch (e) {
    return null;
  }
}

// Helper function to get point system rules from organization settings
async function getPointSystemRules(organizationId, client = null) {
  const queryExecutor = client || pool;

  try {
    const result = await queryExecutor.query(
      `SELECT setting_value FROM organization_settings
       WHERE organization_id = $1 AND setting_key = 'point_system_rules'`,
      [organizationId]
    );

    if (result.rows.length > 0) {
      try {
        return JSON.parse(result.rows[0].setting_value);
      } catch (e) {
        logger.warn('Error parsing point_system_rules:', e);
      }
    }
  } catch (error) {
    logger.error('Error getting point system rules:', error);
  }

  // Default rules if not found
  return {
    attendance: {
      present: { label: 'present', points: 1 },
      absent: { label: 'absent', points: 0 },
      late: { label: 'late', points: 0 },
      excused: { label: 'excused', points: 0 }
    },
    honors: { award: 5 },
    badges: { earn: 5, level_up: 10 }
  };
}

// Helper function to calculate attendance point adjustment based on rules
function calculateAttendancePoints(previousStatus, newStatus, rules) {
  const attendanceRules = rules.attendance || {};

  const getPreviousPoints = (status) => {
    if (!status) return 0;
    const rule = attendanceRules[status];
    return rule ? (rule.points || 0) : 0;
  };

  const previousPoints = getPreviousPoints(previousStatus);
  const newPoints = getPreviousPoints(newStatus);

  return newPoints - previousPoints;
}

// Helper function to calculate attendance point adjustment (legacy version)
function calculatePointAdjustment(previousStatus, newStatus) {
  const pointMap = {
    'present': 1,
    'absent': 0,
    'late': 0,
    'excused': 0
  };

  const previousPoints = pointMap[previousStatus] || 0;
  const newPoints = pointMap[newStatus] || 0;

  return newPoints - previousPoints;
}

function jsonResponse(res, success, data = null, message = '') {
  res.json({
    success,
    data,
    message,
  });
}

function handleError(err, req, res, next) {
  logger.error(err.stack);
  res.status(500).json({ success: false, error: err.message });
}

function verifyJWT(token) {
  try {
    return jwt.verify(token, jwtKey);
  } catch (e) {
    return null;
  }
}

// Helper function to verify user belongs to organization with specific role
async function verifyOrganizationMembership(userId, organizationId, requiredRoles = null) {
  try {
    let query = `SELECT role FROM user_organizations
                 WHERE user_id = $1 AND organization_id = $2`;
    const params = [userId, organizationId];

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return { authorized: false, role: null, message: 'User not a member of this organization' };
    }

    const userRole = result.rows[0].role;

    if (requiredRoles && !requiredRoles.includes(userRole)) {
      return { authorized: false, role: userRole, message: 'Insufficient permissions' };
    }

    return { authorized: true, role: userRole };
  } catch (error) {
    logger.error('Error verifying organization membership:', error);
    return { authorized: false, role: null, message: 'Authorization check failed' };
  }
}

app.use((err, req, res, next) => {
  handleError(err, req, res, next);
});

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
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Wampums API Documentation'
}));

// API documentation JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpecs);
});

logger.info('📚 API Documentation available at: /api-docs');

// ============================================
// MODULAR ROUTE IMPORTS
// ============================================

// Import all route modules
const authRoutes = require('./routes/auth')(pool, logger);
const organizationsRoutes = require('./routes/organizations')(pool, logger);
const usersRoutes = require('./routes/users')(pool, logger);
const participantsRoutes = require('./routes/participants')(pool);
const groupsRoutes = require('./routes/groups')(pool);
const attendanceRoutes = require('./routes/attendance')(pool, logger);
const honorsRoutes = require('./routes/honors')(pool, logger);
const pointsRoutes = require('./routes/points')(pool, logger);
const badgesRoutes = require('./routes/badges')(pool, logger);
const formsRoutes = require('./routes/forms')(pool, logger);
const guardiansRoutes = require('./routes/guardians')(pool, logger);
const meetingsRoutes = require('./routes/meetings')(pool, logger);
const notificationsRoutes = require('./routes/notifications')(pool, logger);
const calendarsRoutes = require('./routes/calendars')(pool, logger);
const fundraisersRoutes = require('./routes/fundraisers')(pool, logger);
const reportsRoutes = require('./routes/reports')(pool, logger);
const dashboardsRoutes = require('./routes/dashboards')(pool, logger);
const publicRoutes = require('./routes/public')(pool, logger);
const importRoutes = require('./routes/import')(pool, logger);
const financeRoutes = require('./routes/finance')(pool, logger);
const budgetsRoutes = require('./routes/budgets')(pool, logger);
const externalRevenueRoutes = require('./routes/external-revenue')(pool, logger);
const resourcesRoutes = require('./routes/resources')(pool);

// ============================================
// MOUNT MODULAR ROUTES
// ============================================

// Authentication Routes (handles /public/login, /api/auth/*)
// Endpoints: login, register, request-reset, reset-password, verify-session, logout
app.use('/', authRoutes);
logger.info('✅ Authentication routes loaded');
logger.info('   - POST /public/login');
logger.info('   - POST /api/auth/register');
logger.info('   - POST /api/auth/request-reset');
logger.info('   - POST /api/auth/reset-password');
logger.info('   - POST /api/auth/verify-session');
logger.info('   - POST /api/auth/logout');

// Organization Routes (handles /api/organization-*, /public/get_organization_id)
// Endpoints: organization-jwt, get_organization_id, organization-settings, organizations, register-for-organization, switch-organization
app.use('/api', organizationsRoutes);
app.use('/public', organizationsRoutes);
logger.info('✅ Organization routes loaded');
logger.info('   - GET /api/organization-jwt');
logger.info('   - GET /public/get_organization_id');
logger.info('   - GET /api/organization-settings');
logger.info('   - POST /api/organizations');
logger.info('   - POST /api/register-for-organization');
logger.info('   - POST /api/switch-organization');

// User Management Routes (handles /api/users, /api/pending-users, /api/animateurs, etc.)
// Endpoints: users, pending-users, animateurs, parent-users, user-children, approve-user, update-user-role, link-user-participants, associate-user-participant, permissions/check
app.use('/api', usersRoutes);
logger.info('✅ User management routes loaded');
logger.info('   - GET /api/users');
logger.info('   - GET /api/pending-users');
logger.info('   - GET /api/animateurs');
logger.info('   - GET /api/parent-users');
logger.info('   - GET /api/user-children');
logger.info('   - POST /api/approve-user');
logger.info('   - POST /api/update-user-role');
logger.info('   - POST /api/link-user-participants');
logger.info('   - POST /api/associate-user-participant');
logger.info('   - POST /api/permissions/check');

// Meeting Routes (handles /api/reunion-preparation, /api/reunion-dates, /api/next-meeting-info, etc.)
// Endpoints: reunion-preparation, save-reunion-preparation, reunion-dates, next-meeting-info, get_reminder, reminder, save_reminder, activites-rencontre
// IMPORTANT: Must be mounted before participants routes to prevent /:id route from catching reunion-preparation
app.use('/api', meetingsRoutes);
logger.info('✅ Meetings routes loaded');
logger.info('   - GET /api/reunion-preparation');
logger.info('   - POST /api/save-reunion-preparation');
logger.info('   - GET /api/reunion-dates');
logger.info('   - GET /api/next-meeting-info');
logger.info('   - GET /api/get_reminder');
logger.info('   - GET /api/reminder');
logger.info('   - POST /api/save_reminder');
logger.info('   - GET /api/activites-rencontre');

// Calendar Routes (handles /api/calendars, /api/calendars/:id, /api/participant-calendar)
// Endpoints: calendars (GET/PUT), calendars/:id/payment, participant-calendar
// IMPORTANT: Must be mounted before participants routes to prevent /:id route from catching calendars
app.use('/api', calendarsRoutes);
logger.info('✅ Calendar routes loaded');
logger.info('   - GET /api/calendars');
logger.info('   - PUT /api/calendars/:id');
logger.info('   - PUT /api/calendars/:id/payment');
logger.info('   - GET /api/participant-calendar');

// Fundraiser Routes (handles /api/fundraisers)
// Endpoints: fundraisers (GET/POST), fundraisers/:id (GET/PUT), fundraisers/:id/archive
app.use('/api', fundraisersRoutes);
logger.info('✅ Fundraiser routes loaded');
logger.info('   - GET /api/fundraisers');
logger.info('   - POST /api/fundraisers');
logger.info('   - GET /api/fundraisers/:id');
logger.info('   - PUT /api/fundraisers/:id');
logger.info('   - PUT /api/fundraisers/:id/archive');

// Form Routes (handles /api/form-submission, /api/save-form-submission, /api/form-types, etc.)
// Endpoints: form-submission, save-form-submission, organization-form-formats, form-types, form-structure, form-submissions-list, form-submissions, risk-acceptance, health-forms
// IMPORTANT: Must be mounted before participants routes to prevent /:id route from catching organization-form-formats
app.use('/api', formsRoutes);
logger.info('✅ Forms routes loaded');
logger.info('   - GET /api/form-submission');
logger.info('   - POST /api/save-form-submission');
logger.info('   - GET /api/organization-form-formats');
logger.info('   - GET /api/form-types');
logger.info('   - GET /api/form-structure');
logger.info('   - GET /api/form-submissions-list');
logger.info('   - GET /api/form-submissions');
logger.info('   - GET /api/risk-acceptance');
logger.info('   - POST /api/risk-acceptance');
logger.info('   - POST /api/health-forms');

// Report Routes (handles various report endpoints)
// Endpoints: mailing-list, health-report, attendance-report, missing-documents-report, health-contact-report, allergies-report, medication-report, vaccine-report, leave-alone-report, media-authorization-report, honors-report, points-report, parent-contact-list
// IMPORTANT: Must be mounted before participants routes to prevent /:id route from catching report endpoints
app.use('/api', reportsRoutes);
logger.info('✅ Report routes loaded');
logger.info('   - GET /api/mailing-list');
logger.info('   - GET /api/health-report');
logger.info('   - GET /api/attendance-report');
logger.info('   - GET /api/missing-documents-report');
logger.info('   - GET /api/health-contact-report');
logger.info('   - GET /api/allergies-report');
logger.info('   - GET /api/medication-report');
logger.info('   - GET /api/vaccine-report');
logger.info('   - GET /api/leave-alone-report');
logger.info('   - GET /api/media-authorization-report');
logger.info('   - GET /api/honors-report');
logger.info('   - GET /api/points-report');
logger.info('   - GET /api/parent-contact-list');

// Dashboard Routes (handles /api/initial-data, /api/parent-dashboard)
// Endpoints: initial-data, parent-dashboard
// IMPORTANT: Must be mounted before participants routes
app.use('/api', dashboardsRoutes);
logger.info('✅ Dashboard routes loaded');
logger.info('   - GET /api/initial-data');
logger.info('   - GET /api/parent-dashboard');

// Badge Routes (handles /api/badge-progress, /api/pending-badges, /api/save-badge-progress, etc.)
// Endpoints: badge-progress, pending-badges, save-badge-progress, approve-badge, reject-badge, badge-summary, badge-history, current-stars, badge-system-settings
// IMPORTANT: Must be mounted before participants routes
app.use('/api', badgesRoutes);
logger.info('✅ Badges routes loaded');
logger.info('   - GET /api/badge-progress');
logger.info('   - GET /api/pending-badges');
logger.info('   - POST /api/save-badge-progress');
logger.info('   - POST /api/approve-badge');
logger.info('   - POST /api/reject-badge');
logger.info('   - GET /api/badge-summary');
logger.info('   - GET /api/badge-history');
logger.info('   - GET /api/current-stars');
logger.info('   - GET /api/badge-system-settings');
logger.info('   - PUT /api/badge-progress/:id');

// Guardian Routes (handles /api/guardians, /api/save-guardian, /api/remove-guardian)
// Endpoints: guardians, save-guardian, remove-guardian
// IMPORTANT: Must be mounted before participants routes
app.use('/api', guardiansRoutes);
logger.info('✅ Guardians routes loaded');
logger.info('   - GET /api/guardians');
logger.info('   - POST /api/save-guardian');
logger.info('   - DELETE /api/remove-guardian');

// Notification Routes (handles /api/send-notification, /api/push-subscription)
// Endpoints: send-notification, push-subscription
app.use('/api', notificationsRoutes);
logger.info('✅ Notifications routes loaded');
logger.info('   - POST /api/send-notification');
logger.info('   - POST /api/push-subscription');

// Honors Routes (handles /api/honors, /api/award-honor, /api/honors-history, /api/recent-honors)
// Endpoints: honors, award-honor, honors-history, honors-report, recent-honors
app.use('/api', honorsRoutes);
logger.info('✅ Honors routes loaded');
logger.info('   - GET /api/honors');
logger.info('   - POST /api/award-honor');
logger.info('   - GET /api/honors-history');
logger.info('   - GET /api/recent-honors');

// Points Routes (handles /api/points-data, /api/update-points, /api/points-leaderboard)
// Endpoints: points-data, update-points, points-leaderboard, points-report
app.use('/api', pointsRoutes);
logger.info('✅ Points routes loaded');
logger.info('   - GET /api/points-data');
logger.info('   - POST /api/update-points');
logger.info('   - GET /api/points-leaderboard');

// Attendance Routes (handles /api/attendance, /api/attendance-dates, /api/update-attendance)
// Endpoints: attendance, attendance-dates, update-attendance
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api', attendanceRoutes);
logger.info('✅ Attendance routes loaded');
logger.info('   - GET /api/attendance');
logger.info('   - GET /api/attendance-dates');
logger.info('   - POST /api/update-attendance');

// Group Routes (handles /api/v1/groups CRUD operations)
// NOTE: Legacy /api mount removed to prevent /:id catch-all from intercepting other routes
app.use('/api/v1/groups', groupsRoutes);
logger.info('✅ Group routes loaded');
logger.info('   - GET /api/v1/groups');
logger.info('   - GET /api/v1/groups/:id');
logger.info('   - POST /api/v1/groups');
logger.info('   - PUT /api/v1/groups/:id');
logger.info('   - DELETE /api/v1/groups/:id');

// Public Routes (handles /api/translations, /api/news)
// Endpoints: translations, news
// IMPORTANT: Must be mounted before participants routes to remain accessible
app.use('/api', publicRoutes);
logger.info('✅ Public routes loaded');
logger.info('   - GET /api/translations');
logger.info('   - GET /api/news');

// Import Routes (handles /api/import-sisc for CSV imports)
// Admin-only endpoints for bulk data import
app.use('/api', importRoutes);
logger.info('✅ Import routes loaded');
logger.info('   - POST /api/import-sisc');

// Finance Routes (handles fee definitions, participant fees, payments, and finance reports)
app.use('/api', financeRoutes);
logger.info('✅ Finance routes loaded');
logger.info('   - CRUD /api/v1/finance/fee-definitions');
logger.info('   - CRUD /api/v1/finance/participant-fees');
logger.info('   - GET /api/v1/finance/reports/summary');

// Budget Routes (handles budget categories, items, expenses, and budget reports)
app.use('/api', budgetsRoutes);
logger.info('✅ Budget routes loaded');
logger.info('   - CRUD /api/v1/budget/categories');
logger.info('   - CRUD /api/v1/budget/items');
logger.info('   - CRUD /api/v1/budget/expenses');
logger.info('   - GET /api/v1/budget/reports/summary');
logger.info('   - GET /api/v1/expenses/summary');
logger.info('   - GET /api/v1/expenses/monthly');
logger.info('   - POST /api/v1/expenses/bulk');
logger.info('   - GET /api/v1/revenue/dashboard');
logger.info('   - GET /api/v1/revenue/by-source');
logger.info('   - GET /api/v1/revenue/by-category');
logger.info('   - GET /api/v1/revenue/comparison');

// External Revenue Routes (handles external donations, sponsorships, grants)
app.use('/api', externalRevenueRoutes);
logger.info('✅ External Revenue routes loaded');
logger.info('   - CRUD /api/v1/revenue/external');
logger.info('   - GET /api/v1/revenue/external/summary');

// Resource and permission slip routes
app.use('/api/v1/resources', resourcesRoutes);
logger.info('✅ Resource routes loaded');
logger.info('   - GET /api/v1/resources/equipment');
logger.info('   - POST /api/v1/resources/equipment');
logger.info('   - GET /api/v1/resources/equipment/reservations');
logger.info('   - POST /api/v1/resources/equipment/reservations');
logger.info('   - PATCH /api/v1/resources/equipment/reservations/:id');
logger.info('   - GET /api/v1/resources/permission-slips');
logger.info('   - POST /api/v1/resources/permission-slips');
logger.info('   - PATCH /api/v1/resources/permission-slips/:id/sign');
logger.info('   - GET /api/v1/resources/status/dashboard');

// Participant Routes (handles /api/participants, /api/participant-details, /api/save-participant, etc.)
// Endpoints: participants, participant-details, save-participant, update-participant-group, link-participant-to-organization, participants-with-users, link-user-participants, participants-with-documents
// IMPORTANT: Must be mounted LAST among /api routes because it has a catch-all /:id route that will match any path
app.use('/api/v1/participants', participantsRoutes);
app.use('/api', participantsRoutes);
logger.info('✅ Participant routes loaded');
logger.info('   - GET /api/participants');
logger.info('   - GET /api/participant-details');
logger.info('   - POST /api/save-participant');
logger.info('   - POST /api/update-participant-group');
logger.info('   - POST /api/link-participant-to-organization');
logger.info('   - GET /api/participants-with-users');
logger.info('   - POST /api/link-user-participants');
logger.info('   - GET /api/participants-with-documents');

// ============================================
// CORE APPLICATION ROUTES
// ============================================

// Health check endpoint for deployment (responds immediately, no auth required)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for root route
app.get('/', (req, res) => {
  const indexPath = isProduction
    ? path.join(__dirname, 'dist', 'index.html')
    : path.join(__dirname, 'index.html');
  // Prevent caching of index.html to ensure PWA updates work properly
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(indexPath);
});

// ============================================
// LEGACY API ENDPOINT (Action-based routing)
// ============================================
// This large endpoint maintains backward compatibility with older frontend code
// that uses action-based routing (e.g., /api?action=get_participants)
// New code should use the RESTful endpoints above instead

app.get('/api', [
  check('action').isString().notEmpty(),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const action = req.query.action;
  const token = req.headers.authorization?.split(' ')[1];
  const decodedToken = verifyJWT(token);
  const userId = decodedToken?.user_id;

  if (!userId && !['login', 'register', 'request_reset', 'reset_password'].includes(action)) {
    return jsonResponse(res, false, null, 'Invalid or expired token');
  }

  const client = await pool.connect();

  try {
    // Get organization ID once for the entire request
    const organizationId = await getCurrentOrganizationId(req);

    switch (action) {
      case 'get_organization_id':
        jsonResponse(res, true, { organizationId });
        break;

      case 'get_form_types':
        const formTypesResult = await client.query(
          "SELECT DISTINCT form_type FROM organization_form_formats WHERE organization_id = $1 AND display_type = 'public'",
          [organizationId]
        );
        jsonResponse(res, true, formTypesResult.rows.map(row => row.form_type));
        break;

      case 'get_form_structure':
        const formType = req.query.form_type;
        if (!formType) {
          jsonResponse(res, false, null, 'Form type is required');
        } else {
          const formStructureResult = await client.query(
            "SELECT form_structure FROM organization_form_formats WHERE form_type = $1 AND organization_id = $2",
            [formType, organizationId]
          );
          if (formStructureResult.rows.length > 0) {
            jsonResponse(res, true, JSON.parse(formStructureResult.rows[0].form_structure));
          } else {
            jsonResponse(res, false, null, 'Form structure not found');
          }
        }
        break;

      case 'get_form_submissions':
        const formTypeForSubmissions = req.query.form_type;
        const participantId = req.query.participant_id;
        if (!formTypeForSubmissions) {
          jsonResponse(res, false, null, 'Form type is required');
        } else if (participantId) {
          const formSubmissionsResult = await client.query(
            "SELECT submission_data FROM form_submissions WHERE participant_id = $1 AND form_type = $2 AND organization_id = $3",
            [participantId, formTypeForSubmissions, organizationId]
          );
          if (formSubmissionsResult.rows.length > 0) {
            jsonResponse(res, true, JSON.parse(formSubmissionsResult.rows[0].submission_data));
          } else {
            jsonResponse(res, false, null, 'No submission data found');
          }
        } else {
          const allFormSubmissionsResult = await client.query(
            "SELECT fs.participant_id, fs.submission_data, p.first_name, p.last_name FROM form_submissions fs JOIN participant_organizations po ON fs.participant_id = po.participant_id JOIN participants p ON fs.participant_id = p.id WHERE po.organization_id = $1 AND fs.form_type = $2",
            [organizationId, formTypeForSubmissions]
          );
          jsonResponse(res, true, allFormSubmissionsResult.rows.map(row => ({
            participant_id: row.participant_id,
            first_name: row.first_name,
            last_name: row.last_name,
            submission_data: JSON.parse(row.submission_data),
          })));
        }
        break;

      case 'get_reunion_dates':
        const datesResult = await client.query(
          `SELECT DISTINCT date::text as date
           FROM reunion_preparations
           WHERE organization_id = $1
           ORDER BY date ASC`,
          [organizationId]
        );
        jsonResponse(res, true, datesResult.rows.map(row => row.date));
        break;

      case 'create_organization':
        const { name: orgName } = req.body;
        const userIdForOrg = getUserIdFromToken(token);

        try {
          await client.query('BEGIN');

          const newOrgResult = await client.query(
        `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
        [orgName]
          );
          const newOrganizationId = newOrgResult.rows[0].id;

          await client.query(
        `INSERT INTO organization_form_formats (organization_id, form_type, form_structure, display_type)
         SELECT $1, form_type, form_structure, 'public'
         FROM organization_form_formats
         WHERE organization_id = 0`,
        [newOrganizationId]
          );

          await client.query(
        `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
         VALUES ($1, 'organization_info', $2)`,
        [newOrganizationId, JSON.stringify(req.body)]
          );

          await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, role)
         VALUES ($1, $2, 'admin')`,
        [userIdForOrg, newOrganizationId]
          );

          await client.query('COMMIT');
          jsonResponse(res, true, null, 'Organization created successfully');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error; // Re-throw to be caught by outer try-catch
        }
        break;

      case 'update_points':
        const updates = req.body;
        const responses = [];

        try {
          await client.query('BEGIN');

          for (const update of updates) {
            if (update.type === 'group') {
              await client.query(
                `INSERT INTO points (participant_id, group_id, value, created_at, organization_id)
                 VALUES (NULL, $1, $2, $3, $4)`,
                [update.id, update.points, update.timestamp, organizationId]
              );

              const membersResult = await client.query(
                `SELECT p.id
                 FROM participants p
                 JOIN participant_groups pg ON p.id = pg.participant_id
                 WHERE pg.group_id = $1 AND pg.organization_id = $2`,
                [update.id, organizationId]
              );

              for (const member of membersResult.rows) {
                await client.query(
                  `INSERT INTO points (participant_id, group_id, value, created_at, organization_id)
                   VALUES ($1, NULL, $2, $3, $4)`,
                  [member.id, update.points, update.timestamp, organizationId]
                );
              }

              const groupTotalResult = await client.query(
                `SELECT COALESCE(SUM(value), 0) as total_points
                 FROM points
                 WHERE group_id = $1 AND participant_id IS NULL AND organization_id = $2`,
                [update.id, organizationId]
              );

              responses.push({
                type: 'group',
                id: update.id,
                totalPoints: groupTotalResult.rows[0].total_points,
                memberIds: membersResult.rows.map(row => row.id),
              });
            } else {
              await client.query(
                `INSERT INTO points (participant_id, group_id, value, created_at, organization_id)
                 VALUES ($1, NULL, $2, $3, $4)`,
                [update.id, update.points, update.timestamp, organizationId]
              );

              const individualTotalResult = await client.query(
                `SELECT COALESCE(SUM(value), 0) as total_points
                 FROM points
                 WHERE participant_id = $1 AND organization_id = $2`,
                [update.id, organizationId]
              );

              responses.push({
                type: 'individual',
                id: update.id,
                totalPoints: individualTotalResult.rows[0].total_points,
              });
            }
          }

          await client.query('COMMIT');
          jsonResponse(res, true, responses);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error; // Re-throw to be caught by outer try-catch
        }
        break;

      case 'get_acceptation_risque':
        const participantIdForRisque = req.query.participant_id;
        if (participantIdForRisque) {
          const acceptationRisqueResult = await client.query(
            `SELECT * FROM acceptation_risque WHERE participant_id = $1`,
            [participantIdForRisque]
          );
          if (acceptationRisqueResult.rows.length > 0) {
            jsonResponse(res, true, acceptationRisqueResult.rows[0]);
          } else {
            jsonResponse(res, false, null, 'Acceptation risque not found');
          }
        } else {
          jsonResponse(res, false, null, 'Invalid participant ID');
        }
        break;

      case 'save_acceptation_risque':
        const {
          participant_id,
          groupe_district,
          accepte_risques,
          accepte_covid19,
          participation_volontaire,
          declaration_sante,
          declaration_voyage,
          nom_parent_tuteur,
          date_signature,
        } = req.body;

        const saveAcceptationRisqueResult = await client.query(
          `INSERT INTO acceptation_risque
           (participant_id, groupe_district, accepte_risques, accepte_covid19,
            participation_volontaire, declaration_sante, declaration_voyage,
            nom_parent_tuteur, date_signature)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (participant_id) DO UPDATE SET
           groupe_district = EXCLUDED.groupe_district,
           accepte_risques = EXCLUDED.accepte_risques,
           accepte_covid19 = EXCLUDED.accepte_covid19,
           participation_volontaire = EXCLUDED.participation_volontaire,
           declaration_sante = EXCLUDED.declaration_sante,
           declaration_voyage = EXCLUDED.declaration_voyage,
           nom_parent_tuteur = EXCLUDED.nom_parent_tuteur,
           date_signature = EXCLUDED.date_signature`,
          [
            participant_id,
            groupe_district,
            accepte_risques,
            accepte_covid19,
            participation_volontaire,
            declaration_sante,
            declaration_voyage,
            nom_parent_tuteur,
            date_signature,
          ]
        );

        if (saveAcceptationRisqueResult.rowCount > 0) {
          jsonResponse(res, true, null, 'Acceptation risque saved successfully');
        } else {
          jsonResponse(res, false, null, 'Failed to save acceptation risque');
        }
        break;

      case 'get_guardians':
        const participantIdForGuardians = req.query.participant_id;
        if (participantIdForGuardians) {
          const guardianInfoResult = await client.query(
            "SELECT guardian_id, lien FROM participant_guardians WHERE participant_id = $1",
            [participantIdForGuardians]
          );
          const guardianInfo = guardianInfoResult.rows;

          if (guardianInfo.length > 0) {
            const guardianIds = guardianInfo.map(row => row.guardian_id);
            const lienInfo = guardianInfo.reduce((acc, row) => {
              acc[row.guardian_id] = row.lien;
              return acc;
            }, {});

            const guardianDetailsResult = await client.query(
              `SELECT id, nom, prenom, courriel, telephone_residence, telephone_travail,
                      telephone_cellulaire, is_primary, is_emergency_contact
               FROM parents_guardians
               WHERE id = ANY($1::int[])`,
              [guardianIds]
            );
            const guardians = guardianDetailsResult.rows;

            const customFormFormatResult = await client.query(
              "SELECT form_structure FROM organization_form_formats WHERE form_type = 'parent_guardian' AND organization_id = $1",
              [organizationId]
            );
            const customFormFormat = customFormFormatResult.rows[0]?.form_structure;

            const mergedData = guardians.map(guardian => ({
              ...guardian,
              lien: lienInfo[guardian.id],
              custom_form: customFormFormat ? JSON.parse(customFormFormat) : null,
            }));

            jsonResponse(res, true, mergedData);
          } else {
            jsonResponse(res, false, null, 'No guardians found for this participant.');
          }
        } else {
          jsonResponse(res, false, null, 'Missing participant_id parameter.');
        }
        break;

      case 'participant-age':
        const participantsResult = await client.query(
          `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                  EXTRACT(YEAR FROM AGE(p.date_naissance)) AS age
           FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE po.organization_id = $1
           ORDER BY p.date_naissance ASC, p.last_name`,
          [organizationId]
        );
        jsonResponse(res, true, participantsResult.rows);
        break;

      case 'get_health_report':
        const healthReportResult = await client.query(
          `SELECT p.id as participant_id, p.first_name, p.last_name,
                  fs.submission_data->>'epipen' AS epipen,
                  fs.submission_data->>'allergie' AS allergies,
                  fs.submission_data->>'probleme_sante' AS health_issues,
                  fs.submission_data->>'niveau_natation' AS swimming_level,
                  fs.submission_data->>'blessures_operations' AS injuries,
                  fs2.submission_data->>'peut_partir_seul' AS leave_alone,
                  fs2.submission_data->>'consentement_photos_videos' AS media_consent
           FROM participants p
           JOIN form_submissions fs ON fs.participant_id = p.id AND fs.form_type = 'fiche_sante'
           JOIN form_submissions fs2 ON fs2.participant_id = p.id AND fs2.form_type = 'participant_registration'
           JOIN participant_organizations po ON po.participant_id = p.id
           WHERE po.organization_id = $1`,
          [organizationId]
        );
        jsonResponse(res, true, healthReportResult.rows);
        break;

      case 'get_mailing_list':
        const usersEmailsResult = await client.query(
          `SELECT u.email, uo.role
           FROM user_organizations uo
           JOIN users u ON u.id = uo.user_id
           WHERE uo.organization_id = $1
           AND u.email IS NOT NULL
           AND u.email != ''`,
          [organizationId]
        );
        const usersEmails = usersEmailsResult.rows;

        const emailsByRole = usersEmails.reduce((acc, user) => {
          const role = user.role;
          const email = user.email.toLowerCase();
          if (!acc[role]) {
            acc[role] = [];
          }
          acc[role].push(email);
          return acc;
        }, {});

        const parentEmailsResult = await client.query(
          `SELECT LOWER(fs.submission_data->>'guardian_courriel_0') AS courriel,
                  string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
           FROM form_submissions fs
           JOIN participants p ON fs.participant_id = p.id
           WHERE (fs.submission_data->>'guardian_courriel_0') IS NOT NULL
           AND (fs.submission_data->>'guardian_courriel_0') != ''
           AND fs.organization_id = $1
           GROUP BY fs.submission_data->>'guardian_courriel_0'
           UNION
           SELECT LOWER(fs.submission_data->>'guardian_courriel_1') AS courriel,
                  string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
           FROM form_submissions fs
           JOIN participants p ON fs.participant_id = p.id
           WHERE (fs.submission_data->>'guardian_courriel_1') IS NOT NULL
           AND (fs.submission_data->>'guardian_courriel_1') != ''
           AND fs.organization_id = $1
           GROUP BY fs.submission_data->>'guardian_courriel_1'`,
          [organizationId]
        );
        const parentEmails = parentEmailsResult.rows;

        emailsByRole['parent'] = parentEmails.map(parent => ({
          email: parent.courriel,
          participants: parent.participants,
        }));

        const participantEmailsResult = await client.query(
          `SELECT LOWER(fs.submission_data->>'courriel') AS courriel
           FROM form_submissions fs
           WHERE (fs.submission_data->>'courriel') IS NOT NULL
           AND (fs.submission_data->>'courriel') != ''
           AND fs.organization_id = $1`,
          [organizationId]
        );
        const participantEmails = participantEmailsResult.rows.map(row => row.courriel);

        const allEmails = [
          ...new Set([
            ...Object.values(emailsByRole).flat().map(item => typeof item === 'string' ? item : item.email),
            ...participantEmails,
          ]),
        ];

        jsonResponse(res, true, {
          emails_by_role: emailsByRole,
          participant_emails: participantEmails,
          unique_emails: allEmails,
        });
        break;

      case 'get_organization_form_formats':
        const orgIdForFormats = req.query.organization_id || organizationId;
        const formFormatsResult = await client.query(
          `SELECT form_type, form_structure
           FROM organization_form_formats
           WHERE organization_id = $1`,
          [orgIdForFormats]
        );
        const formFormats = formFormatsResult.rows.reduce((acc, form) => {
          acc[form.form_type] = JSON.parse(form.form_structure);
          return acc;
        }, {});
        jsonResponse(res, true, formFormats);
        break;

      case 'get_activites_rencontre':
        const activitesResult = await client.query(
          "SELECT * FROM activites_rencontre ORDER BY activity"
        );
        jsonResponse(res, true, activitesResult.rows);
        break;

      case 'get_animateurs':
        const animateursResult = await client.query(
          `SELECT u.id, u.full_name
           FROM users u
           JOIN user_organizations uo ON u.id = uo.user_id
           WHERE uo.organization_id = $1
           AND uo.role IN ('animation')
           ORDER BY u.full_name`,
          [organizationId]
        );
        jsonResponse(res, true, animateursResult.rows);
        break;

      case 'get_recent_honors':
        const recentHonorsResult = await client.query(
          `SELECT p.id, p.first_name, p.last_name
           FROM participants p
           JOIN honors h ON p.id = h.participant_id
           WHERE h.date = (SELECT MAX(h2.date) FROM honors h2 WHERE h2.organization_id = $1)
           AND h.organization_id = $1
           ORDER BY h.date DESC`,
          [organizationId]
        );
        jsonResponse(res, true, recentHonorsResult.rows);
        break;

      case 'save_reminder':
        const { reminder_date, is_recurring, reminder_text } = req.body;
        await client.query(
          `INSERT INTO rappel_reunion (organization_id, reminder_date, is_recurring, reminder_text)
           VALUES ($1, $2, $3, $4)`,
          [getCurrentOrganizationId(), reminder_date, is_recurring, reminder_text]
        );
        jsonResponse(res, true, null, 'Reminder saved successfully');
        break;

      case 'get_reminder':
        const reminderResult = await client.query(
          `SELECT * FROM rappel_reunion
           WHERE organization_id = $1
           ORDER BY creation_time DESC LIMIT 1`,
          [organizationId]
        );
        if (reminderResult.rows.length > 0) {
          jsonResponse(res, true, reminderResult.rows[0]);
        } else {
          jsonResponse(res, false, null, 'No reminder found');
        }
        break;

      case 'save_reunion_preparation':
        const { date, animateur_responsable, louveteau_dhonneur, endroit, activities, notes } = req.body;
        await client.query(
          `INSERT INTO reunion_preparations (organization_id, date, animateur_responsable, louveteau_dhonneur, endroit, activities, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (organization_id, date) DO UPDATE SET
           animateur_responsable = EXCLUDED.animateur_responsable,
           louveteau_dhonneur = EXCLUDED.louveteau_dhonneur,
           endroit = EXCLUDED.endroit,
           activities = EXCLUDED.activities,
           notes = EXCLUDED.notes,
           updated_at = CURRENT_TIMESTAMP`,
          [getCurrentOrganizationId(), date, animateur_responsable, JSON.stringify(louveteau_dhonneur), endroit, JSON.stringify(activities), notes]
        );
        jsonResponse(res, true, null, 'Reunion preparation saved successfully');
        break;

      case 'get_reunion_preparation':
        const reunionDate = req.query.date || new Date().toISOString().split('T')[0];
        const reunionPreparationResult = await client.query(
          `SELECT * FROM reunion_preparations
           WHERE organization_id = $1 AND date = $2`,
          [getCurrentOrganizationId(), reunionDate]
        );
        if (reunionPreparationResult.rows.length > 0) {
          const preparation = reunionPreparationResult.rows[0];
          preparation.louveteau_dhonneur = JSON.parse(preparation.louveteau_dhonneur);
          preparation.activities = JSON.parse(preparation.activities);
          jsonResponse(res, true, preparation);
        } else {
          jsonResponse(res, false, null, 'No reunion preparation found for this date');
        }
        break;

      case 'get_organization_settings':
        const settingsResult = await client.query(
          `SELECT setting_key, setting_value
           FROM organization_settings
           WHERE organization_id = $1`,
          [organizationId]
        );
        const settings = settingsResult.rows.reduce((acc, setting) => {
          const decodedValue = JSON.parse(setting.setting_value);
          acc[setting.setting_key] = decodedValue !== null ? decodedValue : setting.setting_value;
          return acc;
        }, {});
        jsonResponse(res, true, settings);
        break;

      case 'register_for_organization':
        const { registration_password, role, link_children } = req.body;
        const correctPasswordResult = await client.query(
          `SELECT setting_value
           FROM organization_settings
           WHERE setting_key = 'registration_password'
           AND organization_id = $1`,
          [organizationId]
        );
        const correctPassword = correctPasswordResult.rows[0]?.setting_value;

        if (registration_password !== correctPassword) {
          jsonResponse(res, false, null, 'Invalid registration password');
        } else {
          await client.query(
            `INSERT INTO user_organizations (user_id, organization_id, role)
             VALUES ($1, $2, $3)`,
            [userId, getCurrentOrganizationId(), role]
          );

          if (link_children && link_children.length > 0) {
            // Fixed SQL syntax - using PostgreSQL syntax instead of MySQL
            const linkChildrenQuery = `
              INSERT INTO participant_organizations (participant_id, organization_id)
              VALUES ${link_children.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ')}
            `;
            const linkChildrenValues = link_children.flatMap(childId => [childId, organizationId]);
            await client.query(linkChildrenQuery, linkChildrenValues);
          }

          jsonResponse(res, true, null, 'Successfully registered for organization');
        }
        break;

      case 'get_user_children':
        const userChildrenResult = await client.query(
          `SELECT p.id, p.first_name, p.last_name
           FROM participants p
           JOIN user_participants up ON p.id = up.participant_id
           WHERE up.user_id = $1`,
          [userId]
        );
        jsonResponse(res, true, userChildrenResult.rows);
        break;

      case 'get_calendars':
        const calendarsResult = await client.query(
          `SELECT p.id AS participant_id, p.first_name, p.last_name,
                  COALESCE(c.amount, 0) AS calendar_amount,
                  COALESCE(c.amount_paid, 0) AS amount_paid,
                  COALESCE(c.paid, FALSE) AS paid,
                  c.updated_at
           FROM participants p
           LEFT JOIN calendars c ON p.id = c.participant_id AND c.organization_id = $1
           LEFT JOIN participant_organizations po ON po.participant_id = p.id AND po.organization_id = $1
           WHERE po.organization_id = $1
           OR p.id IN (SELECT participant_id FROM calendars WHERE organization_id = $1)
           ORDER BY p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, calendarsResult.rows);
        break;

      case 'update_calendar':
        const { participant_id: participantIdCal, amount, amount_paid } = req.body;
        await client.query(
          `INSERT INTO calendars (participant_id, amount, amount_paid, paid, organization_id)
           VALUES ($1, $2, $3, FALSE, $4)
           ON CONFLICT (participant_id, organization_id)
           DO UPDATE SET amount = EXCLUDED.amount, amount_paid = EXCLUDED.amount_paid, updated_at = CURRENT_TIMESTAMP`,
          [participantIdCal, amount, amount_paid || 0, organizationId]
        );
        jsonResponse(res, true, null, 'Calendar updated successfully');
        break;

      case 'update_calendar_amount_paid':
        const { participant_id: participantIdAmountPaid, amount_paid: amountPaidUpdate } = req.body;
        await client.query(
          `UPDATE calendars
           SET amount_paid = $1, updated_at = CURRENT_TIMESTAMP
           WHERE participant_id = $2 AND organization_id = $3`,
          [amountPaidUpdate, participantIdAmountPaid, organizationId]
        );
        jsonResponse(res, true, null, 'Calendar amount paid updated successfully');
        break;

      case 'save_guest':
        const { name, email, attendance_date } = req.body;
        await client.query(
          `INSERT INTO guests (name, email, attendance_date, organization_id)
           VALUES ($1, $2, $3, $4)`,
          [name, email, attendance_date, organizationId]
        );
        jsonResponse(res, true, null, 'Guest added successfully');
        break;

      case 'get_guests_by_date':
        const dateForGuests = req.query.date || new Date().toISOString().split('T')[0];
        const guestsResult = await client.query(
          `SELECT * FROM guests WHERE attendance_date = $1 AND organization_id = $2`,
          [dateForGuests, organizationId]
        );
        jsonResponse(res, true, guestsResult.rows);
        break;

      case 'attendance':
      case 'get_attendance':
        const dateForAttendance = req.query.date || new Date().toISOString().split('T')[0];
        const orgIdForAttendance = organizationId;
        const attendanceResult = await client.query(
          `SELECT a.participant_id, a.status
           FROM attendance a
           JOIN participants p ON a.participant_id = p.id
           JOIN participant_organizations po ON po.participant_id = p.id
           WHERE a.date = $1 AND po.organization_id = $2`,
          [dateForAttendance, orgIdForAttendance]
        );
        jsonResponse(res, true, attendanceResult.rows);
        break;

      case 'get_attendance_dates':
        const attendanceDatesResult = await client.query(
          `SELECT DISTINCT date::text as date
           FROM attendance
           WHERE date <= CURRENT_DATE AND organization_id = $1
           ORDER BY date DESC`,
          [organizationId]
        );
        jsonResponse(res, true, attendanceDatesResult.rows.map(row => row.date));
        break;

      case 'getAvailableDates':
        const availableDatesResult = await client.query(
          `SELECT DISTINCT date::text as date
           FROM honors
           WHERE organization_id = $1
           ORDER BY date DESC`,
          [organizationId]
        );
        jsonResponse(res, true, availableDatesResult.rows.map(row => row.date));
        break;

      case 'remove_group':
        const { group_id } = req.body;
        await client.query('BEGIN');
        try {
          await client.query(
            `UPDATE participants
             SET group_id = NULL
             WHERE group_id = $1`,
            [group_id]
          );
          await client.query(
            `DELETE FROM groups
             WHERE id = $1 AND organization_id = $2`,
            [group_id, organizationId]
          );
          await client.query('COMMIT');
          jsonResponse(res, true, null, 'Group removed successfully');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        break;

      case 'add_group':
        const { group_name } = req.body;
        const orgIdForGroup = getCurrentOrganizationId();
        await client.query(
          `INSERT INTO groups (name, organization_id)
           VALUES ($1, $2)`,
          [group_name, orgIdForGroup]
        );
        jsonResponse(res, true, null, 'Group added successfully');
        break;

      case 'get_health_contact_report':
        const healthContactReportResult = await client.query(
          `SELECT
            p.id AS participant_id,
            p.first_name,
            p.last_name,
            p.date_naissance,
            g.name AS group_name,
            fs.*
          FROM participants p
          JOIN participant_organizations po ON p.id = po.participant_id
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = po.organization_id
          LEFT JOIN groups g ON pg.group_id = g.id
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
          WHERE po.organization_id = $1
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, healthContactReportResult.rows);
        break;

      case 'get_attendance_report':
        const endDate = req.query.end_date || new Date().toISOString().split('T')[0];
        const startDate = req.query.start_date || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];

        const totalDaysResult = await client.query(
          `SELECT COUNT(DISTINCT date) as total_days
           FROM attendance
           WHERE date BETWEEN $1 AND $2
           AND organization_id = $3`,
          [startDate, endDate, organizationId]
        );
        const totalDays = totalDaysResult.rows[0].total_days;

        const attendanceDataResult = await client.query(
          `WITH attendance_days AS (
            SELECT DISTINCT date
            FROM attendance
            WHERE date BETWEEN $1 AND $2
            AND organization_id = $3
          ),
          attendance_data AS (
            SELECT
              p.id,
              p.first_name,
              p.last_name,
              g.name AS group_name,
              a.date,
              a.status
            FROM participants p
            INNER JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $3
            INNER JOIN groups g ON pg.group_id = g.id AND g.organization_id = $3
            LEFT JOIN attendance a ON p.id = a.participant_id AND a.organization_id = $3
            WHERE a.date BETWEEN $1 AND $2
          )
          SELECT
            p.id,
            p.first_name,
            p.last_name,
            g.name AS group_name,
            json_agg(json_build_object('date', a.date, 'status', a.status)) AS attendance
          FROM participants p
          INNER JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $3
          INNER JOIN groups g ON pg.group_id = g.id AND g.organization_id = $3
          LEFT JOIN attendance_data a ON p.id = a.id
          GROUP BY p.id, p.first_name, p.last_name, g.name
          ORDER BY g.name, p.last_name, p.first_name`,
          [startDate, endDate, organizationId]
        );

        jsonResponse(res, true, {
          start_date: startDate,
          end_date: endDate,
          total_days: totalDays,
          attendance_data: attendanceDataResult.rows,
        });
        break;

      case 'get_allergies_report':
        const allergiesReportResult = await client.query(
          `SELECT
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            fs.submission_data->>'allergie' AS allergies,
            (fs.submission_data->>'epipen')::boolean AS epipen
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE fs.form_type = 'fiche_sante'
          AND (fs.submission_data->>'allergie' IS NOT NULL AND fs.submission_data->>'allergie' != '')
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, allergiesReportResult.rows);
        break;

      case 'get_medication_report':
        const medicationReportResult = await client.query(
          `SELECT
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            fs.submission_data->>'medicament' AS medication
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE fs.form_type = 'fiche_sante'
          AND (fs.submission_data->>'medicament' IS NOT NULL AND fs.submission_data->>'medicament' != '')
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, medicationReportResult.rows);
        break;

      case 'get_vaccine_report':
        const vaccineReportResult = await client.query(
          `SELECT
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            (fs.submission_data->>'vaccins_a_jour')::boolean AS vaccines_up_to_date
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE fs.form_type = 'fiche_sante'
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, vaccineReportResult.rows);
        break;

      case 'get_leave_alone_report':
        const leaveAloneReportResult = await client.query(
          `SELECT
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            (fs.submission_data->>'peut_partir_seul')::boolean AS can_leave_alone
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE fs.form_type = 'participant_registration'
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, leaveAloneReportResult.rows);
        break;

      case 'get_media_authorization_report':
        const mediaAuthorizationReportResult = await client.query(
          `SELECT
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            (fs.submission_data->>'consentement_photos_videos')::boolean AS media_authorized
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE fs.form_type = 'participant_registration'
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, mediaAuthorizationReportResult.rows);
        break;

      case 'get_missing_documents_report':
        const missingDocumentsReportResult = await client.query(
          `SELECT
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            CASE WHEN fs_fiche.id IS NULL THEN 'Fiche Santé' ELSE NULL END AS missing_fiche_sante,
            CASE WHEN fs_risque.id IS NULL THEN 'Acceptation Risque' ELSE NULL END AS missing_acceptation_risque
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs_fiche ON p.id = fs_fiche.participant_id AND fs_fiche.form_type = 'fiche_sante' AND fs_fiche.organization_id = $1
          LEFT JOIN form_submissions fs_risque ON p.id = fs_risque.participant_id AND fs_risque.form_type = 'acceptation_risque' AND fs_risque.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE (fs_fiche.id IS NULL OR fs_risque.id IS NULL)
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        const missingDocuments = missingDocumentsReportResult.rows.map(row => ({
          ...row,
          missing_documents: [row.missing_fiche_sante, row.missing_acceptation_risque].filter(Boolean),
        }));
        jsonResponse(res, true, missingDocuments);
        break;

      case 'get_honors_report':
        const honorsReportResult = await client.query(
          `SELECT
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            COUNT(h.id) AS honors_count
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN honors h ON p.id = h.participant_id AND h.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          GROUP BY p.id, g.name
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, honorsReportResult.rows);
        break;

      case 'get_points_report':
        const pointsReportResult = await client.query(
          `SELECT
            g.name AS group_name,
            p.first_name || ' ' || p.last_name AS name,
            COALESCE(SUM(pt.value), 0) AS points
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN points pt ON p.id = pt.participant_id AND pt.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          GROUP BY g.id, p.id
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        const groupedPoints = pointsReportResult.rows.reduce((acc, row) => {
          if (!acc[row.group_name]) {
            acc[row.group_name] = [];
          }
          acc[row.group_name].push({ name: row.name, points: row.points });
          return acc;
        }, {});
        jsonResponse(res, true, groupedPoints);
        break;

      case 'logout':
        // Session handling would depend on your session middleware
        // If using express-session: req.session = null;
        jsonResponse(res, true, null, 'Logged out successfully');
        break;

      case 'get_groups':
        const orgIdForGroups = getCurrentOrganizationId();
        const groupsResult = await client.query(
          `SELECT
            g.id,
            g.name,
            COALESCE(SUM(pt.value), 0) AS total_points
           FROM groups g
           LEFT JOIN points pt ON pt.group_id = g.id AND pt.organization_id = $1
           WHERE g.organization_id = $1
           GROUP BY g.id, g.name
           ORDER BY g.name`,
          [orgIdForGroups]
        );
        jsonResponse(res, true, groupsResult.rows);
        break;

      case 'update_attendance':
        const { participant_id: participantIdAttendance, status, date: dateAttendance } = req.body;
        const orgIdForAttendanceUpdate = getCurrentOrganizationId();
        const participantIds = Array.isArray(participantIdAttendance) ? participantIdAttendance : [participantIdAttendance];

        try {
          await client.query('BEGIN');

          for (const participantId of participantIds) {
            const previousStatusResult = await client.query(
              `SELECT status
               FROM attendance
               WHERE participant_id = $1 AND date = $2 AND organization_id = $3`,
              [participantId, dateAttendance, orgIdForAttendanceUpdate]
            );
            const previousStatus = previousStatusResult.rows[0]?.status || 'none';

            await client.query(
              `INSERT INTO attendance (participant_id, date, status, organization_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (participant_id, date, organization_id)
               DO UPDATE SET status = EXCLUDED.status`,
              [participantId, dateAttendance, status, orgIdForAttendanceUpdate]
            );

            const pointAdjustment = calculatePointAdjustment(previousStatus, status);
            if (pointAdjustment !== 0) {
              await client.query(
                `INSERT INTO points (participant_id, value, created_at, organization_id)
                 VALUES ($1, $2, $3, $4)`,
                [participantId, pointAdjustment, dateAttendance, orgIdForAttendanceUpdate]
              );
            }
          }

          await client.query('COMMIT');
          jsonResponse(res, true, null, 'Attendance updated successfully');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        break;

      case 'get_honors':
        const dateForHonors = req.query.date || new Date().toISOString().split('T')[0];
        const academicYearStart = new Date().getMonth() >= 8 ? `${new Date().getFullYear()}-09-01` : `${new Date().getFullYear() - 1}-09-01`;
        const orgIdForHonors = getCurrentOrganizationId();

        const participantsForHonorsResult = await client.query(
          `SELECT
            p.id AS participant_id,
            p.first_name,
            p.last_name,
            pg.group_id,
            COALESCE(g.name, 'no_group') AS group_name
           FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = po.organization_id
           LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = po.organization_id
           WHERE po.organization_id = $1
           ORDER BY g.name, p.last_name, p.first_name`,
          [orgIdForHonors]
        );

        const honorsForDateResult = await client.query(
          `SELECT
            participant_id,
            date
           FROM honors
           WHERE date >= $1 AND date <= $2 AND organization_id = $3`,
          [academicYearStart, dateForHonors, orgIdForHonors]
        );

        const availableDatesForHonorsResult = await client.query(
          `SELECT DISTINCT
            date
           FROM honors
           WHERE organization_id = $1 AND date >= $2 AND date <= CURRENT_DATE
           ORDER BY date DESC`,
          [orgIdForHonors, academicYearStart]
        );

        jsonResponse(res, true, {
          participants: participantsForHonorsResult.rows,
          honors: honorsForDateResult.rows,
          availableDates: availableDatesForHonorsResult.rows.map(row => row.date),
        });
        break;

      case 'award_honor':
        const honors = req.body;
        const orgIdForAwardHonor = await getCurrentOrganizationId(req);

        try {
          await client.query('BEGIN');

          // Get point system rules for this organization
          const honorPointRules = await getPointSystemRules(orgIdForAwardHonor, client);
          const honorAwardPoints = honorPointRules.honors?.award || 5;

          const awards = [];
          for (const honor of honors) {
            const { participantId, date } = honor;

            const honorResult = await client.query(
              `INSERT INTO honors (participant_id, date, organization_id)
               VALUES ($1, $2, $3)
               ON CONFLICT (participant_id, date, organization_id) DO NOTHING
               RETURNING id`,
              [participantId, date, orgIdForAwardHonor]
            );

            if (honorResult.rows.length > 0) {
              // Get participant's group for proper point tracking
              const groupResultForHonor = await client.query(
                `SELECT group_id FROM participant_groups
                 WHERE participant_id = $1 AND organization_id = $2`,
                [participantId, orgIdForAwardHonor]
              );
              const groupIdForHonor = groupResultForHonor.rows.length > 0 ? groupResultForHonor.rows[0].group_id : null;

              await client.query(
                `INSERT INTO points (participant_id, group_id, value, created_at, organization_id)
                 VALUES ($1, $2, $3, $4, $5)`,
                [participantId, groupIdForHonor, honorAwardPoints, date, orgIdForAwardHonor]
              );
              console.log(`[honor-legacy] Participant ${participantId} awarded honor on ${date}, points: +${honorAwardPoints}`);
              awards.push({ participantId, awarded: true, points: honorAwardPoints });
            } else {
              awards.push({ participantId, awarded: false, message: 'Honor already awarded for this date' });
            }
          }

          await client.query('COMMIT');
          jsonResponse(res, true, awards);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        break;

      case 'get_badge_progress':
        const participantIdForBadge = req.query.participant_id;

        if (participantIdForBadge) {
          const badgeProgressResult = await client.query(
            `SELECT * FROM badge_progress WHERE participant_id = $1 AND organization_id = $2`,
            [participantIdForBadge, organizationId]
          );
          jsonResponse(res, true, badgeProgressResult.rows);
        } else {
          jsonResponse(res, false, null, 'Participant ID is required');
        }
        break;

      default:
        jsonResponse(res, false, null, 'Invalid action');
        break;
    }
  } catch (error) {
    logger.error('Database error:', error);
    jsonResponse(res, false, null, 'Internal server error');
  } finally {
    client.release();
  }
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  if (err instanceof OrganizationNotFoundError) {
    return respondWithOrganizationFallback(res);
  }

  logger.error('Unhandled error:', err);
  return res.status(500).json({ success: false, message: 'internal_server_error' });
});

// ============================================
// SPA CATCH-ALL ROUTE
// ============================================
// Serve index.html for all non-API routes
// This must be the last route handler
app.get('*', (req, res) => {
  // Don't catch API routes or static files
  if (req.path.startsWith('/api') || req.path.startsWith('/api-docs')) {
    return res.status(404).json({ success: false, message: 'Endpoint not found' });
  }

  const indexPath = isProduction
    ? path.join(__dirname, 'dist', 'index.html')
    : path.join(__dirname, 'index.html');
  // Prevent caching of index.html to ensure PWA updates work properly
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(indexPath);
});

// ============================================
// START SERVER
// ============================================

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
  });
}

module.exports = app;
