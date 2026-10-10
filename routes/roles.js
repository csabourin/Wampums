/**
 * Role and Permission Management Routes
 *
 * Handles role and permission management for the organization
 * Available to district and unitadmin users
 *
 * @module routes/roles
 */

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, forbidden, asyncHandler } = require('../middleware/response');
const { UNIT_FINANCE_PERMISSIONS } = require('../config/constants');
const { checkRolesGrantable, findRolesInUnit, permissionCountsAgainstGrantor } = require('../services/roleAssignment');
const { query } = require('express-validator');
const { checkValidation } = require('../middleware/validation');

/** Entries returned by the role history when no limit is given. */
const ROLE_AUDIT_DEFAULT_LIMIT = 15;
/** Most entries the role history returns at once. */
const ROLE_AUDIT_MAX_LIMIT = 50;

/** Longest roles.role_name the column accepts. */
const ROLE_NAME_MAX_LENGTH = 50;

/**
 * @param {string|number} value - Route parameter or body field
 * @returns {number|null} The ID, or null when it is not a positive integer
 */
function parsePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Internal key for a unit's custom role. The unit prefix keeps keys unique
 * across units without revealing another unit's role names, and keeps custom
 * keys apart from the built-in ones.
 *
 * @param {number} organizationId - The unit
 * @param {string} requested - Name the caller asked for
 * @returns {string|null} Key, or null when nothing usable remains
 */
function customRoleKey(organizationId, requested) {
  const prefix = `u${organizationId}_`;
  const slug = String(requested || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, ROLE_NAME_MAX_LENGTH - prefix.length);
  return slug ? `${prefix}${slug}` : null;
}

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with role management routes
 */
module.exports = (pool, logger) => {
  /**
   * GET /api/v1/roles
   * Get all available roles
   * Available to: district, unitadmin
   */
  router.get('/api/v1/roles',
    authenticate,
    requirePermission('roles.view'),
    asyncHandler(async (req, res) => {
      try {
        // Every role is listed. `assignable` says whether the caller holds all
        // of its permissions, which is what granting or removing it requires
        // (services/roleAssignment.js); forms show the others as read-only.
        const organizationId = await getOrganizationId(req, pool);
        // A unit sees the shared built-in roles and its own custom roles
        // (services/roleAssignment.js findRolesInUnit).
        const result = await pool.query(
          `SELECT r.id, r.role_name, r.display_name, r.description, r.is_system_role, r.created_at,
                  NOT EXISTS (
                    SELECT 1
                    FROM role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                    WHERE rp.role_id = r.id
                      AND NOT (p.permission_key = ANY($1::text[]))
                      -- same exception as services/roleAssignment.js
                      AND NOT (p.self_scoped AND r.data_scope = 'linked')
                  ) AS assignable
           FROM roles r
           WHERE r.organization_id = $2 OR (r.organization_id IS NULL AND r.is_system_role)
           ORDER BY
             CASE r.role_name
               WHEN 'district' THEN 0
               WHEN 'unitadmin' THEN 1
               WHEN 'leader' THEN 2
               WHEN 'parent' THEN 3
               WHEN 'finance' THEN 4
               WHEN 'equipment' THEN 5
               WHEN 'administration' THEN 6
               WHEN 'demoadmin' THEN 7
               WHEN 'demoparent' THEN 8
               ELSE 9
             END`,
          [req.userPermissions || [], organizationId]
        );

        return success(res, result.rows, 'Roles retrieved successfully');
      } catch (err) {
        logger.error('Error fetching roles:', err);
        return error(res, 'Failed to fetch roles', 500);
      }
    })
  );

  /**
   * GET /api/v1/roles/:roleId/permissions
   * Get permissions for a specific role
   * Available to: district, unitadmin
   */
  router.get('/api/v1/roles/:roleId/permissions',
    authenticate,
    requirePermission('roles.view'),
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const roleId = parsePositiveId(req.params.roleId);
        if (!roleId || (await findRolesInUnit(pool, [roleId], organizationId)).length === 0) {
          return error(res, 'Role not found', 404);
        }

        const query = `
          SELECT p.id, p.permission_key, p.permission_name, p.category, p.description
          FROM permissions p
          JOIN role_permissions rp ON p.id = rp.permission_id
          WHERE rp.role_id = $1
          ORDER BY p.category, p.permission_key
        `;

        const result = await pool.query(query, [roleId]);

        return success(res, result.rows, 'Role permissions retrieved successfully');
      } catch (err) {
        logger.error('Error fetching role permissions:', err);
        return error(res, 'Failed to fetch role permissions', 500);
      }
    })
  );

  /**
   * GET /api/v1/permissions
   * Get all available permissions grouped by category
   * Available to: district, unitadmin
   */
  router.get('/api/v1/permissions',
    authenticate,
    requirePermission('roles.view'),
    asyncHandler(async (req, res) => {
      try {
        const query = `
          SELECT id, permission_key, permission_name, category, description
          FROM permissions
          ORDER BY category, permission_key
        `;

        const result = await pool.query(query);

        // Group by category
        const grouped = result.rows.reduce((acc, perm) => {
          if (!acc[perm.category]) {
            acc[perm.category] = [];
          }
          acc[perm.category].push(perm);
          return acc;
        }, {});

        return success(res, grouped, 'Permissions retrieved successfully');
      } catch (err) {
        logger.error('Error fetching permissions:', err);
        return error(res, 'Failed to fetch permissions', 500);
      }
    })
  );

  /**
   * POST /api/v1/roles/:roleId/permissions
   * Add permission to a role (custom roles only)
   * Available to: district only
   */
  router.post('/api/v1/roles/:roleId/permissions',
    authenticate,
    blockDemoRoles,
    requirePermission('roles.manage'),
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const roleId = parsePositiveId(req.params.roleId);
        const permissionId = parsePositiveId(req.body?.permissionId);

        // Only the unit's own custom roles can change; built-in roles are shared.
        const [role] = roleId ? await findRolesInUnit(pool, [roleId], organizationId) : [];

        if (!role) {
          return res.status(404).json({
            success: false,
            message: 'Role not found'
          });
        }

        if (role.is_system_role) {
          return res.status(403).json({
            success: false,
            message: 'Cannot modify system roles'
          });
        }

        const permissionCheck = await pool.query(
          'SELECT permission_key, self_scoped FROM permissions WHERE id = $1',
          [permissionId]
        );

        if (permissionCheck.rows.length === 0) {
          return error(res, 'Permission not found', 404);
        }

        const { permission_key: permissionKey } = permissionCheck.rows[0];

        // The finance routes answer for every family in the unit. A role that
        // only sees its own children would read everyone's fees through them.
        if (role.data_scope === 'linked' && UNIT_FINANCE_PERMISSIONS.includes(permissionKey)) {
          return error(
            res,
            `A role limited to its own children cannot hold ${permissionKey}: it covers every family in the unit`,
            409
          );
        }

        // Someone may grant only what they hold. Checked after the rule above,
        // which holds whoever asks.
        if (permissionCountsAgainstGrantor(permissionCheck.rows[0], role)
          && !(req.userPermissions || []).includes(permissionKey)) {
          return forbidden(
            res,
            'You can only add permissions you hold',
            [permissionKey],
            [permissionKey]
          );
        }

        // Add permission to role
        await pool.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [roleId, permissionId]
        );

        return success(res, null, 'Permission added to role');
      } catch (err) {
        logger.error('Error adding permission to role:', err);
        return error(res, 'Failed to add permission to role', 500);
      }
    })
  );

  /**
   * DELETE /api/v1/roles/:roleId/permissions/:permissionId
   * Remove permission from a role (custom roles only)
   * Available to: district only
   */
  router.delete('/api/v1/roles/:roleId/permissions/:permissionId',
    authenticate,
    blockDemoRoles,
    requirePermission('roles.manage'),
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const roleId = parsePositiveId(req.params.roleId);
        const permissionId = parsePositiveId(req.params.permissionId);

        // Only the unit's own custom roles can change; built-in roles are shared.
        const [role] = roleId ? await findRolesInUnit(pool, [roleId], organizationId) : [];

        if (!role) {
          return error(res, 'Role not found', 404);
        }

        if (role.is_system_role) {
          return error(res, 'Cannot modify system roles', 403);
        }

        const permissionCheck = await pool.query(
          'SELECT permission_key, self_scoped FROM permissions WHERE id = $1',
          [permissionId]
        );

        if (permissionCheck.rows.length === 0) {
          return error(res, 'Permission not found', 404);
        }

        // Removing a permission changes what every holder of the role can do,
        // so it takes the same standing as granting it.
        const { permission_key: permissionKey } = permissionCheck.rows[0];
        if (permissionCountsAgainstGrantor(permissionCheck.rows[0], role)
          && !(req.userPermissions || []).includes(permissionKey)) {
          return forbidden(
            res,
            'You can only remove permissions you hold',
            [permissionKey],
            [permissionKey]
          );
        }

        // Remove permission from role
        await pool.query(
          'DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
          [roleId, permissionId]
        );

        return success(res, null, 'Permission removed from role');
      } catch (err) {
        logger.error('Error removing permission from role:', err);
        return error(res, 'Failed to remove permission from role', 500);
      }
    })
  );

  /**
   * POST /api/v1/roles
   * Create a new custom role
   * Available to: district only
   */
  router.post('/api/v1/roles',
    authenticate,
    blockDemoRoles,
    requirePermission('roles.manage'),
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const { role_name: requestedName, display_name: displayName, description } = req.body;

        if (!requestedName || !displayName) {
          return error(res, 'role_name and display_name are required', 400);
        }

        const roleKey = customRoleKey(organizationId, requestedName);
        if (!roleKey) {
          return error(res, 'role_name must contain letters or digits', 400);
        }

        // A custom role belongs to the unit that creates it.
        const result = await pool.query(
          `INSERT INTO roles (role_name, display_name, description, is_system_role, organization_id)
           VALUES ($1, $2, $3, false, $4)
           RETURNING *`,
          [roleKey, displayName, description, organizationId]
        );

        logger.info(`User ${req.user.id} created role ${roleKey} in unit ${organizationId}`);

        return success(res, result.rows[0], 'Role created successfully', 201);
      } catch (err) {
        if (err.code === '23505') { // Unique constraint violation
          return error(res, 'Role name already exists', 409);
        }

        logger.error('Error creating role:', err);
        return error(res, 'Failed to create role', 500);
      }
    })
  );

  /**
   * DELETE /api/v1/roles/:roleId
   * Delete a custom role
   * Available to: district only
   */
  router.delete('/api/v1/roles/:roleId',
    authenticate,
    blockDemoRoles,
    requirePermission('roles.manage'),
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const roleId = parsePositiveId(req.params.roleId);

        // Only the unit's own custom roles can be deleted; built-in roles are shared.
        const [role] = roleId ? await findRolesInUnit(pool, [roleId], organizationId) : [];

        if (!role) {
          return error(res, 'Role not found', 404);
        }

        if (role.is_system_role) {
          return error(res, 'Cannot delete system roles', 403);
        }

        // Deleting a role takes its permissions from everyone holding it.
        const check = await checkRolesGrantable(pool, [roleId], req.userPermissions);
        if (!check.allowed) {
          return forbidden(
            res,
            'You can only delete roles whose permissions you hold',
            check.required,
            check.missing
          );
        }

        // Delete role (cascade will handle role_permissions)
        await pool.query('DELETE FROM roles WHERE id = $1 AND organization_id = $2', [roleId, organizationId]);

        logger.info(`User ${req.user.id} deleted role: ${role.role_name}`);

        return success(res, null, 'Role deleted successfully');
      } catch (err) {
        logger.error('Error deleting role:', err);
        return error(res, 'Failed to delete role', 500);
      }
    })
  );

  /**
   * @swagger
   * /api/v1/audit/roles:
   *   get:
   *     summary: History of a member's role changes in the unit
   *     description: >
   *       Newest first. Each entry gives who made the change, when, the roles
   *       before and after (as they were then) and the optional note.
   *     tags: [Roles]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: user_id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 50
   *           default: 15
   *     responses:
   *       200:
   *         description: Role changes, newest first
   *       400:
   *         description: Invalid user_id or limit
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/api/v1/audit/roles',
    authenticate,
    requirePermission('users.view'),
    query('user_id').isUUID(),
    query('limit').optional().isInt({ min: 1, max: ROLE_AUDIT_MAX_LIMIT }).toInt(),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const limit = req.query.limit || ROLE_AUDIT_DEFAULT_LIMIT;

      const result = await pool.query(
        `SELECT a.id, a.created_at, a.previous_roles, a.new_roles, a.note,
                a.changed_by, actor.full_name AS actor_name
           FROM role_assignment_audit a
           LEFT JOIN users actor ON actor.id = a.changed_by
          WHERE a.organization_id = $1 AND a.user_id = $2
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $3`,
        [organizationId, req.query.user_id, limit]
      );

      return success(res, result.rows, 'Role history retrieved');
    })
  );

  return router;
};
