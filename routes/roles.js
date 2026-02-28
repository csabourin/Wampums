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
const { success, error, asyncHandler } = require('../middleware/response');

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
   * GET /roles
   * Get all available roles
   * Available to: district, unitadmin
   */
  router.get('/roles',
    authenticate,
    requirePermission('roles.view'),
    asyncHandler(async (req, res) => {
      try {
        // Unitadmin cannot see district role
        const excludeDistrict = req.userRoles && !req.userRoles.includes('district');

        const query = excludeDistrict
          ? `SELECT id, role_name, display_name, description, is_system_role, created_at
             FROM roles
             WHERE role_name != 'district'
             ORDER BY
               CASE role_name
                 WHEN 'unitadmin' THEN 1
                 WHEN 'leader' THEN 2
                 WHEN 'parent' THEN 3
                 WHEN 'finance' THEN 4
                 WHEN 'equipment' THEN 5
                 WHEN 'administration' THEN 6
                 WHEN 'demoadmin' THEN 7
                 WHEN 'demoparent' THEN 8
                 ELSE 9
               END`
          : `SELECT id, role_name, display_name, description, is_system_role, created_at
             FROM roles
             ORDER BY
               CASE role_name
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
               END`;

        const result = await pool.query(query);

        return success(res, result.rows, 'Roles retrieved successfully');
      } catch (error) {
        logger.error('Error fetching roles:', error);
        return error(res, 'Failed to fetch roles', 500);
      }
    })
  );

  /**
   * GET /roles/:roleId/permissions
   * Get permissions for a specific role
   * Available to: district, unitadmin
   */
  router.get('/roles/:roleId/permissions',
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
      } catch (error) {
        logger.error('Error fetching role permissions:', error);
        return error(res, 'Failed to fetch role permissions', 500);
      }
    })
  );

  /**
   * GET /permissions
   * Get all available permissions grouped by category
   * Available to: district, unitadmin
   */
  router.get('/permissions',
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
      } catch (error) {
        logger.error('Error fetching permissions:', error);
        return error(res, 'Failed to fetch permissions', 500);
      }
    })
  );

  /**
   * POST /roles/:roleId/permissions
   * Add permission to a role (custom roles only)
   * Available to: district only
   */
  router.post('/roles/:roleId/permissions',
    authenticate,
    blockDemoRoles,
    requirePermission('roles.manage'),
    asyncHandler(async (req, res) => {
      try {
        const { roleId } = req.params;
        const { permissionId } = req.body;

        // Verify role is not a system role
        const roleCheck = await pool.query(
          'SELECT is_system_role FROM roles WHERE id = $1',
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

        // Add permission to role
        await pool.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [roleId, permissionId]
        );

        return success(res, null, 'Permission added to role');
      } catch (error) {
        logger.error('Error adding permission to role:', error);
        return error(res, 'Failed to add permission to role', 500);
      }
    })
  );

  /**
   * DELETE /roles/:roleId/permissions/:permissionId
   * Remove permission from a role (custom roles only)
   * Available to: district only
   */
  router.delete('/roles/:roleId/permissions/:permissionId',
    authenticate,
    blockDemoRoles,
    requirePermission('roles.manage'),
    asyncHandler(async (req, res) => {
      try {
        const { roleId, permissionId } = req.params;

        // Verify role is not a system role
        const roleCheck = await pool.query(
          'SELECT is_system_role FROM roles WHERE id = $1',
          [roleId]
        );

        if (roleCheck.rows.length === 0) {
          return error(res, 'Role not found', 404);
        }

        if (roleCheck.rows[0].is_system_role) {
          return error(res, 'Cannot modify system roles', 403);
        }

        // Remove permission from role
        await pool.query(
          'DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
          [roleId, permissionId]
        );

        return success(res, null, 'Permission removed from role');
      } catch (error) {
        logger.error('Error removing permission from role:', error);
        return error(res, 'Failed to remove permission from role', 500);
      }
    })
  );

  /**
   * POST /roles
   * Create a new custom role
   * Available to: district only
   */
  router.post('/roles',
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
      } catch (error) {
        if (error.code === '23505') { // Unique constraint violation
          return error(res, 'Role name already exists', 409);
        }

        logger.error('Error creating role:', error);
        return error(res, 'Failed to create role', 500);
      }
    })
  );

  /**
   * DELETE /roles/:roleId
   * Delete a custom role
   * Available to: district only
   */
  router.delete('/roles/:roleId',
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

        // Delete role (cascade will handle role_permissions)
        await pool.query('DELETE FROM roles WHERE id = $1', [roleId]);

        logger.info(`User ${req.user.id} deleted role: ${roleCheck.rows[0].role_name}`);

        return success(res, null, 'Role deleted successfully');
      } catch (error) {
        logger.error('Error deleting role:', error);
        return error(res, 'Failed to delete role', 500);
      }
    })
  );

  return router;
};
