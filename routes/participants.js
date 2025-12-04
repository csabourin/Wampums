// RESTful routes for participants
const express = require('express');
const router = express.Router();
const { authenticate, authorize, getOrganizationId } = require('../middleware/auth');
const { success, error, paginated, asyncHandler } = require('../middleware/response');
const { verifyOrganizationMembership } = require('../utils/api-helpers');

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
        ...hasFlags,
        // Ensure total_points is a number (PostgreSQL may return it as string)
        total_points: parseInt(participantData.total_points) || 0
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

  // ============================================
  // NON-VERSIONED PARTICIPANT ENDPOINTS
  // These routes are mounted at /api, so 'participants' becomes '/api/participants'
  // ============================================

  /**
   * GET /api/participants
   * Get all participants (simple list with basic info)
   * Similar to v1 but returns simpler format
   */
  router.get('/participants', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              pg.group_id, g.name as group_name, pg.is_leader, pg.is_second_leader,
              COALESCE((SELECT SUM(value) FROM points WHERE participant_id = p.id AND organization_id = $1), 0) as total_points
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       WHERE po.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );

    return success(res, result.rows, 'Participants retrieved successfully');
  }));

  /**
   * GET /api/participant-details
   * Get participant details with optional filtering by participant_id
   * If participant_id is provided, returns single participant
   * Otherwise returns all participants with form submission flags
   */
  router.get('/participant-details', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const participantId = req.query.participant_id;

    if (participantId) {
      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                pg.group_id, g.name as group_name
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1 AND p.id = $2`,
        [organizationId, participantId]
      );

      if (result.rows.length > 0) {
        return success(res, { participant: result.rows[0] });
      } else {
        return error(res, 'Participant not found', 404);
      }
    } else {
      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                pg.group_id, g.name as group_name, pg.is_leader, pg.is_second_leader,
                (SELECT COUNT(*) FROM form_submissions fs WHERE fs.participant_id = p.id AND fs.form_type = 'fiche_sante') > 0 as has_fiche_sante,
                (SELECT COUNT(*) FROM form_submissions fs WHERE fs.participant_id = p.id AND fs.form_type = 'acceptation_risque') > 0 as has_acceptation_risque
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );

      return success(res, { participants: result.rows });
    }
  }));

  /**
   * POST /api/save-participant
   * Save participant (create or update)
   * Includes duplicate checking and group assignment
   */
  router.post('/save-participant', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId);
    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id, first_name, last_name, date_naissance, group_id } = req.body;

    if (!first_name || !last_name) {
      return error(res, 'First name and last name are required', 400);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let participantId;

      if (id) {
        // Update existing participant
        const updateResult = await client.query(
          `UPDATE participants SET first_name = $1, last_name = $2, date_naissance = $3
           WHERE id = $4 RETURNING id`,
          [first_name, last_name, date_naissance || null, id]
        );

        if (updateResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return error(res, 'Participant not found', 404);
        }

        participantId = id;
      } else {
        // Check for duplicate participant (same first name, last name, and date of birth)
        const duplicateCheck = await client.query(
          `SELECT p.id FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE LOWER(p.first_name) = LOWER($1)
             AND LOWER(p.last_name) = LOWER($2)
             AND p.date_naissance = $3
             AND po.organization_id = $4`,
          [first_name, last_name, date_naissance || null, organizationId]
        );

        if (duplicateCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return error(res, 'A participant with this name and date of birth already exists', 409);
        }

        // Create new participant
        const insertResult = await client.query(
          `INSERT INTO participants (first_name, last_name, date_naissance)
           VALUES ($1, $2, $3) RETURNING id`,
          [first_name, last_name, date_naissance || null]
        );

        participantId = insertResult.rows[0].id;

        // Link to organization
        await client.query(
          `INSERT INTO participant_organizations (participant_id, organization_id)
           VALUES ($1, $2)
           ON CONFLICT (participant_id, organization_id) DO NOTHING`,
          [participantId, organizationId]
        );
      }

      // Update group assignment if provided
      if (group_id !== undefined) {
        // Remove existing group assignment for this org
        await client.query(
          `DELETE FROM participant_groups WHERE participant_id = $1 AND organization_id = $2`,
          [participantId, organizationId]
        );

        // Add new group assignment if group_id is not null
        if (group_id) {
          await client.query(
            `INSERT INTO participant_groups (participant_id, group_id, organization_id)
             VALUES ($1, $2, $3)`,
            [participantId, group_id, organizationId]
          );
        }
      }

      await client.query('COMMIT');

      return success(res, {
        participant_id: participantId,
        message: id ? 'Participant updated successfully' : 'Participant created successfully'
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  /**
   * POST /api/update-participant-group
   * Update participant group membership and roles (leader/second leader)
   */
  router.post('/update-participant-group', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId);
    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { participant_id, group_id, is_leader, is_second_leader } = req.body;

    if (!participant_id) {
      return error(res, 'Participant ID is required', 400);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Remove existing group assignment for this participant and organization
      await client.query(
        `DELETE FROM participant_groups WHERE participant_id = $1 AND organization_id = $2`,
        [participant_id, organizationId]
      );

      // Add new group assignment if group_id is not null/empty
      if (group_id) {
        await client.query(
          `INSERT INTO participant_groups (participant_id, group_id, organization_id, is_leader, is_second_leader)
           VALUES ($1, $2, $3, $4, $5)`,
          [participant_id, group_id, organizationId, is_leader || false, is_second_leader || false]
        );
      }

      await client.query('COMMIT');

      return success(res, null, group_id ? 'Group membership updated successfully' : 'Participant removed from group');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  /**
   * POST /api/link-participant-to-organization
   * Link participant to organization
   */
  router.post('/link-participant-to-organization', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { participant_id } = req.body;

    if (!participant_id) {
      return error(res, 'Participant ID is required', 400);
    }

    // Insert or do nothing if already linked
    await pool.query(
      `INSERT INTO participant_organizations (participant_id, organization_id)
       VALUES ($1, $2)
       ON CONFLICT (participant_id, organization_id) DO NOTHING`,
      [participant_id, organizationId]
    );

    return success(res, null, 'Participant linked to organization');
  }));

  /**
   * GET /api/participants-with-users
   * Get participants with their associated user information
   */
  router.get('/participants-with-users', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              pg.group_id, g.name as group_name, pg.is_leader, pg.is_second_leader,
              u.id as user_id, u.email as user_email, u.full_name as user_full_name
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       LEFT JOIN user_participants up ON p.id = up.participant_id
       LEFT JOIN users u ON up.user_id = u.id
       WHERE po.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );

    return success(res, { participants: result.rows });
  }));

  /**
   * POST /api/link-user-participants
   * Link user to multiple participants (self-linking or admin linking)
   */
  router.post('/link-user-participants', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId);
    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    let { user_id, participant_ids } = req.body;

    // If no user_id provided, use the current user (self-linking)
    if (!user_id) {
      user_id = req.user.id;
    }

    // If user is trying to link someone else, they need admin role
    if (user_id !== req.user.id) {
      const adminCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin']);
      if (!adminCheck.authorized) {
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
      return success(res, null, 'User linked to participants successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  /**
   * GET /api/participant-ages
   * Get participants with their calculated ages
   */
  router.get('/participant-ages', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
              DATE_PART('year', AGE(CURRENT_DATE, p.date_naissance)) as age,
              g.name as group_name
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       WHERE po.organization_id = $1
       ORDER BY age DESC, p.first_name, p.last_name`,
      [organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * GET /api/participant-calendar
   * Get calendar data for a specific participant
   */
  router.get('/participant-calendar', authenticate, asyncHandler(async (req, res) => {
    const { participant_id } = req.query;

    if (!participant_id) {
      return error(res, 'Participant ID is required', 400);
    }

    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT c.*, p.first_name, p.last_name
       FROM calendars c
       JOIN participants p ON c.participant_id = p.id
       WHERE c.participant_id = $1 AND c.organization_id = $2
       ORDER BY c.date DESC`,
      [participant_id, organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * GET /api/participants-with-documents
   * Get participants with their document submission status
   * Requires admin or animation role
   */
  router.get('/participants-with-documents', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              COUNT(DISTINCT fs.form_type) as forms_submitted,
              array_agg(DISTINCT fs.form_type) as submitted_forms
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN form_submissions fs ON p.id = fs.participant_id
       WHERE po.organization_id = $1
       GROUP BY p.id, p.first_name, p.last_name
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * POST /api/associate-user-participant
   * Associate a user with a participant
   * Requires admin or animation role
   */
  router.post('/associate-user-participant', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

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
   * POST /api/link-parent-participant
   * Link a parent to a participant (child)
   * Requires admin or animation role
   */
  router.post('/link-parent-participant', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { parent_id, participant_id, relationship } = req.body;

    if (!parent_id || !participant_id) {
      return error(res, 'Parent ID and participant ID are required', 400);
    }

    await pool.query(
      `INSERT INTO guardians (participant_id, guardian_id, relationship)
       VALUES ($1, $2, $3)
       ON CONFLICT (participant_id, guardian_id)
       DO UPDATE SET relationship = EXCLUDED.relationship`,
      [participant_id, parent_id, relationship || 'parent']
    );

    return success(res, null, 'Parent linked to participant successfully');
  }));

  /**
   * DELETE /api/participant-groups/:participantId
   * Remove participant from their group
   * Requires admin or animation role
   */
  router.delete('/participant-groups/:participantId', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { participantId } = req.params;

    const result = await pool.query(
      `DELETE FROM participant_groups
       WHERE participant_id = $1 AND organization_id = $2
       RETURNING *`,
      [participantId, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Participant group assignment not found', 404);
    }

    return success(res, null, 'Participant removed from group successfully');
  }));

  return router;
};
