// RESTful routes for attendance
const express = require('express');
const router = express.Router();
const { authenticate, authorize, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { getPointSystemRules } = require('../utils');

module.exports = (pool) => {
  /**
   * @swagger
   * /api/v1/attendance:
   *   get:
   *     summary: Get attendance records
   *     tags: [Attendance]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: date
   *         schema:
   *           type: string
   *           format: date
   *         description: Filter by date
   *       - in: query
   *         name: participant_id
   *         schema:
   *           type: integer
   *         description: Filter by participant
   *     responses:
   *       200:
   *         description: Attendance records
   */
  router.get('/', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { date, participant_id } = req.query;

    let query = `
      SELECT a.*, p.first_name, p.last_name, pg.group_id, g.name as group_name
      FROM attendance a
      JOIN participants p ON a.participant_id = p.id
      LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
      LEFT JOIN groups g ON pg.group_id = g.id
      WHERE a.organization_id = $1
    `;

    const params = [organizationId];

    if (date) {
      query += ` AND a.date = $${params.length + 1}`;
      params.push(date);
    }

    if (participant_id) {
      query += ` AND a.participant_id = $${params.length + 1}`;
      params.push(participant_id);
    }

    query += ` ORDER BY a.date DESC, p.first_name, p.last_name`;

    const result = await pool.query(query, params);

    return success(res, result.rows);
  }));

  /**
   * @swagger
   * /api/v1/attendance/dates:
   *   get:
   *     summary: Get all attendance dates
   *     tags: [Attendance]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of dates
   */
  router.get('/dates', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT DISTINCT date
       FROM attendance
       WHERE organization_id = $1
       ORDER BY date DESC`,
      [organizationId]
    );

    return success(res, result.rows.map(r => r.date));
  }));

  /**
   * @swagger
   * /api/v1/attendance:
   *   post:
   *     summary: Mark attendance
   *     tags: [Attendance]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - participant_id
   *               - date
   *               - status
   *             properties:
   *               participant_id:
   *                 type: integer
   *               date:
   *                 type: string
   *                 format: date
   *               status:
   *                 type: string
   *                 enum: [present, absent, late, excused]
   *     responses:
   *       201:
   *         description: Attendance marked
   */
  router.post('/', authenticate, authorize('admin', 'animation'), asyncHandler(async (req, res) => {
    const { participant_id, date, status, previous_status } = req.body;
    const organizationId = await getOrganizationId(req, pool);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert attendance
      const result = await client.query(
        `INSERT INTO attendance (participant_id, date, status, organization_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (participant_id, date, organization_id)
         DO UPDATE SET status = $3
         RETURNING *`,
        [participant_id, date, status, organizationId]
      );

      // Calculate point adjustment if status changed
      if (previous_status && previous_status !== status) {
        // Get point values from organization settings or use defaults
        const pointSystemRules = await getPointSystemRules(client, organizationId);
        const pointValues = pointSystemRules.attendance || { present: 1, late: 0.5, absent: 0, excused: 0 };

        const adjustment = (pointValues[status] || 0) - (pointValues[previous_status] || 0);

        if (adjustment !== 0) {
          await client.query(
            `INSERT INTO points (participant_id, value, created_at, organization_id)
             VALUES ($1, $2, NOW(), $3)`,
            [participant_id, adjustment, organizationId]
          );
        }
      }

      await client.query('COMMIT');

      return success(res, result.rows[0], 'Attendance marked successfully', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  return router;
};
