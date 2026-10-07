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
const { authenticate, requirePermission, blockDemoRoles } = require('../middleware/auth');
const { success, error, forbidden, asyncHandler } = require('../middleware/response');
const { UNIT_FINANCE_PERMISSIONS } = require('../config/constants');
const { checkRolesGrantable, permissionCountsAgainstGrantor } = require('../services/roleAssignment');

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
          [req.userPermissions || []]
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
        const { roleId } = req.params;

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
        const { roleId } = req.params;
        const { permissionId } = req.body;

        // Verify role is not a system role
        const roleCheck = await pool.query(
          'SELECT is_system_role, data_scope FROM roles WHERE id = $1',
          [roleId]
        );

        if (roleCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'Role not found'
          });
        }

        if (roleCheck.rows[0].is_system_role) {
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
        if (roleCheck.rows[0].data_scope === 'linked' && UNIT_FINANCE_PERMISSIONS.includes(permissionKey)) {
          return error(
            res,
            `A role limited to its own children cannot hold ${permissionKey}: it covers every family in the unit`,
            409
          );
        }

        // Someone may grant only what they hold. Checked after the rule above,
        // which holds whoever asks.
        if (permissionCountsAgainstGrantor(permissionCheck.rows[0], roleCheck.rows[0])
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
        const { roleId, permissionId } = req.params;

        // Verify role is not a system role
        const roleCheck = await pool.query(
          'SELECT is_system_role, data_scope FROM roles WHERE id = $1',
          [roleId]
        );

        if (roleCheck.rows.length === 0) {
          return error(res, 'Role not found', 404);
        }

        if (roleCheck.rows[0].is_system_role) {
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
        if (permissionCountsAgainstGrantor(permissionCheck.rows[0], roleCheck.rows[0])
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
        const { role_name, display_name, description } = req.body;

        if (!role_name || !display_name) {
          return error(res, 'role_name and display_name are required', 400);
        }

        const result = await pool.query(
          `INSERT INTO roles (role_name, display_name, description, is_system_role)
           VALUES ($1, $2, $3, false)
           RETURNING *`,
          [role_name, display_name, description]
        );

        logger.info(`User ${req.user.id} created new role: ${role_name}`);

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
        const { roleId } = req.params;

        // Verify role is not a system role
        const roleCheck = await pool.query(
          'SELECT is_system_role, role_name FROM roles WHERE id = $1',
          [roleId]
        );

        if (roleCheck.rows.length === 0) {
          return error(res, 'Role not found', 404);
        }

        if (roleCheck.rows[0].is_system_role) {
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
        await pool.query('DELETE FROM roles WHERE id = $1', [roleId]);

        logger.info(`User ${req.user.id} deleted role: ${roleCheck.rows[0].role_name}`);

        return success(res, null, 'Role deleted successfully');
      } catch (err) {
        logger.error('Error deleting role:', err);
        return error(res, 'Failed to delete role', 500);
      }
    })
  );

  return router;
};
