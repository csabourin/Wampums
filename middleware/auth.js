// Authentication and Authorization Middleware
const jwt = require('jsonwebtoken');

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
  // Try header first
  if (req.headers['x-organization-id']) {
    return parseInt(req.headers['x-organization-id'], 10);
  }

  // Try from authenticated user
  if (req.user && req.user.organizationId) {
    return req.user.organizationId;
  }

  // Try from hostname mapping
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
    console.error('Error getting organization ID:', error);
  }

  // Default fallback
  return 1;
};
