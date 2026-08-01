// Authentication and Authorization Middleware
const winston = require('winston');
const { OrganizationNotFoundError, respondWithOrganizationFallback } = require('../utils/api-helpers');
const { requireJWTSecret, verifyJWTToken } = require('../utils/jwt-config');
const scoutYearService = require('../services/scoutYear');

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
requireJWTSecret();

/**
 * Verify JWT token and attach user to request
 */
exports.authenticate = async (req, res, next) => {
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
    const decoded = verifyJWTToken(token);

    // Attach user info to request
    req.user = {
      id: decoded.user_id,
      role: decoded.user_role || decoded.role, // Legacy: kept for backward compatibility
      roleIds: decoded.roleIds || [], // New: array of role IDs
      roleNames: decoded.roleNames || [], // New: array of role names
      permissions: decoded.permissions || [], // New: array of permission keys
      organizationId: decoded.organizationId || decoded.organization_id
    };

    // JWT authorization claims are a snapshot. Re-check the membership on every
    // protected request so disabling a member takes effect immediately instead
    // of waiting for an otherwise valid token to expire.
    if (req.user.organizationId) {
      const pool = req.app?.locals?.pool;
      if (!pool) {
        logger.error('Database pool not available in authenticate middleware');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error',
          timestamp: new Date().toISOString()
        });
      }
      const membership = await pool.query(
        `SELECT organization_id FROM user_organizations
          WHERE user_id = $1 AND organization_id = $2 AND status = 'active'`,
        [req.user.id, req.user.organizationId]
      );
      if (membership.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'This account is no longer active in this organization',
          membershipStatus: 'inactive_or_missing',
          timestamp: new Date().toISOString()
        });
      }
    }

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
 * @deprecated Use requirePermission() instead
 *
 * Check if user has required role(s)
 *
 * **DEPRECATED:** This middleware is deprecated and will be removed in a future version.
 * Use the permission-based `requirePermission()` middleware instead.
 *
 * **Why deprecated:**
 * - Only checks `req.user.role` (single role), doesn't support multi-role users
 * - Role-based checks are less flexible than permission-based checks
 * - Hardcodes authorization logic instead of using database-driven permissions
 *
 * **Migration guide:**
 * - `authorize('admin')` → `requirePermission('forms.manage')` or appropriate permission
 * - See config/roles.js for permission mappings
 *
 * @param {Array|String} roles - Required role(s)
 * @returns {Function} Express middleware
 */
exports.authorize = (...roles) => {
  return (req, res, next) => {
    // Log deprecation warning
    logger.warn(`DEPRECATED: authorize() middleware used in ${req.method} ${req.path}. Migrate to requirePermission().`);

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
      const decoded = verifyJWTToken(token);

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
  const parseOrgId = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const headerOrgId = parseOrgId(req.headers['x-organization-id']);
  const queryOrgId = parseOrgId(req.query?.organization_id);
  const bodyOrgId = parseOrgId(req.body?.organization_id);
  const tokenOrgId = parseOrgId(req.user?.organizationId);

  // Authenticated requests are always scoped to the organization signed into
  // the JWT. Multi-organization users must use the organization switch endpoint,
  // which issues a new token with the selected membership's authorization data.
  if (tokenOrgId) {
    if (headerOrgId && headerOrgId !== tokenOrgId) {
      logger.warn(
        `Ignoring organization header override for authenticated request. Header=${headerOrgId}, Token=${tokenOrgId}, Path=${req.method} ${req.path}, User=${req.user?.id}`,
      );
    }
    if (queryOrgId && queryOrgId !== tokenOrgId) {
      logger.warn(
        `Ignoring organization_id query override for authenticated request. Query=${queryOrgId}, Token=${tokenOrgId}, Path=${req.method} ${req.path}, User=${req.user?.id}`,
      );
    }
    if (bodyOrgId && bodyOrgId !== tokenOrgId) {
      logger.warn(
        `Ignoring organization_id body override for authenticated request. Body=${bodyOrgId}, Token=${tokenOrgId}, Path=${req.method} ${req.path}, User=${req.user?.id}`,
      );
    }
    return tokenOrgId;
  }

  // Try header when unauthenticated (public endpoints)
  if (headerOrgId) {
    return headerOrgId;
  }

  // Fallback to explicit query parameter (used by some API consumers)
  if (queryOrgId) {
    return queryOrgId;
  }

  // Fallback to request body when passed directly
  if (bodyOrgId) {
    return bodyOrgId;
  }

  // Try from hostname mapping
  const hostname = req.hostname;
  if (!pool) {
    throw new OrganizationNotFoundError('Organization mapping not found for request');
  }
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

  logger.warn(`Organization mapping not found for request. Hostname: ${hostname}. Throwing OrganizationNotFoundError.`);
  throw new OrganizationNotFoundError('Organization mapping not found for request');
};

/**
 * Get the scout year a request is about
 *
 * Defaults to the organization's active year. A past year can be consulted with
 * `?scout_year_id=` or the `x-scout-year-id` header; requests for a year that
 * belongs to another organization are rejected.
 *
 * @param {Object} req - Express request object
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} Scout year row ({ id, label, start_date, end_date, status })
 *
 * @example
 * const scoutYear = await getScoutYear(req, pool);
 * const rows = await pool.query(
 *   'SELECT * FROM points WHERE organization_id = $1 AND scout_year_id = $2',
 *   [organizationId, scoutYear.id]
 * );
 */
exports.getScoutYear = async (req, pool) => {
  const organizationId = await exports.getOrganizationId(req, pool);
  const requested = req.query?.scout_year_id ?? req.headers['x-scout-year-id'] ?? null;
  return scoutYearService.resolveScoutYear(pool, organizationId, requested);
};

/**
 * Get the ID of the scout year a request is about
 *
 * @param {Object} req - Express request object
 * @param {Object} pool - Database connection pool
 * @returns {Promise<number>} Scout year ID
 */
exports.getScoutYearId = async (req, pool) => {
  const scoutYear = await exports.getScoutYear(req, pool);
  return scoutYear.id;
};

/** Every way an enrollment can have ended; all of them were on that year's roster. */
const PAST_ENROLLMENT_STATUSES = ['active', 'graduated', 'left', 'transferred'];

/**
 * Enrollment statuses that count as being on a given year's roster
 *
 * @param {Object} scoutYear - Scout year row
 * @returns {Array<string>} Statuses to accept
 */
exports.rosterStatusesFor = (scoutYear) => (
  scoutYear && scoutYear.status === 'active' ? ['active'] : [...PAST_ENROLLMENT_STATUSES]
);

/**
 * Resolve the scout year once and hang it on the request
 *
 * Read endpoints that can be pointed at an archived season use this so the
 * handler body stays about the query rather than about error plumbing. An
 * unknown or foreign year is a client mistake, not a server error, so it comes
 * back as a 400 before the handler runs.
 *
 * Also sets `req.rosterStatuses`, the enrollment statuses that count as "on the
 * roster" for the year being asked about. They differ, and the difference is the
 * whole point of consulting an archive: on the year in progress the roster is
 * who is enrolled *now*, so someone who left in November is off it; on a closed
 * year it is everyone who belonged to that year, including the ones who left at
 * the end of it — otherwise looking up a former member would find nothing.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Function} Express middleware setting `req.scoutYear`
 *
 * @example
 * router.get('/v1/attendance', authenticate, withScoutYear(pool), handler);
 * // handler: req.scoutYear -> { id, label, start_date, end_date, status }
 * //          req.rosterStatuses -> ['active'] or every past status
 */
exports.withScoutYear = (pool) => async (req, res, next) => {
  try {
    req.scoutYear = await exports.getScoutYear(req, pool);
    if (!req.scoutYear) {
      throw new Error('No scout year could be resolved');
    }
    req.rosterStatuses = exports.rosterStatusesFor(req.scoutYear);
    return next();
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: 'Unknown scout year for this organization',
      timestamp: new Date().toISOString()
    });
  }
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
        'SELECT role, status FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
        [req.user.id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'User not a member of this organization'
        });
      }

      // Deactivated memberships (e.g. a parent with no enrolled child) keep their
      // account and history but lose access to the organization.
      if (result.rows[0].status !== 'active') {
        return res.status(403).json({
          success: false,
          message: 'This account is no longer active in this organization',
          membershipStatus: result.rows[0].status
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

/**
 * Permission-based authorization middleware
 * Checks if user has specific permission(s)
 *
 * @param {...string} permissions - Required permission key(s) (e.g., 'finance.view', 'users.manage')
 * @returns {Function} Express middleware
 *
 * @example
 * router.post('/budgets', authenticate, requirePermission('budget.manage'), async (req, res) => {
 *   // User has budget.manage permission
 * });
 *
 * @example
 * // Multiple permissions (user needs ALL of them)
 * router.delete('/users/:id', authenticate, requirePermission('users.delete', 'users.manage'), async (req, res) => {
 *   // User has both users.delete AND users.manage permissions
 * });
 */
exports.requirePermission = (...permissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Get pool from app locals
      const pool = req.app.locals.pool;
      if (!pool) {
        logger.error('Database pool not available in requirePermission middleware');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error'
        });
      }

      // Get organization ID
      const organizationId = await exports.getOrganizationId(req, pool);
      req.organizationId = organizationId;

      // Fetch user's permissions for this organization
      const permissionsQuery = `
        SELECT DISTINCT p.permission_key
        FROM user_organizations uo
        CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
        JOIN role_permissions rp ON rp.role_id = role_id_text::integer
        JOIN permissions p ON p.id = rp.permission_id
        WHERE uo.user_id = $1 AND uo.organization_id = $2
          AND uo.status = 'active'
      `;

      const result = await pool.query(permissionsQuery, [req.user.id, organizationId]);
      const userPermissions = result.rows.map(row => row.permission_key);

      // Store permissions in request for later use
      req.userPermissions = userPermissions;

      // Also fetch user's roles for context
      const rolesQuery = `
        SELECT DISTINCT r.role_name, r.display_name
        FROM user_organizations uo
        CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
        JOIN roles r ON r.id = role_id_text::integer
        WHERE uo.user_id = $1 AND uo.organization_id = $2
          AND uo.status = 'active'
      `;

      const rolesResult = await pool.query(rolesQuery, [req.user.id, organizationId]);
      req.userRoles = rolesResult.rows.map(row => row.role_name);
      req.userRoleDisplayNames = rolesResult.rows.map(row => row.display_name);

      // Check if user has all required permissions
      const requiredPermissions = Array.isArray(permissions[0]) ? permissions[0] : permissions;
      const hasAllPermissions = requiredPermissions.every(perm => userPermissions.includes(perm));

      if (!hasAllPermissions) {
        const missingPermissions = requiredPermissions.filter(perm => !userPermissions.includes(perm));

        // A deactivated membership resolves to zero permissions. Say so, instead
        // of reporting every permission as missing.
        const membership = await pool.query(
          'SELECT status FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
          [req.user.id, organizationId]
        );
        const membershipStatus = membership.rows[0]?.status;

        if (membershipStatus && membershipStatus !== 'active') {
          logger.info(`Inactive membership blocked for user ${req.user.id} (status ${membershipStatus})`);
          return res.status(403).json({
            success: false,
            message: 'This account is no longer active in this organization',
            membershipStatus,
            required: requiredPermissions,
            missing: missingPermissions
          });
        }

        logger.info(`Permission denied for user ${req.user.id}: missing ${missingPermissions.join(', ')}`);

        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
          required: requiredPermissions,
          missing: missingPermissions
        });
      }

      next();
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        return respondWithOrganizationFallback(res);
      }

      logger.error('Error in requirePermission middleware:', error);
      return res.status(500).json({
        success: false,
        message: 'Permission check failed'
      });
    }
  };
};

/**
 * Require at least one permission from the supplied list.
 */
exports.requireAnyPermission = (...permissions) => {
  const requiredPermissions = Array.isArray(permissions[0]) ? permissions[0] : permissions;
  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      const pool = req.app?.locals?.pool;
      if (!pool) {
        logger.error('Database pool not available in requireAnyPermission middleware');
        return res.status(500).json({ success: false, message: 'Server configuration error' });
      }
      const organizationId = await exports.getOrganizationId(req, pool);
      req.organizationId = organizationId;
      const result = await pool.query(
        `SELECT DISTINCT p.permission_key
           FROM user_organizations uo
           CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) role_id_text
           JOIN role_permissions rp ON rp.role_id = role_id_text::integer
           JOIN permissions p ON p.id = rp.permission_id
          WHERE uo.user_id = $1
            AND uo.organization_id = $2
            AND uo.status = 'active'
            AND p.permission_key = ANY($3::text[])`,
        [req.user.id, organizationId, requiredPermissions]
      );
      if (result.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
          requiredAny: requiredPermissions
        });
      }
      req.userPermissions = result.rows.map(row => row.permission_key);
      return next();
    } catch (error) {
      if (error instanceof OrganizationNotFoundError) {
        return respondWithOrganizationFallback(res);
      }
      logger.error('Error in requireAnyPermission middleware:', error);
      return res.status(500).json({ success: false, message: 'Permission check failed' });
    }
  };
};

/**
 * Block demo roles from making changes
 * Use on POST, PUT, PATCH, DELETE endpoints to prevent demo users from modifying data
 *
 * @returns {Function} Express middleware
 *
 * @example
 * router.post('/participants', authenticate, blockDemoRoles, requirePermission('participants.create'), async (req, res) => {
 *   // Demo users will be blocked before reaching this point
 * });
 */
exports.blockDemoRoles = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Get pool from app locals
    const pool = req.app.locals.pool;
    if (!pool) {
      logger.error('Database pool not available in blockDemoRoles middleware');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
    }

    // Get organization ID
    const organizationId = await exports.getOrganizationId(req, pool);

    // Check if user has any demo roles
    const demoRolesQuery = `
      SELECT DISTINCT r.role_name
      FROM user_organizations uo
      CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
      JOIN roles r ON r.id = role_id_text::integer
      WHERE uo.user_id = $1
        AND uo.organization_id = $2
        AND r.role_name IN ('demoadmin', 'demoparent')
    `;

    const result = await pool.query(demoRolesQuery, [req.user.id, organizationId]);

    if (result.rows.length > 0) {
      const demoRoles = result.rows.map(row => row.role_name);
      logger.info(`Demo role blocked from ${req.method} ${req.path}: user ${req.user.id} has roles ${demoRoles.join(', ')}`);

      return res.status(403).json({
        success: false,
        message: 'This feature is not available in demo mode. Demo accounts have read-only access.',
        isDemo: true
      });
    }

    next();
  } catch (error) {
    if (error instanceof OrganizationNotFoundError) {
      return respondWithOrganizationFallback(res);
    }

    logger.error('Error in blockDemoRoles middleware:', error);
    return res.status(500).json({
      success: false,
      message: 'Authorization check failed'
    });
  }
};

/**
 * Helper function to check if user has any of the specified permissions
 * Use this in route handlers when you need conditional logic based on permissions
 *
 * @param {Object} req - Express request object (must have userPermissions attached)
 * @param {...string} permissions - Permission key(s) to check
 * @returns {boolean} True if user has at least one of the permissions
 *
 * @example
 * if (hasAnyPermission(req, 'finance.manage', 'budget.manage')) {
 *   // User can see financial details
 * }
 */
exports.hasAnyPermission = (req, ...permissions) => {
  if (!req.userPermissions) {
    return false;
  }
  return permissions.some(perm => req.userPermissions.includes(perm));
};

/**
 * Helper function to check if user has all of the specified permissions
 *
 * @param {Object} req - Express request object (must have userPermissions attached)
 * @param {...string} permissions - Permission key(s) to check
 * @returns {boolean} True if user has all of the permissions
 */
exports.hasAllPermissions = (req, ...permissions) => {
  if (!req.userPermissions) {
    return false;
  }
  return permissions.every(perm => req.userPermissions.includes(perm));
};

/**
 * Helper function to check if user has a specific role
 *
 * @param {Object} req - Express request object (must have userRoles attached)
 * @param {...string} roles - Role name(s) to check
 * @returns {boolean} True if user has at least one of the roles
 */
exports.hasAnyRole = (req, ...roles) => {
  if (!req.userRoles) {
    return false;
  }
  return roles.some(role => req.userRoles.includes(role));
};

/**
 * Get user's data scope based on their roles
 *
 * Data scope determines what data users can access:
 * - 'organization': User can see ALL data in the organization (staff roles)
 * - 'linked': User can only see data they're explicitly linked to (parent roles)
 *
 * If user has ANY role with 'organization' scope, they get organization-wide access.
 * This is critical for multi-role users (e.g., parent who is also a leader).
 *
 * @param {Object} req - Express request object with authenticated user
 * @param {Object} pool - Database connection pool
 * @returns {Promise<string>} 'organization' or 'linked'
 *
 * @example
 * // In a route handler:
 * const dataScope = await getUserDataScope(req, pool);
 * if (dataScope === 'organization') {
 *   // Query all participants in organization
 * } else {
 *   // Query only participants linked to this user
 * }
 */
exports.getUserDataScope = async (req, pool) => {
  try {
    if (!req.user || !req.user.id) {
      return 'linked'; // Default to most restrictive
    }

    const organizationId = await exports.getOrganizationId(req, pool);

    // Query user's roles and get their data scopes
    // Order by data_scope ASC so 'linked' comes before 'organization'
    // This way we can take the LAST (most permissive) scope
    const result = await pool.query(`
      SELECT DISTINCT r.data_scope
      FROM user_organizations uo
      CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
      JOIN roles r ON r.id = role_id_text::integer
      WHERE uo.user_id = $1 AND uo.organization_id = $2
        AND uo.status = 'active'
      ORDER BY r.data_scope DESC
    `, [req.user.id, organizationId]);

    // If user has ANY organization-scoped role, they get organization access
    // Otherwise, they get linked access
    // DESC order means 'organization' comes first if it exists
    return result.rows[0]?.data_scope || 'linked';

  } catch (error) {
    logger.error('Error getting user data scope:', error);
    return 'linked'; // Fail safely to most restrictive
  }
};
