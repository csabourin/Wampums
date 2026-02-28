/**
 * User Management Routes
 *
 * Handles user operations, role management, participant linking, and permissions
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/users
 */

const express = require('express');
const router = express.Router();

// Import auth middleware
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { asyncHandler, success, error } = require('../middleware/response');

// Import utilities
const { getCurrentOrganizationId, verifyJWT, handleOrganizationResolutionError, verifyOrganizationMembership } = require('../utils/api-helpers');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with user management routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/v1/users:
   *   get:
   *     summary: Get all users in organization
   *     description: Retrieve list of all users belonging to current organization (admin only)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: organization_id
   *         schema:
   *           type: integer
   *         description: Optional organization ID override
   *     responses:
   *       200:
   *         description: List of users
   *       401:
   *         description: Unauthorized
   */
  router.get('/', authenticate, requirePermission('users.view'), asyncHandler(async (req, res) => {
    const organizationId = req.query.organization_id || await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT
         u.id,
         u.email,
         u.full_name,
         u.is_verified,
         uo.role_ids,
         COALESCE(
           (SELECT json_agg(json_build_object('id', r.id, 'role_name', r.role_name, 'display_name', r.display_name))
            FROM roles r
            WHERE r.id = ANY(SELECT jsonb_array_elements_text(uo.role_ids)::int)),
           '[]'::json
         ) as roles
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE uo.organization_id = $1
       ORDER BY u.full_name`,
      [organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * @swagger
   * /api/v1/users/pending:
   *   get:
   *     summary: Get pending users awaiting approval
   *     description: Retrieve list of unverified users (admin only)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of pending users
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/pending', authenticate, requirePermission('users.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT
         u.id,
         u.email,
         u.full_name,
         u.is_verified,
         u.created_at,
         uo.role_ids,
         COALESCE(
           (SELECT json_agg(json_build_object('id', r.id, 'role_name', r.role_name, 'display_name', r.display_name))
            FROM roles r
            WHERE r.id = ANY(SELECT jsonb_array_elements_text(uo.role_ids)::int)),
           '[]'::json
         ) as roles
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE uo.organization_id = $1 AND u.is_verified = false
       ORDER BY u.created_at DESC`,
      [organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * @swagger
   * /api/v1/users/animateurs:
   *   get:
   *     summary: Get list of animators
   *     description: Retrieve users with admin or animation roles
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of animators
   */
  router.get('/animateurs', authenticate, requirePermission('users.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT u.id, u.full_name
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       JOIN roles r ON r.id = ANY(SELECT jsonb_array_elements_text(uo.role_ids)::int)
       WHERE uo.organization_id = $1 AND r.role_name IN ('district', 'unitadmin', 'leader')
       ORDER BY u.full_name`,
      [organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * @swagger
   * /api/v1/users/parents:
   *   get:
   *     summary: Get list of parent users
   *     description: Retrieve users with parent role
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of parent users
   */
  router.get('/parents', authenticate, requirePermission('users.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       JOIN roles r ON r.id = ANY(SELECT jsonb_array_elements_text(uo.role_ids)::int)
       WHERE uo.organization_id = $1 AND r.role_name IN ('parent', 'demoparent')
       ORDER BY u.full_name`,
      [organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * @swagger
   * /api/v1/users/children:
   *   get:
   *     summary: Get current user's children
   *     description: Retrieve participants linked to the authenticated user
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: User's children
   */
  router.get('/children', authenticate, requirePermission('participants.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
              g.name as group_name, pg.group_id
       FROM participants p
       JOIN user_participants up ON p.id = up.participant_id
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       WHERE up.user_id = $2 AND po.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId, req.user.id]
    );

    return success(res, result.rows);
  }));

  /**
   * @swagger
   * /api/v1/users/approve:
   *   post:
   *     summary: Approve a pending user
   *     description: Verify and approve a user account (admin only)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - user_id
   *             properties:
   *               user_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: User approved successfully
   *       403:
   *         description: Insufficient permissions
   */
  router.post('/approve', authenticate, blockDemoRoles, requirePermission('users.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { user_id } = req.body;

    if (!user_id) {
      return error(res, 'User ID is required', 400);
    }

    // Verify target user exists and belongs to this organization
    const userCheck = await pool.query(
      `SELECT u.id, u.email FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE u.id = $1 AND uo.organization_id = $2`,
      [user_id, organizationId]
    );

    if (userCheck.rows.length === 0) {
      return error(res, 'User not found in this organization', 404);
    }

    // Update user verification status
    await pool.query(
      `UPDATE users SET is_verified = true WHERE id = $1`,
      [user_id]
    );

    logger.info(`User ${user_id} approved by admin ${req.user.id}`);
    return success(res, null, 'User approved successfully');
  }));

  /**
   * @swagger
   * /api/v1/users/update-role:
   *   post:
   *     summary: Update user role in organization
   *     description: Change a user's role (admin only)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - user_id
   *               - role
   *             properties:
   *               user_id:
   *                 type: integer
   *               role:
   *                 type: string
   *                 enum: [admin, animation, parent, leader]
   *     responses:
   *       200:
   *         description: Role updated successfully
   *       400:
   *         description: Invalid role or cannot change own role
   */
  router.post('/update-role', authenticate, blockDemoRoles, requirePermission('users.assign_roles'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { user_id, role } = req.body;

    if (!user_id || !role) {
      return error(res, 'User ID and role are required', 400);
    }

    // Map old role names to new role names for backwards compatibility
    const roleMapping = {
      'admin': 'district',
      'animation': 'leader',
      'parent': 'parent',
      'leader': 'leader'
    };

    // Support both old and new role names
    const mappedRole = roleMapping[role] || role;

    // Get list of valid roles from database
    const rolesResult = await pool.query('SELECT role_name FROM roles');
    const validRoles = rolesResult.rows.map(r => r.role_name);

    if (!validRoles.includes(mappedRole)) {
      return error(res, `Invalid role. Valid roles: ${validRoles.join(', ')}`, 400);
    }

    // Prevent users from changing their own role
    if (user_id === req.user.id) {
      return error(res, 'Cannot change your own role', 400);
    }

    // Check if user is trying to assign district role
    if (mappedRole === 'district' && !req.userPermissions.includes('users.assign_district')) {
      return error(res, 'You do not have permission to assign the district administrator role', 403);
    }

    // Verify target user belongs to this organization
    const userCheck = await pool.query(
      `SELECT id FROM user_organizations WHERE user_id = $1 AND organization_id = $2`,
      [user_id, organizationId]
    );

    if (userCheck.rows.length === 0) {
      return error(res, 'User not found in this organization', 404);
    }

    // Get role ID for the new role
    const roleIdResult = await pool.query(
      'SELECT id FROM roles WHERE role_name = $1',
      [mappedRole]
    );

    if (roleIdResult.rows.length === 0) {
      return error(res, 'Role not found', 400);
    }

    const roleId = roleIdResult.rows[0].id;

    // Update user role in organization (both old and new columns for backwards compatibility)
    await pool.query(
      `UPDATE user_organizations
       SET role = $1, role_ids = jsonb_build_array($2::integer)
       WHERE user_id = $3 AND organization_id = $4`,
      [mappedRole, roleId, user_id, organizationId]
    );

    logger.info(`User ${user_id} role updated to ${mappedRole} (ID: ${roleId}) by user ${req.user.id}`);
    return success(res, null, 'User role updated successfully');
  }));

  /**
   * @swagger
   * /api/v1/users/{userId}/roles:
   *   get:
   *     summary: Get user's roles in organization
   *     description: Retrieve all roles assigned to a user in the current organization
   *     tags: [Users, Roles]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
   *     responses:
   *       200:
   *         description: User roles retrieved successfully
   *       404:
   *         description: User not found in organization
   */
  router.get('/:userId/roles', authenticate, requirePermission('users.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.params.userId; // UUID, not integer

    // Verify user belongs to organization
    const userCheck = await pool.query(
      `SELECT role_ids FROM user_organizations WHERE user_id = $1 AND organization_id = $2`,
      [userId, organizationId]
    );

    if (userCheck.rows.length === 0) {
      return error(res, 'User not found in this organization', 404);
    }

    const roleIds = userCheck.rows[0].role_ids || [];

    // Get role details
    if (roleIds.length === 0) {
      return success(res, []);
    }

    const rolesResult = await pool.query(
      `SELECT id, role_name, display_name, description
       FROM roles
       WHERE id = ANY($1::int[])
       ORDER BY display_name`,
      [roleIds]
    );

    return success(res, rolesResult.rows);
  }));

  /**
   * @swagger
   * /api/v1/users/{userId}/roles:
   *   put:
   *     summary: Update user's roles in organization
   *     description: Assign multiple roles to a user (replaces all existing roles)
   *     tags: [Users, Roles]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - roleIds
   *             properties:
   *               roleIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 description: Array of role IDs to assign
   *     responses:
   *       200:
   *         description: Roles updated successfully
   *       400:
   *         description: Invalid role IDs or cannot change own roles
   *       403:
   *         description: Insufficient permissions
   */
  router.put('/:userId/roles', authenticate, blockDemoRoles, requirePermission('users.assign_roles'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.params.userId; // UUID, not integer
    const { roleIds } = req.body;

    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      return error(res, 'roleIds must be a non-empty array', 400);
    }

    // Prevent users from changing their own roles (compare as strings since both are UUIDs)
    if (userId === String(req.user.id)) {
      return error(res, 'Cannot change your own roles', 400);
    }

    // Verify all role IDs are valid
    const rolesResult = await pool.query(
      `SELECT id, role_name FROM roles WHERE id = ANY($1::int[])`,
      [roleIds]
    );

    if (rolesResult.rows.length !== roleIds.length) {
      return error(res, 'One or more invalid role IDs', 400);
    }

    // Check if user is trying to assign district role
    const hasDistrictRole = rolesResult.rows.some(r => r.role_name === 'district');
    if (hasDistrictRole && !req.userPermissions.includes('users.assign_district')) {
      return error(res, 'You do not have permission to assign the district administrator role', 403);
    }

    // Verify target user belongs to this organization
    const userCheck = await pool.query(
      `SELECT id FROM user_organizations WHERE user_id = $1 AND organization_id = $2`,
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

    logger.info(`User ${userId} roles updated to [${roleIds.join(', ')}] by user ${req.user.id}`);
    return success(res, null, 'User roles updated successfully');
  }));

  /**
   * @swagger
   * /api/v1/users/link-participants:
   *   post:
   *     summary: Link user to participants
   *     description: Associate user with multiple participants (children). Admins can link any user, regular users can only link themselves.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - participant_ids
   *             properties:
   *               user_id:
   *                 type: integer
   *                 description: User ID (optional, defaults to current user)
   *               participant_ids:
   *                 type: array
   *                 items:
   *                   type: integer
   *               replace_all:
   *                 type: boolean
   *                 description: If true, replace all existing links (admin only)
   *     responses:
   *       200:
   *         description: User linked successfully
   */
  router.post('/link-participants', authenticate, blockDemoRoles, requirePermission('participants.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    let { user_id, participant_ids } = req.body;

    // If no user_id provided, use the current user (self-linking)
    if (!user_id) {
      user_id = req.user.id;
    }

    // If user is trying to link someone else, they need users.edit permission
    // This is already checked by the middleware, so we just verify it's them or they have permission
    if (user_id !== req.user.id) {
      // Additional check: must have users.edit permission to link other users
      const { hasAnyPermission } = require('../middleware/auth');
      if (!hasAnyPermission(req, 'users.edit')) {
        return error(res, 'Only admins can link participants to other users', 403);
      }
    }

    if (!participant_ids || !Array.isArray(participant_ids)) {
      return error(res, 'participant_ids array is required', 400);
    }

    // Verify target user belongs to this organization
    const userCheck = await pool.query(
      `SELECT id FROM user_organizations WHERE user_id = $1 AND organization_id = $2`,
      [user_id, organizationId]
    );

    if (userCheck.rows.length === 0) {
      return error(res, 'User not found in this organization', 404);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Only remove existing links if replace_all is true (admin replacing all links)
      // For self-linking (adding children), we just add to existing links
      const replaceAll = req.body.replace_all === true;
      if (replaceAll && user_id !== req.user.id) {
        await client.query(
          `DELETE FROM user_participants WHERE user_id = $1`,
          [user_id]
        );
      }

      // Add new links for each participant (verify they belong to org)
      for (const participantId of participant_ids) {
        // Verify participant belongs to this organization
        const participantCheck = await client.query(
          `SELECT id FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE p.id = $1 AND po.organization_id = $2`,
          [participantId, organizationId]
        );

        if (participantCheck.rows.length > 0) {
          await client.query(
            `INSERT INTO user_participants (user_id, participant_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, participant_id) DO NOTHING`,
            [user_id, participantId]
          );
        }
      }

      await client.query('COMMIT');
      logger.info(`User ${user_id} linked to ${participant_ids.length} participants`);
      return success(res, null, 'User linked to participants successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  /**
   * @swagger
   * /api/v1/users/associate-participant:
   *   post:
   *     summary: Associate user with single participant
   *     description: Link a user to one participant (admin/animation only)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - user_id
   *               - participant_id
   *             properties:
   *               user_id:
   *                 type: integer
   *               participant_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Association created
   */
  router.post('/associate-participant', authenticate, blockDemoRoles, requirePermission('participants.edit'), asyncHandler(async (req, res) => {
    const { user_id, participant_id } = req.body;

    if (!user_id || !participant_id) {
      return error(res, 'User ID and participant ID are required', 400);
    }

    await pool.query(
      `INSERT INTO user_participants (user_id, participant_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, participant_id) DO NOTHING`,
      [user_id, participant_id]
    );

    return success(res, null, 'User associated with participant successfully');
  }));

  /**
   * @swagger
   * /api/v1/users/permissions/check:
   *   post:
   *     summary: Check if user has permission for a specific operation
   *     description: Verify user permissions based on role and operation
   *     tags: [Authorization]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - operation
   *             properties:
   *               operation:
   *                 type: string
   *     responses:
   *       200:
   *         description: Permission check result
   */
  router.post('/permissions/check', authenticate, asyncHandler(async (req, res) => {
    const { operation } = req.body;

    if (!operation) {
      return success(res, { hasPermission: false }, 'Permission check result');
    }

    // Use the permission system to check if user has the requested permission
    const hasPermission = req.userPermissions ? req.userPermissions.includes(operation) : false;

    return success(res, { hasPermission }, 'Permission check result');
  }));

  return router;
};
