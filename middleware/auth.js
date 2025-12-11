// Authentication and Authorization Middleware
const jwt = require('jsonwebtoken');
const winston = require('winston');
const { OrganizationNotFoundError, respondWithOrganizationFallback } = require('../utils/api-helpers');

// Configure logger for auth middleware
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Validate JWT secret is configured
const jwtKey = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;

if (!jwtKey) {
  throw new Error('JWT_SECRET_KEY or JWT_SECRET environment variable is required');
}

/**
 * Verify JWT token and attach user to request
 */
exports.authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        timestamp: new Date().toISOString()
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, jwtKey);

    // Attach user info to request
    req.user = {
      id: decoded.user_id,
      role: decoded.user_role,
      organizationId: decoded.organizationId
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Check if user has required role(s)
 * @param {Array|String} roles - Required role(s)
 */
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        timestamp: new Date().toISOString()
      });
    }

    const allowedRoles = Array.isArray(roles[0]) ? roles[0] : roles;

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

/**
 * Optional authentication - attaches user if token exists but doesn't require it
 */
exports.optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, jwtKey);

      req.user = {
        id: decoded.user_id,
        role: decoded.user_role,
        organizationId: decoded.organizationId
      };
    }
  } catch (error) {
    // Ignore errors for optional auth
  }

  next();
};

/**
 * Get organization ID from request (header or user context)
 */
exports.getOrganizationId = async (req, pool) => {
  logger.info('[getOrganizationId] Starting - Path:', req.path, 'Method:', req.method);
  logger.info('[getOrganizationId] Headers x-organization-id:', req.headers['x-organization-id']);
  logger.info('[getOrganizationId] req.user:', req.user ? { id: req.user.id, organizationId: req.user.organizationId } : null);

  // Try header first
  if (req.headers['x-organization-id']) {
    const orgId = parseInt(req.headers['x-organization-id'], 10);
    logger.info('[getOrganizationId] Found in header:', orgId);
    return orgId;
  }

  // Try from authenticated user
  if (req.user && req.user.organizationId) {
    logger.info('[getOrganizationId] Found in req.user:', req.user.organizationId);
    return req.user.organizationId;
  }

  // Try from hostname mapping
  const hostname = req.hostname;
  logger.info('[getOrganizationId] Trying hostname mapping for:', hostname);
  try {
    const result = await pool.query(
      'SELECT organization_id FROM organization_domains WHERE domain = $1',
      [hostname]
    );

    if (result.rows.length > 0) {
      logger.info('[getOrganizationId] Found via hostname:', result.rows[0].organization_id);
      return result.rows[0].organization_id;
    }
  } catch (error) {
    logger.error('Error getting organization ID:', error);
  }

  logger.error('[getOrganizationId] No organization found - throwing error');
  throw new OrganizationNotFoundError('Organization mapping not found for request');
};

/**
 * Verify user belongs to organization with specific role
 * Use as middleware in routes that require organization membership
 *
 * @param {Array<string>} allowedRoles - Optional array of allowed roles (admin, leader, animation, etc.)
 * @returns {Function} Express middleware
 *
 * @example
 * router.get('/admin-data', authenticate, requireOrganizationRole(['admin', 'leader']), async (req, res) => {
 *   // req.organizationId and req.userRole are available
 * });
 */
exports.requireOrganizationRole = (allowedRoles = null) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Get pool from app locals (set by route factory)
      const pool = req.app.locals.pool;
      if (!pool) {
        logger.error('Database pool not available in middleware');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error'
        });
      }

      // Get organization ID
      const organizationId = await exports.getOrganizationId(req, pool);
      req.organizationId = organizationId;

      // Verify user belongs to organization
      const result = await pool.query(
        'SELECT role FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
        [req.user.id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'User not a member of this organization'
        });
      }

      const userRole = result.rows[0].role;
      req.userRole = userRole;

      // Check role requirements if specified
      if (allowedRoles && !allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions'
        });
      }

      next();
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        return respondWithOrganizationFallback(res);
      }

      logger.error('Error in requireOrganizationRole middleware:', error);
      return res.status(500).json({
        success: false,
        message: 'Authorization check failed'
      });
    }
  };
};
