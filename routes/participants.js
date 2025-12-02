// RESTful routes for participants
const express = require('express');
const router = express.Router();
const { authenticate, authorize, getOrganizationId } = require('../middleware/auth');
const { success, error, paginated, asyncHandler } = require('../middleware/response');

module.exports = (pool) => {
  /**
   * @swagger
   * /api/v1/participants:
   *   get:
   *     summary: Get all participants
   *     tags: [Participants]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         description: Page number
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Items per page
   *       - in: query
   *         name: group_id
   *         schema:
   *           type: integer
   *         description: Filter by group
   *     responses:
   *       200:
   *         description: List of participants
   *       401:
   *         description: Unauthorized
   */
  router.get('/', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const groupId = req.query.group_id;
    const userRole = req.user.role;
    const userId = req.user.id;

    let query, params, countQuery, countParams;

    // If user is admin or animation, show ALL participants
    if (userRole === 'admin' || userRole === 'animation') {
      query = `
        SELECT p.*, pg.group_id, g.name as group_name,
               COALESCE(
                 (SELECT json_agg(json_build_object('form_type', form_type, 'updated_at', updated_at))
                  FROM form_submissions
                  WHERE participant_id = p.id AND organization_id = $1), '[]'::json
               ) as form_submissions,
               COALESCE(
                 (SELECT SUM(value) FROM points WHERE participant_id = p.id AND organization_id = $1),
                 0
               ) as total_points
        FROM participants p
        JOIN participant_organizations po ON p.id = po.participant_id
        LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
        LEFT JOIN groups g ON pg.group_id = g.id
        WHERE po.organization_id = $1
      `;

      params = [organizationId];

      if (groupId) {
        query += ` AND pg.group_id = $${params.length + 1}`;
        params.push(groupId);
      }

      query += ` ORDER BY p.first_name, p.last_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      // Count query for admin/animation
      countQuery = `
        SELECT COUNT(DISTINCT p.id) as total
        FROM participants p
        JOIN participant_organizations po ON p.id = po.participant_id
        ${groupId ? 'LEFT JOIN participant_groups pg ON p.id = pg.participant_id' : ''}
        WHERE po.organization_id = $1 ${groupId ? 'AND pg.group_id = $2' : ''}
      `;
      countParams = groupId ? [organizationId, groupId] : [organizationId];
    } else {
      // For parents, only show participants linked to them
      query = `
        SELECT p.*, pg.group_id, g.name as group_name,
               COALESCE(
                 (SELECT json_agg(json_build_object('form_type', form_type, 'updated_at', updated_at))
                  FROM form_submissions
                  WHERE participant_id = p.id AND organization_id = $1), '[]'::json
               ) as form_submissions,
               COALESCE(
                 (SELECT SUM(value) FROM points WHERE participant_id = p.id AND organization_id = $1),
                 0
               ) as total_points
        FROM participants p
        JOIN user_participants up ON p.id = up.participant_id
        JOIN participant_organizations po ON p.id = po.participant_id
        LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
        LEFT JOIN groups g ON pg.group_id = g.id
        WHERE up.user_id = $2 AND po.organization_id = $1
      `;

      params = [organizationId, userId];

      if (groupId) {
        query += ` AND pg.group_id = $${params.length + 1}`;
        params.push(groupId);
      }

      query += ` ORDER BY p.first_name, p.last_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      // Count query for parents
      countQuery = `
        SELECT COUNT(DISTINCT p.id) as total
        FROM participants p
        JOIN user_participants up ON p.id = up.participant_id
        JOIN participant_organizations po ON p.id = po.participant_id
        ${groupId ? 'LEFT JOIN participant_groups pg ON p.id = pg.participant_id' : ''}
        WHERE up.user_id = $1 AND po.organization_id = $2 ${groupId ? 'AND pg.group_id = $3' : ''}
      `;
      countParams = groupId ? [userId, organizationId, groupId] : [userId, organizationId];
    }

    const result = await pool.query(query, params);

    // Transform form_submissions into has_* flags
    const participants = result.rows.map(p => {
      const formSubmissions = p.form_submissions || [];
      const hasFlags = {};

      // Create has_* flags for each form type
      formSubmissions.forEach(submission => {
        hasFlags[`has_${submission.form_type}`] = true;
      });

      // Remove form_submissions from output
      const { form_submissions, ...participantData } = p;

      return {
        ...participantData,
        ...hasFlags
      };
    });

    // Get total count
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    return paginated(res, participants, page, limit, total);
  }));

  /**
   * @swagger
   * /api/v1/participants/{id}:
   *   get:
   *     summary: Get a specific participant
   *     tags: [Participants]
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
   *         description: Participant details
   *       404:
   *         description: Participant not found
   */
  router.get('/:id', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);
    const userRole = req.user.role;
    const userId = req.user.id;

    // Base query to get participant data
    let query = `
      SELECT p.*, pg.group_id, g.name as group_name, pg.is_leader, pg.is_second_leader,
             COALESCE(
               (SELECT json_agg(json_build_object('form_type', form_type, 'updated_at', updated_at))
                FROM form_submissions
                WHERE participant_id = p.id AND organization_id = $2), '[]'::json
             ) as form_submissions,
             COALESCE(
               (SELECT SUM(value) FROM points WHERE participant_id = p.id AND organization_id = $2),
               0
             ) as total_points
      FROM participants p
      JOIN participant_organizations po ON p.id = po.participant_id
      LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $2
      LEFT JOIN groups g ON pg.group_id = g.id
      WHERE p.id = $1 AND po.organization_id = $2
    `;

    let params = [id, organizationId];

    // For parent role, verify they have access to this participant
    if (userRole !== 'admin' && userRole !== 'animation') {
      query += ` AND EXISTS (
        SELECT 1 FROM user_participants up
        WHERE up.participant_id = p.id AND up.user_id = $3
      )`;
      params.push(userId);
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return error(res, 'Participant not found or access denied', 404);
    }

    // Transform form_submissions into has_* flags
    const participant = result.rows[0];
    const formSubmissions = participant.form_submissions || [];
    const hasFlags = {};

    formSubmissions.forEach(submission => {
      hasFlags[`has_${submission.form_type}`] = true;
    });

    // Remove form_submissions from output
    const { form_submissions, ...participantData } = participant;

    return success(res, {
      ...participantData,
      ...hasFlags
    });
  }));

  /**
   * @swagger
   * /api/v1/participants:
   *   post:
   *     summary: Create a new participant
   *     tags: [Participants]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - first_name
   *               - last_name
   *             properties:
   *               first_name:
   *                 type: string
   *               last_name:
   *                 type: string
   *               date_of_birth:
   *                 type: string
   *                 format: date
   *               group_id:
   *                 type: integer
   *     responses:
   *       201:
   *         description: Participant created
   */
  router.post('/', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
    const { first_name, last_name, date_of_birth, group_id } = req.body;
    const organizationId = await getOrganizationId(req, pool);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create participant
      const participantResult = await client.query(
        `INSERT INTO participants (first_name, last_name, date_of_birth)
         VALUES ($1, $2, $3) RETURNING *`,
        [first_name, last_name, date_of_birth]
      );

      const participantId = participantResult.rows[0].id;

      // Link to organization
      await client.query(
        `INSERT INTO participant_organizations (participant_id, organization_id)
         VALUES ($1, $2)`,
        [participantId, organizationId]
      );

      // Link to group if provided
      if (group_id) {
        await client.query(
          `INSERT INTO participant_groups (participant_id, group_id, organization_id)
           VALUES ($1, $2, $3)`,
          [participantId, group_id, organizationId]
        );
      }

      await client.query('COMMIT');

      return success(res, participantResult.rows[0], 'Participant created successfully', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  /**
   * @swagger
   * /api/v1/participants/{id}:
   *   put:
   *     summary: Update a participant
   *     tags: [Participants]
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
   *         description: Participant updated
   */
  router.put('/:id', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, date_of_birth, group_id } = req.body;
    const organizationId = await getOrganizationId(req, pool);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update participant
      const result = await client.query(
        `UPDATE participants
         SET first_name = COALESCE($1, first_name),
             last_name = COALESCE($2, last_name),
             date_of_birth = COALESCE($3, date_of_birth)
         WHERE id = $4
         RETURNING *`,
        [first_name, last_name, date_of_birth, id]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return error(res, 'Participant not found', 404);
      }

      // Update group if provided
      if (group_id !== undefined) {
        await client.query(
          `DELETE FROM participant_groups WHERE participant_id = $1 AND organization_id = $2`,
          [id, organizationId]
        );

        if (group_id) {
          await client.query(
            `INSERT INTO participant_groups (participant_id, group_id, organization_id)
             VALUES ($1, $2, $3)`,
            [id, group_id, organizationId]
          );
        }
      }

      await client.query('COMMIT');

      return success(res, result.rows[0], 'Participant updated successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  /**
   * @swagger
   * /api/v1/participants/{id}:
   *   delete:
   *     summary: Delete a participant
   *     tags: [Participants]
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
   *         description: Participant deleted
   */
  router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `DELETE FROM participant_organizations
       WHERE participant_id = $1 AND organization_id = $2
       RETURNING *`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Participant not found', 404);
    }

    return success(res, null, 'Participant removed from organization');
  }));

  return router;
};
