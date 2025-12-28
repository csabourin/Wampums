/**
 * API Helper Functions
 *
 * Shared utility functions used across route modules
 * Extracted from api.js for better modularity and reusability
 */

const jwt = require('jsonwebtoken');
const winston = require('winston');

// Configure logger for API helpers
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Get JWT key from environment
const jwtKey = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;

const path = require('path');

class OrganizationNotFoundError extends Error {
  constructor(message = 'Organization not found') {
    super(message);
    this.name = 'OrganizationNotFoundError';
  }
}

/**
 * Respond with a dedicated fallback experience when no organization is found.
 * Sends HTML when the client accepts it, otherwise returns a JSON payload with
 * a pointer to the fallback page so the SPA can redirect gracefully.
 *
 * @param {Object} res - Express response object
 * @returns {Object} Express response
 */
function respondWithOrganizationFallback(res) {
  const fallbackPath = path.join(__dirname, '..', 'organization-not-found.html');
  const acceptsHtml = (res.req?.headers?.accept || '').includes('text/html');

  if (acceptsHtml) {
    return res.status(404).sendFile(fallbackPath);
  }

  return res.status(404).json({
    success: false,
    message: 'organization_not_found',
    fallback: '/organization-not-found.html'
  });
}

/**
 * Handle errors arising from organization resolution and return a fallback page
 * when appropriate. Returns true when a fallback response was sent.
 *
 * @param {Object} res - Express response object
 * @param {Error} error - Error encountered during organization resolution
 * @param {Object} loggerInstance - Winston logger instance
 * @returns {boolean} Whether the response has been handled
 */
function handleOrganizationResolutionError(res, error, loggerInstance = logger) {
  if (error instanceof OrganizationNotFoundError) {
    loggerInstance?.warn('Organization mapping not found; rendering fallback page');
    respondWithOrganizationFallback(res);
    return true;
  }
  return false;
}

/**
 * Get current organization ID from request
 * Tries multiple sources in priority order:
 * 1. x-organization-id header
 * 2. Domain mapping from database
 * 3. Throws when no organization mapping is available
 *
 * @param {Object} req - Express request object
 * @param {Object} pool - Database pool
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<number>} Organization ID
 *
 * @example
 * const organizationId = await getCurrentOrganizationId(req, pool, logger);
 */
async function getCurrentOrganizationId(req, pool, logger) {
  // Try to get from header first
  if (req.headers['x-organization-id']) {
    return parseInt(req.headers['x-organization-id'], 10);
  }

  // Try to get from hostname/domain mapping
  const hostname = req.hostname;
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    const result = await pool.query(
      'SELECT organization_id FROM organization_domains WHERE domain = $1',
      [hostname]
    );

    if (result.rows.length > 0) {
      return result.rows[0].organization_id;
    }
  } catch (error) {
    // Table might not exist or query failed
    if (logger) {
      logger.warn('Error querying organization_domains:', error.message);
    }
  }

  // In development, fall back to default organization ID 1
  if (!isProduction) {
    if (logger) {
      logger.info(`Development mode: using default organization ID 1 for hostname ${hostname}`);
    }
    return 1;
  }

  throw new OrganizationNotFoundError('Organization mapping not found for request');
}

/**
 * Get user ID from JWT token
 *
 * @param {string} token - JWT token
 * @returns {number|null} User ID or null if invalid
 *
 * @example
 * const userId = getUserIdFromToken(token);
 */
function getUserIdFromToken(token) {
  try {
    const decoded = jwt.verify(token, jwtKey);
    return decoded.user_id;
  } catch (e) {
    return null;
  }
}

/**
 * Verify JWT token
 *
 * @param {string} token - JWT token to verify
 * @returns {Object|null} Decoded token or null if invalid
 *
 * @example
 * const decoded = verifyJWT(token);
 * if (decoded) {
 *   console.log('User ID:', decoded.user_id);
 * }
 */
function verifyJWT(token) {
  try {
    return jwt.verify(token, jwtKey);
  } catch (e) {
    return null;
  }
}

/**
 * Get point system rules from organization settings
 * Returns organization-specific point values or defaults
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Object>} Point system rules
 *
 * @example
 * const rules = await getPointSystemRules(pool, organizationId);
 * console.log('Present points:', rules.attendance.present.points);
 */
async function getPointSystemRules(pool, organizationId) {
  const queryExecutor = pool;

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

/**
 * Calculate attendance point adjustment based on status change
 *
 * @param {string} previousStatus - Previous attendance status
 * @param {string} newStatus - New attendance status
 * @param {Object} rules - Point system rules
 * @returns {number} Point adjustment (can be negative)
 *
 * @example
 * const adjustment = calculateAttendancePoints('absent', 'present', rules);
 * // Returns: 1 (if present = 1 and absent = 0)
 */
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

/**
 * Send JSON response with consistent format
 *
 * @param {Object} res - Express response object
 * @param {boolean} success - Success flag
 * @param {*} data - Response data
 * @param {string} message - Response message
 *
 * @example
 * jsonResponse(res, true, { user: userData }, 'User created successfully');
 */
function jsonResponse(res, success, data = null, message = '') {
  res.json({
    success,
    data,
    message,
  });
}

/**
 * Handle error and send JSON error response
 *
 * @param {Error} err - Error object
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 * @param {Object} logger - Winston logger
 *
 * @example
 * app.use((err, req, res, next) => {
 *   handleError(err, req, res, next, logger);
 * });
 */
function handleError(err, req, res, next, logger) {
  if (logger) {
    logger.error(err.stack);
  } else {
    logger.error(err.stack);
  }
  res.status(500).json({ success: false, error: err.message });
}

/**
 * Verify user belongs to an organization with required permissions or roles.
 *
 * Regression note: prefer permission keys (e.g., communications.send, org.edit).
 * Legacy role arrays (admin/animation) are mapped to district/leader role names
 * to maintain compatibility with the permission-driven system.
 *
 * @param {Object} pool - Database pool
 * @param {number} userId - User ID
 * @param {number} organizationId - Organization ID
 * @param {Object|Array<string>|null} requirements - Permission/role requirements
 * @param {Array<string>} [requirements.requiredRoles] - Optional role names to allow
 * @param {Array<string>} [requirements.requiredPermissions] - Permission keys the user must have
 * @returns {Promise<Object>} { authorized: boolean, role: string|null, roles: string[], permissions: string[], message?: string }
 */
async function verifyOrganizationMembership(pool, userId, organizationId, requirements = null) {
  try {
    const options = Array.isArray(requirements)
      ? { requiredRoles: requirements }
      : (requirements || {});

    const requiredRoles = (options.requiredRoles || []).map((roleName) => {
      if (roleName === 'admin') return 'district';
      if (roleName === 'animation') return 'leader';
      return roleName;
    });

    const requiredPermissions = options.requiredPermissions || [];

    const membershipResult = await pool.query(
      `SELECT role_ids
       FROM user_organizations
       WHERE user_id = $1 AND organization_id = $2`,
      [userId, organizationId]
    );

    if (membershipResult.rows.length === 0) {
      return { authorized: false, role: null, roles: [], permissions: [], message: 'User not a member of this organization' };
    }

    const membership = membershipResult.rows[0];

    // Resolve role names from role IDs for permission-aware checks
    const rolesResult = await pool.query(
      `SELECT DISTINCT r.role_name
       FROM user_organizations uo
       CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
       JOIN roles r ON r.id = role_id_text::integer
       WHERE uo.user_id = $1 AND uo.organization_id = $2`,
      [userId, organizationId]
    );

    const resolvedRoles = rolesResult.rows.map((row) => row.role_name);
    const primaryRole = resolvedRoles[0] || null;

    if (requiredRoles.length) {
      const hasRole = requiredRoles.some((role) => resolvedRoles.includes(role));
      if (!hasRole) {
        return { authorized: false, role: primaryRole, roles: resolvedRoles, permissions: [], message: 'Insufficient permissions' };
      }
    }

    let userPermissions = [];
    if (requiredPermissions.length) {
      const permissionsResult = await pool.query(
        `SELECT DISTINCT p.permission_key
         FROM user_organizations uo
         CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
         JOIN role_permissions rp ON rp.role_id = role_id_text::integer
         JOIN permissions p ON p.id = rp.permission_id
         WHERE uo.user_id = $1 AND uo.organization_id = $2`,
        [userId, organizationId]
      );

      userPermissions = permissionsResult.rows.map((row) => row.permission_key);

      const hasAllPermissions = requiredPermissions.every((permission) => userPermissions.includes(permission));
      if (!hasAllPermissions) {
        return {
          authorized: false,
          role: primaryRole,
          roles: resolvedRoles,
          permissions: userPermissions,
          message: 'Insufficient permissions'
        };
      }
    }

    return { authorized: true, role: primaryRole, roles: resolvedRoles, permissions: userPermissions };
  } catch (error) {
    logger.error('Error verifying organization membership:', error);
    return { authorized: false, role: null, roles: [], permissions: [], message: 'Authorization check failed' };
  }
}

/**
 * Escape HTML special characters to prevent XSS
 * Used for safely rendering user-generated content
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 *
 * @example
 * const safeTitle = escapeHtml(userInput);
 * html += `<h3>${safeTitle}</h3>`;
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Get form permissions for a user's roles
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Organization ID
 * @param {Array<string>} userRoles - Array of user role names
 * @returns {Promise<Object>} Map of form_type to permissions
 *
 * @example
 * const formPermissions = await getFormPermissionsForRoles(pool, orgId, ['parent']);
 * // Returns: { 'risk_acceptance': { can_view: true, can_submit: true, ... }, ... }
 */
async function getFormPermissionsForRoles(pool, organizationId, userRoles) {
  try {
    // Get all form permissions for the user's roles
    const result = await pool.query(
      `SELECT
         off.form_type,
         MAX(CASE WHEN fp.can_view THEN 1 ELSE 0 END)::boolean AS can_view,
         MAX(CASE WHEN fp.can_submit THEN 1 ELSE 0 END)::boolean AS can_submit,
         MAX(CASE WHEN fp.can_edit THEN 1 ELSE 0 END)::boolean AS can_edit,
         MAX(CASE WHEN fp.can_approve THEN 1 ELSE 0 END)::boolean AS can_approve
       FROM organization_form_formats off
       JOIN form_permissions fp ON fp.form_format_id = off.id
       JOIN roles r ON r.id = fp.role_id
       WHERE off.organization_id = $1
         AND r.role_name = ANY($2)
       GROUP BY off.form_type`,
      [organizationId, userRoles]
    );

    // Convert to a map for easy lookup
    const permissionsMap = {};
    result.rows.forEach(row => {
      permissionsMap[row.form_type] = {
        can_view: row.can_view,
        can_submit: row.can_submit,
        can_edit: row.can_edit,
        can_approve: row.can_approve
      };
    });

    return permissionsMap;
  } catch (error) {
    logger.error('Error getting form permissions for roles:', error);
    return {};
  }
}

/**
 * Check if a user has specific permission for a form type
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Organization ID
 * @param {Array<string>} userRoles - Array of user role names
 * @param {string} formType - Form type to check
 * @param {string} permission - Permission to check ('view', 'submit', 'edit', 'approve')
 * @returns {Promise<boolean>} Whether user has the permission
 *
 * @example
 * const canView = await checkFormPermission(pool, orgId, ['parent'], 'organization_info', 'view');
 * // Returns: false (parents can't view organization_info)
 */
async function checkFormPermission(pool, organizationId, userRoles, formType, permission = 'view') {
  try {
    const permissionColumn = `can_${permission}`;

    const result = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM organization_form_formats off
         JOIN form_permissions fp ON fp.form_format_id = off.id
         JOIN roles r ON r.id = fp.role_id
         WHERE off.organization_id = $1
           AND off.form_type = $2
           AND r.role_name = ANY($3)
           AND fp.${permissionColumn} = true
       ) AS has_permission`,
      [organizationId, formType, userRoles]
    );

    return result.rows[0]?.has_permission || false;
  } catch (error) {
    logger.error('Error checking form permission:', error);
    return false;
  }
}

/**
 * Filter form formats based on user permissions
 *
 * @param {Array} formFormats - Array of form format objects
 * @param {Object} permissionsMap - Map of form_type to permissions (from getFormPermissionsForRoles)
 * @returns {Array} Filtered form formats that user can view
 *
 * @example
 * const formFormats = await getOrganizationFormFormats(pool, orgId);
 * const permissions = await getFormPermissionsForRoles(pool, orgId, userRoles);
 * const visibleForms = filterFormsByPermissions(formFormats, permissions);
 */
function filterFormsByPermissions(formFormats, permissionsMap) {
  return formFormats.filter(form => {
    const permissions = permissionsMap[form.form_type];
    return permissions && permissions.can_view;
  });
}

// Export all helper functions
module.exports = {
  getCurrentOrganizationId,
  OrganizationNotFoundError,
  respondWithOrganizationFallback,
  handleOrganizationResolutionError,
  getUserIdFromToken,
  verifyJWT,
  getPointSystemRules,
  calculateAttendancePoints,
  jsonResponse,
  handleError,
  verifyOrganizationMembership,
  escapeHtml,
  getFormPermissionsForRoles,
  checkFormPermission,
  filterFormsByPermissions
};
