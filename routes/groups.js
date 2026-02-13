// RESTful routes for groups
const express = require('express');
const router = express.Router();
const winston = require('winston');
const { authenticate, authorize, getOrganizationId, requirePermission, blockDemoRoles } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { requireJWTSecret, verifyJWTToken } = require('../utils/jwt-config');
// Configure logger for non-v1 endpoints
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Add console logging in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// JWT verification helper for non-v1 endpoints
requireJWTSecret();
function verifyJWT(token) {
  try {
    return verifyJWTToken(token);
  } catch (e) {
    return null;
  }
}

module.exports = (pool) => {
  /**
   * @swagger
   * /api/v1/groups:
   *   get:
   *     summary: Get all groups
   *     tags: [Groups]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of groups
   */
  router.get('/', authenticate, requirePermission('groups.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT g.*,
              COUNT(DISTINCT pg.participant_id) as member_count,
              COALESCE(SUM(p.value), 0) as total_points
       FROM groups g
       LEFT JOIN participant_groups pg ON g.id = pg.group_id AND pg.organization_id = $1
       LEFT JOIN points p ON g.id = p.group_id AND p.participant_id IS NULL AND p.organization_id = $1
       WHERE g.organization_id = $1
       GROUP BY g.id
       ORDER BY g.name`,
      [organizationId]
    );

    // Ensure numeric fields are numbers (PostgreSQL may return as strings)
    const groups = result.rows.map(g => ({
      ...g,
      member_count: parseInt(g.member_count) || 0,
      total_points: parseInt(g.total_points) || 0
    }));

    return success(res, groups);
  }));

  /**
   * @swagger
   * /api/v1/groups/{id}:
   *   get:
   *     summary: Get a specific group
   *     tags: [Groups]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Group details with members
   */
  router.get('/:id', authenticate, requirePermission('groups.view'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    // Get group info
    const groupResult = await pool.query(
      `SELECT g.*, COALESCE(SUM(p.value), 0) as total_points
       FROM groups g
       LEFT JOIN points p ON g.id = p.group_id AND p.participant_id IS NULL AND p.organization_id = $1
       WHERE g.id = $2 AND g.organization_id = $1
       GROUP BY g.id`,
      [organizationId, id]
    );

    if (groupResult.rows.length === 0) {
      return error(res, 'Group not found', 404);
    }

    // Get members
    const membersResult = await pool.query(
      `SELECT p.*, pg.first_leader, pg.second_leader,
              COALESCE(SUM(pts.value), 0) as total_points
       FROM participants p
       JOIN participant_groups pg ON p.id = pg.participant_id
       LEFT JOIN points pts ON p.id = pts.participant_id AND pts.organization_id = $1
       WHERE pg.group_id = $2 AND pg.organization_id = $1
       GROUP BY p.id, pg.first_leader, pg.second_leader
       ORDER BY pg.first_leader DESC, pg.second_leader DESC, p.first_name`,
      [organizationId, id]
    );

    const group = groupResult.rows[0];
    group.members = membersResult.rows;

    return success(res, group);
  }));

  /**
   * @swagger
   * /api/v1/groups:
   *   post:
   *     summary: Create a new group
   *     tags: [Groups]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *             properties:
   *               name:
   *                 type: string
   *     responses:
   *       201:
   *         description: Group created
  */
  router.post('/', authenticate, blockDemoRoles, requirePermission('groups.create'), asyncHandler(async (req, res) => {
    const { name } = req.body;
    const normalizedName = typeof name === 'string' ? name.trim() : '';

    if (!normalizedName) {
      return error(res, 'Group name is required', 400);
    }

    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `INSERT INTO groups (name, organization_id)
       VALUES ($1, $2)
       RETURNING *`,
      [normalizedName, organizationId]
    );

    return success(res, result.rows[0], 'Group created successfully', 201);
  }));

  /**
   * @swagger
   * /api/v1/groups/{id}:
   *   put:
   *     summary: Update a group
   *     tags: [Groups]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Group updated
   */
  router.put('/:id', authenticate, blockDemoRoles, requirePermission('groups.edit'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    const organizationId = await getOrganizationId(req, pool);

    const normalizedName = name !== undefined ? String(name).trim() : undefined;

    if (normalizedName === undefined) {
      return error(res, 'At least one field to update is required', 400);
    }

    if (!normalizedName) {
      return error(res, 'Group name is required', 400);
    }

    const result = await pool.query(
      `UPDATE groups
       SET name = $1
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
      [normalizedName, id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Group not found', 404);
    }

    return success(res, result.rows[0], 'Group updated successfully');
  }));

  /**
   * @swagger
   * /api/v1/groups/{id}:
   *   delete:
   *     summary: Delete a group
   *     tags: [Groups]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Group deleted
   */
  router.delete('/:id', authenticate, blockDemoRoles, requirePermission('groups.delete'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `DELETE FROM groups
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Group not found', 404);
    }

    return success(res, null, 'Group deleted successfully');
  }));

  return router;
};
