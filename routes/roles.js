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
const { authenticate, requirePermission, blockDemoRoles, hasAnyRole } = require('../middleware/auth');
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
   * GET /api/roles
   * Get all available roles
   * Available to: district, unitadmin
   */
  router.get('/api/roles',
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
   * GET /api/roles/:roleId/permissions
   * Get permissions for a specific role
   * Available to: district, unitadmin
   */
  router.get('/api/roles/:roleId/permissions',
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
   * GET /api/permissions
   * Get all available permissions grouped by category
   * Available to: district, unitadmin
   */
  router.get('/api/permissions',
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
   * GET /api/users/:userId/roles
   * Get roles assigned to a specific user in this organization
   * Available to: district, unitadmin
   */
  router.get('/api/users/:userId/roles',
    authenticate,
    requirePermission('users.view'),
    asyncHandler(async (req, res) => {
      try {
        const { userId } = req.params;
        const organizationId = req.organizationId;

        const query = `
          SELECT r.id, r.role_name, r.display_name, r.description
          FROM user_organizations uo
          CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
          JOIN roles r ON r.id = role_id_text::integer
          WHERE uo.user_id = $1 AND uo.organization_id = $2
          ORDER BY
            CASE r.role_name
              WHEN 'district' THEN 0
              WHEN 'unitadmin' THEN 1
              WHEN 'leader' THEN 2
              WHEN 'parent' THEN 3
              ELSE 4
            END
        `;

        const result = await pool.query(query, [userId, organizationId]);

        return success(res, result.rows, 'User roles retrieved successfully');
      } catch (error) {
        logger.error('Error fetching user roles:', error);
        return error(res, 'Failed to fetch user roles', 500);
      }
    })
  );

  /**
   * PUT /api/users/:userId/roles
   * Update roles for a specific user in this organization
   * Available to: district, unitadmin (unitadmin cannot assign district role)
   */
  router.put('/api/users/:userId/roles',
    authenticate,
    blockDemoRoles,
    requirePermission('users.assign_roles'),
    asyncHandler(async (req, res) => {
      try {
        const { userId } = req.params;
        const { roleIds } = req.body; // Array of role IDs
        const organizationId = req.organizationId;

        if (!Array.isArray(roleIds) || roleIds.length === 0) {
          return error(res, 'roleIds must be a non-empty array', 400);
        }

        // Check if user is trying to assign district role without permission
        const rolesCheck = await pool.query(
          'SELECT role_name FROM roles WHERE id = ANY($1)',
          [roleIds]
        );

        const roleNames = rolesCheck.rows.map(r => r.role_name);
        const hasDistrictRole = roleNames.includes('district');

        if (hasDistrictRole && !req.userRoles.includes('district')) {
          return error(res, 'Only district administrators can assign the district role', 403);
        }

        // Check if user exists and is member of organization
        const userCheck = await pool.query(
          'SELECT user_id FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
          [userId, organizationId]
        );

        if (userCheck.rows.length === 0) {
          return error(res, 'User not found in this organization', 404);
        }

        // Update user roles
        await pool.query(
          `UPDATE user_organizations
           SET role_ids = $1::jsonb
           WHERE user_id = $2 AND organization_id = $3`,
          [JSON.stringify(roleIds), userId, organizationId]
        );

        logger.info(`User ${req.user.id} updated roles for user ${userId} to: ${roleNames.join(', ')}`);

        return success(res, null, 'User roles updated successfully');
      } catch (error) {
        logger.error('Error updating user roles:', error);
        return error(res, 'Failed to update user roles', 500);
      }
    })
  );

  /**
   * POST /api/roles/:roleId/permissions
   * Add permission to a role (custom roles only)
   * Available to: district only
   */
  router.post('/api/roles/:roleId/permissions',
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
   * DELETE /api/roles/:roleId/permissions/:permissionId
   * Remove permission from a role (custom roles only)
   * Available to: district only
   */
  router.delete('/api/roles/:roleId/permissions/:permissionId',
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
   * POST /api/roles
   * Create a new custom role
   * Available to: district only
   */
  router.post('/api/roles',
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
   * DELETE /api/roles/:roleId
   * Delete a custom role
   * Available to: district only
   */
  router.delete('/api/roles/:roleId',
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
