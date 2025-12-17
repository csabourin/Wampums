// RESTful routes for groups
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const winston = require('winston');
const { authenticate, authorize, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateProgramSection, ensureProgramSectionsSeeded } = require('../utils/programSections');

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
const jwtKey = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;
function verifyJWT(token) {
  try {
    return jwt.verify(token, jwtKey);
  } catch (e) {
    return null;
  }
}

function normalizeProgramSection(programSection) {
  return typeof programSection === 'string' ? programSection.trim() : '';
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
  router.get('/', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    await ensureProgramSectionsSeeded(pool, organizationId);

    const result = await pool.query(
      `SELECT g.*,
              ops.display_name AS program_section_label,
              COUNT(DISTINCT pg.participant_id) as member_count,
              COALESCE(SUM(p.value), 0) as total_points
       FROM groups g
       LEFT JOIN organization_program_sections ops ON ops.organization_id = g.organization_id AND ops.section_key = g.program_section
       LEFT JOIN participant_groups pg ON g.id = pg.group_id AND pg.organization_id = $1
       LEFT JOIN points p ON g.id = p.group_id AND p.participant_id IS NULL AND p.organization_id = $1
       WHERE g.organization_id = $1
       GROUP BY g.id, ops.display_name
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
  router.get('/:id', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    await ensureProgramSectionsSeeded(pool, organizationId);

    // Get group info
    const groupResult = await pool.query(
      `SELECT g.*, COALESCE(SUM(p.value), 0) as total_points, ops.display_name AS program_section_label
       FROM groups g
       LEFT JOIN organization_program_sections ops ON ops.organization_id = g.organization_id AND ops.section_key = g.program_section
       LEFT JOIN points p ON g.id = p.group_id AND p.participant_id IS NULL AND p.organization_id = $1
       WHERE g.id = $2 AND g.organization_id = $1
       GROUP BY g.id, ops.display_name`,
      [organizationId, id]
    );

    if (groupResult.rows.length === 0) {
      return error(res, 'Group not found', 404);
    }

    // Get members
    const membersResult = await pool.query(
      `SELECT p.*, pg.is_leader, pg.is_second_leader, pg.program_section,
              COALESCE(SUM(pts.value), 0) as total_points
       FROM participants p
       JOIN participant_groups pg ON p.id = pg.participant_id
       LEFT JOIN points pts ON p.id = pts.participant_id AND pts.organization_id = $1
       WHERE pg.group_id = $2 AND pg.organization_id = $1
       GROUP BY p.id, pg.is_leader, pg.is_second_leader, pg.program_section
       ORDER BY pg.is_leader DESC, pg.is_second_leader DESC, p.first_name`,
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
  router.post('/', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
    const { name, program_section } = req.body;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedProgramSection = normalizeProgramSection(program_section);

    if (!normalizedName) {
      return error(res, 'Group name is required', 400);
    }

    const organizationId = await getOrganizationId(req, pool);

    await ensureProgramSectionsSeeded(pool, organizationId);

    const sectionValidation = await validateProgramSection(pool, organizationId, normalizedProgramSection);

    if (!sectionValidation.valid) {
      return error(res, sectionValidation.message, 400);
    }

    const result = await pool.query(
      `INSERT INTO groups (name, organization_id, program_section)
       VALUES ($1, $2, $3)
       RETURNING *,
         (SELECT display_name FROM organization_program_sections ops
          WHERE ops.organization_id = $2 AND ops.section_key = $3) AS program_section_label`,
      [normalizedName, organizationId, normalizedProgramSection]
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
  router.put('/:id', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!name && !section) {
      return error(res, 'At least one field to update is required', 400);
    }

    const fields = [];
    const params = [];

    if (name) {
      params.push(name);
      fields.push(`name = $${params.length}`);
    }

    if (section) {
      params.push(section);
      fields.push(`section = $${params.length}`);
    }

    params.push(id, organizationId);

    const result = await pool.query(
      `UPDATE groups
       SET ${fields.join(', ')}
       WHERE id = $${params.length - 1} AND organization_id = $${params.length}
       RETURNING *`,
      params
    );
    const { name, program_section } = req.body;
    const organizationId = await getOrganizationId(req, pool);

    await ensureProgramSectionsSeeded(pool, organizationId);

    const updates = [];

    const normalizedName = name !== undefined ? String(name).trim() : undefined;
    const normalizedProgramSection = program_section !== undefined ? normalizeProgramSection(program_section) : undefined;

    if (normalizedName !== undefined) {
      if (!normalizedName) {
        return error(res, 'Group name is required', 400);
      }
      updates.push(`name = $${updates.length + 1}`);
      params.push(normalizedName);
    }

    if (normalizedProgramSection !== undefined) {
      const sectionValidation = await validateProgramSection(pool, organizationId, normalizedProgramSection);

      if (!sectionValidation.valid) {
        return error(res, sectionValidation.message, 400);
      }

      updates.push(`program_section = $${updates.length + 1}`);
      params.push(normalizedProgramSection);
    }

    if (updates.length === 0) {
      return error(res, 'At least one field to update is required', 400);
    }

    params.push(id, organizationId);

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE groups
         SET ${updates.join(', ')}
         WHERE id = $${updates.length + 1} AND organization_id = $${updates.length + 2}
         RETURNING *,
           (SELECT display_name FROM organization_program_sections ops
            WHERE ops.organization_id = $${updates.length + 2} AND ops.section_key = program_section) AS program_section_label`,
        params
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return error(res, 'Group not found', 404);
      }

      if (normalizedProgramSection !== undefined) {
        await client.query(
          `UPDATE participant_groups
           SET program_section = $1
           WHERE group_id = $2 AND organization_id = $3`,
          [normalizedProgramSection, id, organizationId]
        );
      }

      await client.query('COMMIT');

      return success(res, result.rows[0], 'Group updated successfully');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
  router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
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

  // ============================================
  // NON-V1 ENDPOINTS (Legacy API format)
  // ============================================

  /**
   * @swagger
   * /api/groups:
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
   *               - organization_id
   *             properties:
   *               name:
   *                 type: string
   *               organization_id:
   *                 type: integer
   *     responses:
   *       201:
   *         description: Group created successfully
   */
  router.post('/groups', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { name, organization_id, program_section } = req.body;
      const normalizedName = typeof name === 'string' ? name.trim() : '';
      const normalizedProgramSection = normalizeProgramSection(program_section) || 'general';

      if (!normalizedName || !organization_id) {
        return res.status(400).json({ success: false, message: 'Name and organization ID are required' });
      }

      await ensureProgramSectionsSeeded(pool, organization_id);
      const sectionValidation = await validateProgramSection(pool, organization_id, normalizedProgramSection);

      if (!sectionValidation.valid) {
        return res.status(400).json({ success: false, message: sectionValidation.message });
      }

      const result = await pool.query(
        `INSERT INTO groups (name, organization_id, created_at, program_section)
         VALUES ($1, $2, NOW(), $3)
         RETURNING *,
           (SELECT display_name FROM organization_program_sections ops
            WHERE ops.organization_id = $2 AND ops.section_key = $3) AS program_section_label`,
        [normalizedName, organization_id, normalizedProgramSection]
      );

      res.status(201).json({ success: true, message: 'Group created successfully', group: result.rows[0] });
    } catch (error) {
      logger.error('Error creating group:', error);
      res.status(500).json({ success: false, message: 'Error creating group' });
    }
  });

  /**
   * @swagger
   * /api/groups/{id}:
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
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *     responses:
   *       200:
   *         description: Group updated successfully
   *       404:
   *         description: Group not found
   */
  router.put('/groups/:id', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const groupId = parseInt(req.params.id, 10);
      const { name, program_section } = req.body;
      const normalizedName = name !== undefined ? String(name).trim() : undefined;
      const normalizedProgramSection = program_section !== undefined ? normalizeProgramSection(program_section) : undefined;

      if (!groupId) {
        return res.status(400).json({ success: false, message: 'Group ID is required' });
      }

      if (!name && !section) {
        return res.status(400).json({ success: false, message: 'At least one field to update is required' });
      }

    

      if (name) {
        params.push(name.trim());
        updates.push(`name = $${params.length}`);
      }

      if (section) {
        params.push(section);
        updates.push(`section = $${params.length}`);
      }

      params.push(groupId);

      const result = await pool.query(
        `UPDATE groups SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
        params
      );

      if (groupContext.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Group not found' });
      }

      const organizationId = groupContext.rows[0].organization_id;
      const updates = [];
      const params = [];

      if (normalizedName !== undefined) {
        if (!normalizedName) {
          return res.status(400).json({ success: false, message: 'Group name is required' });
        }
        updates.push(`name = $${updates.length + 1}`);
        params.push(normalizedName);
      }

      if (normalizedProgramSection !== undefined) {
        await ensureProgramSectionsSeeded(pool, organizationId);
        const sectionValidation = await validateProgramSection(pool, organizationId, normalizedProgramSection);

        if (!sectionValidation.valid) {
          return res.status(400).json({ success: false, message: sectionValidation.message });
        }

        updates.push(`program_section = $${updates.length + 1}`);
        params.push(normalizedProgramSection);
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one field to update is required' });
      }

      params.push(groupId, organizationId);

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `UPDATE groups
           SET ${updates.join(', ')}, updated_at = NOW()
           WHERE id = $${updates.length + 1} AND organization_id = $${updates.length + 2}
           RETURNING *,
             (SELECT display_name FROM organization_program_sections ops
              WHERE ops.organization_id = $${updates.length + 2} AND ops.section_key = program_section) AS program_section_label`,
          params
        );

        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Group not found' });
        }

        if (normalizedProgramSection !== undefined) {
          await client.query(
            `UPDATE participant_groups
             SET program_section = $1
             WHERE group_id = $2 AND organization_id = $3`,
            [normalizedProgramSection, groupId, organizationId]
          );
        }

        await client.query('COMMIT');

        res.json({ success: true, message: 'Group updated successfully', group: result.rows[0] });
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error updating group:', error);
        res.status(500).json({ success: false, message: 'Error updating group' });
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Error updating group:', error);
      res.status(500).json({ success: false, message: 'Error updating group' });
    }
  });

  /**
   * @swagger
   * /api/groups/{id}:
   *   delete:
   *     summary: Remove a group
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
   *         description: Group removed successfully
   */
  router.delete('/groups/:id', async (req, res) => {
    const client = await pool.connect();

    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.userId) {
        await client.release();
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const groupId = parseInt(req.params.id);

      if (!groupId) {
        return res.status(400).json({ success: false, message: 'Group ID is required' });
      }

      await client.query('BEGIN');

      // Update participants to remove group assignment
      await client.query(
        'UPDATE participants SET group_id = NULL WHERE group_id = $1',
        [groupId]
      );

      // Delete the group
      const result = await client.query(
        'DELETE FROM groups WHERE id = $1 RETURNING *',
        [groupId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Group not found' });
      }

      await client.query('COMMIT');

      res.json({ success: true, message: 'Group removed successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error removing group:', error);
      res.status(500).json({ success: false, message: 'Error removing group' });
    } finally {
      client.release();
    }
  });

  return router;
};
