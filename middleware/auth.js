// Authentication and Authorization Middleware
const winston = require('winston');
const { OrganizationNotFoundError, respondWithOrganizationFallback } = require('../utils/api-helpers');
const { requireJWTSecret, verifyJWTToken } = require('../utils/jwt-config');
const { forbidden, error: errorResponse } = require('./response');
const HTTP_STATUS = { UNAUTHORIZED: 401, INTERNAL_ERROR: 500 };
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
 * Authenticate both required and optional sessions through one membership check.
 * Optional sessions treat absent, invalid and inactive credentials as signed out;
 * database failures stay server errors rather than masquerading as bad tokens.
 * @param {boolean} [optional] - Allow visitors to continue without a session
 * @returns {Function} Express middleware
 */
function sessionAuthentication(optional = false) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    let decoded;
    let organizationId;
    try {
      if (!authHeader?.startsWith('Bearer ')) {throw new Error('Missing bearer token');}
      decoded = verifyJWTToken(authHeader.slice('Bearer '.length));
      organizationId = Number(decoded.organizationId || decoded.organization_id);
      if (!decoded.user_id || !Number.isSafeInteger(organizationId) || organizationId <= 0) {
        throw new Error('A session must identify an account and organization');
      }
    } catch (_err) {
      delete req.user;
      if (optional) {return next();}
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false, message: 'Authentication required: invalid or expired token',
        timestamp: new Date().toISOString(),
      });
    }
    const pool = req.app?.locals?.pool;
    if (!pool) {return errorResponse(res, 'Server configuration error', HTTP_STATUS.INTERNAL_ERROR);}
    try {
      const membership = await pool.query(
        `SELECT organization_id FROM user_organizations
          WHERE user_id = $1 AND organization_id = $2 AND status = 'active'`,
        [decoded.user_id, organizationId]
      );
      if (!membership.rows.length) {
        delete req.user;
        if (optional) {return next();}
        return forbidden(res, 'This account is no longer active in this organization', [], [], {
          membershipStatus: 'inactive_or_missing',
        });
      }
      req.user = {
        id: decoded.user_id, role: decoded.user_role || decoded.role,
        roleIds: decoded.roleIds || [], roleNames: decoded.roleNames || [],
        permissions: decoded.permissions || [], organizationId,
      };
      req.authenticatedMembership = { userId: req.user.id, organizationId: Number(organizationId), status: 'active' };
      return next();
    } catch (err) {
      logger.error('Session membership lookup failed:', err);
      return errorResponse(res, 'Authentication check failed', HTTP_STATUS.INTERNAL_ERROR);
    }
  };
}

exports.authenticate = sessionAuthentication();
exports.optionalAuth = sessionAuthentication(true);

/**
 * Get organization ID from request (header or user context)
 */
exports.getOrganizationId = async (req, pool) => {
  const parseOrgId = (value) => {
    if (value === undefined || value === null || value === '') {return null;}
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
 * Load current membership, permissions and role metadata once per request/unit.
 * JWT role and permission claims are never used to authorize a request.
 * @param {Object} req - Authenticated request
 * @param {Object} pool - Database pool
 * @param {number} [organizationId] - Trusted organization context
 * @returns {Promise<Object>} Current authorization context
 */
async function loadAuthorizationContext(req, pool, organizationId) {
  const unit = organizationId ?? await exports.getOrganizationId(req, pool);
  const key = `${req.user.id}:${unit}`;
  req.authorizationContexts ||= new Map();
  if (!req.authorizationContexts.has(key)) {
    const pending = (async () => {
      // One SQL snapshot prevents mixing old permissions with a new role scope
      // or demo state while another request edits membership/role assignments.
      const result = await pool.query(
        `WITH memberships AS (
           SELECT status, role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2
         ), role_metadata AS (
           SELECT DISTINCT r.role_name, r.display_name, r.data_scope
             FROM memberships uo
             CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
             JOIN roles r ON r.id = role_id_text::integer WHERE uo.status = 'active'
         ), permission_metadata AS (
           SELECT DISTINCT p.permission_key
             FROM memberships uo
             CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
             JOIN role_permissions rp ON rp.role_id = role_id_text::integer
             JOIN permissions p ON p.id = rp.permission_id WHERE uo.status = 'active'
         ), form_metadata AS (
           SELECT off.form_type, bool_or(fp.can_view) AS can_view,
                  bool_or(fp.can_submit) AS can_submit, bool_or(fp.can_edit) AS can_edit,
                  bool_or(fp.can_approve) AS can_approve
             FROM memberships uo
             CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
             JOIN form_permissions fp ON fp.role_id = role_id_text::integer
             JOIN organization_form_formats off ON off.id = fp.form_format_id
            WHERE uo.status = 'active' AND off.organization_id = $2
            GROUP BY off.form_type
         )
         SELECT uo.status,
                ARRAY(SELECT permission_key FROM permission_metadata) AS authorization_permissions,
                COALESCE((SELECT jsonb_agg(rm) FROM role_metadata rm), '[]'::jsonb) AS authorization_roles,
                COALESCE((SELECT jsonb_object_agg(fm.form_type, to_jsonb(fm) - 'form_type')
                            FROM form_metadata fm), '{}'::jsonb) AS authorization_forms
           FROM memberships uo LIMIT 1`,
        [req.user.id, unit]
      );
      const member = result.rows[0];
      return {
        active: member?.status === 'active', membershipStatus: member?.status || 'missing', organizationId: unit,
        permissions: member?.authorization_permissions || [],
        roles: member?.authorization_roles || [], formPermissions: member?.authorization_forms || {},
      };
    })();
    req.authorizationContexts.set(key, pending);
  }
  return req.authorizationContexts.get(key);
}

/**
 * Require current database permissions, optionally allowing explicit ownership
 * policies (for example a guardian signing for their own child). A function
 * may select additional keys from the request for conditional operations.
 * @param {...(string|Array<string>|Object|Function)} permissions - Keys or trusted policy
 * @returns {Function} Express authorization middleware
 */
exports.requirePermission = (...permissions) => async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ success: false, message: 'Authentication required' });
    }
    const pool = req.app?.locals?.pool;
    if (!pool) {return errorResponse(res, 'Server configuration error', HTTP_STATUS.INTERNAL_ERROR);}
    const selected = typeof permissions[0] === 'function' ? await permissions[0](req) : permissions;
    const policy = !Array.isArray(selected) ? selected : selected[0] && typeof selected[0] === 'object' && !Array.isArray(selected[0])
      ? selected[0] : { permissions: Array.isArray(selected[0]) ? selected[0] : selected };
    const required = policy.permissions || [];
    const organizationId = await exports.getOrganizationId(req, pool);
    req.organizationId = organizationId;
    const context = await loadAuthorizationContext(req, pool, organizationId);
    req.userPermissions = context.permissions;
    req.userRoles = context.roles.map((row) => row.role_name);
    req.userRoleDisplayNames = context.roles.map((row) => row.display_name);
    req.formPermissions = context.formPermissions;
    req.user.permissions = context.permissions;
    if (!context.active) {
      return forbidden(res, 'This account is no longer active in this organization', required, required, {
        membershipStatus: context.membershipStatus,
      });
    }
    const missing = required.filter((key) => !context.permissions.includes(key));
    if (policy.resourceScope && await policy.resourceScope(req, { pool, organizationId, context }) !== true) {
      return forbidden(res, 'Access denied to this resource', required, missing);
    }
    const hasPermission = policy.any ? missing.length < required.length : missing.length === 0;
    const scopeMatches = !policy.organizationScope || await exports.getUserDataScope(req, pool) === 'organization';
    if (hasPermission && scopeMatches) {return next();}
    if (policy.resourceAccess && await policy.resourceAccess(req, { pool, organizationId, context }) === true) {return next();}
    return forbidden(res, 'Insufficient permissions', required, missing, policy.any ? { requiredAny: required } : {});
  } catch (err) {
    if (err instanceof OrganizationNotFoundError) {return respondWithOrganizationFallback(res);}
    logger.error('Permission check failed:', err);
    return errorResponse(res, 'Permission check failed', HTTP_STATUS.INTERNAL_ERROR);
  }
};

/** Require any one current permission, using the same context and denial path. */
exports.requireAnyPermission = (...permissions) => exports.requirePermission({
  permissions: Array.isArray(permissions[0]) ? permissions[0] : permissions, any: true,
});

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

    const context = await loadAuthorizationContext(req, pool, organizationId);
    if (!context.active) {
      return forbidden(res, 'This account is no longer active in this organization', [], [], {
        membershipStatus: context.membershipStatus,
      });
    }
    // policy-allow role-names: demo is an account descriptor, never a grant of authority (CLAUDE.md §3)
    const demoRoles = context.roles.filter((role) => ['demoadmin', 'demoparent'].includes(role.role_name));
    if (demoRoles.length) {
      return forbidden(res, 'This feature is not available in demo mode. Demo accounts have read-only access.', [], [], { isDemo: true });
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
 * Whether the signed-in user holds a permission in an organization, read from
 * the database.
 *
 * Use this instead of `req.user.permissions` whenever the answer grants
 * access. The JWT's permission list is a snapshot taken at sign-in and stays
 * valid for days; a permission taken away from a role since then would still
 * be honored.
 *
 * @param {Object} req - Express request with an authenticated user
 * @param {Object} pool - Database connection pool
 * @param {number} organizationId - Organization to check in
 * @param {string} permissionKey - Permission key (e.g. 'finance.view')
 * @returns {Promise<boolean>} True when an active membership's role grants it
 */
exports.userHasPermission = async (req, pool, organizationId, permissionKey) => {
  if (!req.user || !req.user.id) {
    return false;
  }

  const context = await loadAuthorizationContext(req, pool, organizationId);
  return context.active && context.permissions.includes(permissionKey);
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
  if (!req.user?.id) {return 'linked';}
  const context = await loadAuthorizationContext(req, pool);
  if (!context.active) {return 'linked';}
  return exports.dataScopeOfRoles(context.roles);
};

/**
 * Data scope a set of roles gives together: one organization-wide role is
 * enough, so a parent who is also a leader sees the whole unit.
 *
 * @param {Array<{data_scope: ?string}>} roles - Role rows holding data_scope
 * @returns {string} 'organization' or 'linked'
 */
exports.dataScopeOfRoles = (roles) => (
  (roles || []).some((role) => role.data_scope === 'organization') ? 'organization' : 'linked'
);
