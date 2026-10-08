/**
 * API Helper Functions
 *
 * Shared utility functions used across route modules
 * Extracted from api.js for better modularity and reusability
 */

const winston = require('winston');
const { verifyJWTToken } = require('./jwt-config');

// Configure logger for API helpers
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

const path = require('path');
const fs = require('fs');

class OrganizationNotFoundError extends Error {
  constructor(message = 'Organization not found') {
    super(message);
    this.name = 'OrganizationNotFoundError';
  }
}

/**
 * Respond with a dedicated fallback experience when no organization is found.
 * API requests receive HTTP 400 with a JSON error payload.
 * Non-API requests that accept HTML receive HTTP 404 with the fallback page.
 * Other non-API requests receive HTTP 404 with a JSON fallback payload.
 *
 * @param {Object} res - Express response object
 * @returns {Object} Express response
 */
function respondWithOrganizationFallback(res) {
  const fallbackPath = path.join(__dirname, '..', 'organization-not-found.html');
  const isApiRequest = res.req?.path?.startsWith('/api');
  const acceptsHtml = (res.req?.headers?.accept || '').includes('text/html');

  if (isApiRequest) {
    return res.status(400).json({
      success: false,
      message: 'organization_not_found',
      fallback: '/organization-not-found.html',
      timestamp: new Date().toISOString()
    });
  }

  if (acceptsHtml) {
    if (!fs.existsSync(fallbackPath)) {
      return res
        .status(404)
        .type('html')
        .send('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Organization not found</title></head><body><h1>organization_not_found</h1></body></html>');
    }

    return res.status(404).sendFile(fallbackPath);
  }

  return res.status(404).json({
    success: false,
    message: 'organization_not_found',
    fallback: '/organization-not-found.html',
    timestamp: new Date().toISOString()
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
    loggerInstance?.warn(`Organization mapping not found; rendering fallback page. Error: ${error.message}`);
    respondWithOrganizationFallback(res);
    return true;
  }
  return false;
}

/**
 * Get current organization ID from request
 * Tries multiple sources in priority order:
 * 1. Validated public organization header
 * 2. Domain mapping (or local development fallback)
 * 3. Throws when no public organization mapping is available
 * This helper never reads credentials. Protected routes use middleware/auth.getOrganizationId.
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
  // Unauthenticated requests may identify the organization via header, but a
  // stale browser cache must not be allowed to select a tenant that no longer
  // exists. This commonly happens after rebuilding a local database.
  const rawHeaderOrganizationId = req.headers['x-organization-id'];
  if (rawHeaderOrganizationId !== undefined) {
    const headerOrganizationId = Number(rawHeaderOrganizationId);
    if (Number.isSafeInteger(headerOrganizationId) && headerOrganizationId > 0) {
      const organizationExists = await pool.query(
        'SELECT 1 FROM organizations WHERE id = $1 LIMIT 1',
        [headerOrganizationId],
      );
      if (organizationExists.rows.length > 0) {
        return headerOrganizationId;
      }
    }
    logger?.warn(`Ignoring invalid or stale public organization header: ${rawHeaderOrganizationId}`);
  }

  // Try to get from hostname/domain mapping
  const hostname = req.hostname;

  // Fallback for local development
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const envOrgId = process.env.ORGANIZATION_ID;
    if (envOrgId) {
      if (logger) {
        logger.info(`Using fallback ORGANIZATION_ID from ENV for local hostname: ${hostname}`);
      }
      return parseInt(envOrgId, 10);
    }
  }

  try {
    // First try exact match
    let result = await pool.query(
      'SELECT organization_id FROM organization_domains WHERE domain = $1',
      [hostname]
    );

    if (result.rows.length > 0) {
      return result.rows[0].organization_id;
    }

    // Try wildcard matching - convert wildcard patterns in DB to match hostname
    // Supports patterns like *.worf.replit.dev, *.kirk.replit.dev, wampums*.test
    // Convert * to % for SQL LIKE, then check if hostname matches the pattern
    result = await pool.query(
      `SELECT organization_id, domain FROM organization_domains 
       WHERE domain LIKE '%*%' 
       AND $1 LIKE REPLACE(domain, '*', '%')
       ORDER BY LENGTH(domain) DESC
       LIMIT 1`,
      [hostname]
    );

    if (result.rows.length > 0) {
      return result.rows[0].organization_id;
    }
  } catch (error) {
    if (logger) {
      logger.error('Error getting organization ID:', error);
    }
    throw error;
  }

  if (logger) {
    logger.warn(`Organization mapping not found for request. Hostname: ${hostname}. Throwing OrganizationNotFoundError.`);
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
    const decoded = verifyJWTToken(token);
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
    return verifyJWTToken(token);
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
function getDefaultPointSystemRules() {
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
        // setting_value is a jsonb column, already parsed by the pg driver.
        const raw = result.rows[0].setting_value;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        logger.warn('Error parsing point_system_rules:', e);
      }
    }
  } catch (error) {
    logger.error('Error getting point system rules:', error);
  }

  return getDefaultPointSystemRules();
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

  // Rules may store either a plain number ({present: 1}) or an object
  // ({present: {label, points: 1}}) depending on where they were saved from.
  const getStatusPoints = (status) => {
    if (!status) {return 0;}
    const rule = attendanceRules[status];
    if (typeof rule === 'number') {return rule;}
    if (rule && typeof rule.points === 'number') {return rule.points;}
    return 0;
  };

  const previousPoints = getStatusPoints(previousStatus);
  const newPoints = getStatusPoints(newStatus);

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
    throw error;
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
    throw error;
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
  getDefaultPointSystemRules,
  getPointSystemRules,
  calculateAttendancePoints,
  jsonResponse,
  escapeHtml,
  getFormPermissionsForRoles,
  checkFormPermission,
  filterFormsByPermissions
};
