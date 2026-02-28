// RESTful routes for attendance
const express = require('express');
const router = express.Router();
const { authenticate, authorize, getOrganizationId, requirePermission, blockDemoRoles } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdBody, validateDate, validateAttendanceStatus, checkValidation, validateIdQuery, validateDateOptional } = require('../middleware/validation');
const { getPointSystemRules } = require('../utils');
const { verifyJWT, calculateAttendancePoints, getCurrentOrganizationId, handleOrganizationResolutionError } = require('../utils/api-helpers');

module.exports = (pool, logger) => {
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
  router.get('/',
    authenticate,
    requirePermission('attendance.view'),
    validateDateOptional('date'),
    validateIdQuery('participant_id'),
    checkValidation,
    asyncHandler(async (req, res) => {
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
        query += ` AND a.date::date = $${params.length + 1}::date`;
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
  router.get('/dates', authenticate, requirePermission('attendance.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT DISTINCT date::text as date
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
  router.post('/',
    authenticate,
    blockDemoRoles,
    requirePermission('attendance.manage'),
    validateIdBody('participant_id'),
    validateDate('date'),
    validateAttendanceStatus,
    checkValidation,
    asyncHandler(async (req, res) => {
      const { participant_id, date, status, previous_status } = req.body;
      const organizationId = await getOrganizationId(req, pool);

      logger.debug('[attendance POST] Request body:', JSON.stringify(req.body));
      logger.debug('[attendance POST] participant_id:', participant_id, 'type:', typeof participant_id);
      logger.debug('[attendance POST] date:', date, 'status:', status, 'organizationId:', organizationId);

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
          const defaultPoints = { present: 1, late: 0, absent: -1, excused: 0 };
          const pointValues = pointSystemRules.attendance || defaultPoints;

          // Ensure we have valid numbers, falling back to defaults
          const newPoints = typeof pointValues[status] === 'number' ? pointValues[status] : (defaultPoints[status] || 0);
          const oldPoints = typeof pointValues[previous_status] === 'number' ? pointValues[previous_status] : (defaultPoints[previous_status] || 0);
          const adjustment = Math.round(newPoints - oldPoints); // Round to ensure integer

          if (adjustment !== 0 && !isNaN(adjustment)) {
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

  /**
   * @swagger
   * /api/v1/attendance/carry-forward:
   *   post:
   *     summary: Carry forward attendance from one date to another
   *     description: Copies present/late attendance from source date to target date for participants who don't have attendance recorded on target date
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
   *               - fromDate
   *               - toDate
   *             properties:
   *               fromDate:
   *                 type: string
   *                 format: date
   *               toDate:
   *                 type: string
   *                 format: date
   *     responses:
   *       200:
   *         description: Attendance carried forward
   */
  router.post('/carry-forward',
    authenticate,
    blockDemoRoles,
    requirePermission('attendance.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { fromDate, toDate } = req.body;

      if (!fromDate || !toDate) {
        return error(res, 'fromDate and toDate are required', 400);
      }

      if (fromDate === toDate) {
        return error(res, 'fromDate and toDate must be different', 400);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get attendance from source date that is present or late
        // and doesn't already have attendance on target date
        const sourceAttendanceResult = await client.query(
          `SELECT a.participant_id, a.status
         FROM attendance a
         WHERE a.organization_id = $1
           AND a.date = $2::date
           AND a.status IN ('present', 'late')
           AND NOT EXISTS (
             SELECT 1 FROM attendance a2
             WHERE a2.participant_id = a.participant_id
               AND a2.organization_id = $1
               AND a2.date = $3::date
           )`,
          [organizationId, fromDate, toDate]
        );

        const toCarryForward = sourceAttendanceResult.rows;
        logger.info(`[attendance carry-forward] Carrying ${toCarryForward.length} attendance records from ${fromDate} to ${toDate}`);

        if (toCarryForward.length === 0) {
          await client.query('COMMIT');
          return success(res, {
            copiedCount: 0,
            message: 'No attendance records to carry forward'
          }, 'No records to carry forward');
        }

        // Batch insert the attendance records for target date
        const valuesClauses = toCarryForward.map((_, idx) =>
          `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`
        ).join(', ');

        const insertParams = toCarryForward.flatMap(row =>
          [row.participant_id, toDate, row.status, organizationId]
        );

        await client.query(
          `INSERT INTO attendance (participant_id, date, status, organization_id)
         VALUES ${valuesClauses}`,
          insertParams
        );

        await client.query('COMMIT');

        return success(res, {
          copiedCount: toCarryForward.length,
          fromDate,
          toDate,
          participants: toCarryForward.map(r => r.participant_id)
        }, `Carried forward ${toCarryForward.length} attendance records`);

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }));

  /**
   * @swagger
   * /api/v1/attendance:
   *   delete:
   *     summary: Delete all attendance records for a specific date
   *     tags: [Attendance]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: date
   *         required: true
   *         schema:
   *           type: string
   *           format: date
   */
  router.delete('/',
    authenticate,
    blockDemoRoles,
    requirePermission('attendance.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const date = req.query.date || req.body.date;

      if (!date) {
        return error(res, 'Date is required', 400);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const result = await client.query(
          `DELETE FROM attendance
         WHERE organization_id = $1 AND date = $2::date`,
          [organizationId, date]
        );

        await client.query('COMMIT');
        return success(res, { deleted: result.rowCount }, 'Attendance deleted successfully');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }));

  // ============================================
  // NON-VERSIONED ENDPOINTS (Legacy support)
  // ============================================

  /**
   * @swagger
   * /api/attendance:
   *   get:
   *     summary: Get attendance (non-versioned)
   *     tags: [Attendance]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: date
   *         schema:
   *           type: string
   *           format: date
   *         description: Filter by date (defaults to today)
   *     responses:
   *       200:
   *         description: Attendance data with participants
   */
  router.get('/attendance',
    authenticate,
    requirePermission('attendance.view'),
    validateDateOptional('date'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const requestedDate = req.query.date || new Date().toISOString().split('T')[0];

      // Get participants with attendance for the date
      const result = await pool.query(
        `SELECT p.id as participant_id, p.first_name, p.last_name,
              pg.group_id, g.name as group_name,
              a.status as attendance_status, a.date::text as date
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       LEFT JOIN attendance a ON p.id = a.participant_id AND a.date = $2 AND a.organization_id = $1
       WHERE po.organization_id = $1
       ORDER BY g.name, p.first_name`,
        [organizationId, requestedDate]
      );

      // Get all available dates
      const datesResult = await pool.query(
        `SELECT DISTINCT date::text as date FROM attendance WHERE organization_id = $1 ORDER BY date DESC`,
        [organizationId]
      );

      return success(res, {
        participants: result.rows,
        currentDate: requestedDate,
        availableDates: datesResult.rows.map(r => r.date)
      }, 'Attendance retrieved successfully');
    }));

  /**
   * @swagger
   * /api/attendance-dates:
   *   get:
   *     summary: Get all attendance dates (non-versioned)
   *     tags: [Attendance]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of dates
   */
  router.get('/attendance-dates', authenticate, requirePermission('attendance.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT DISTINCT date::text as date FROM attendance WHERE organization_id = $1 ORDER BY date DESC`,
      [organizationId]
    );

    const dates = result.rows.map(row => row.date);
    return success(res, dates);
  }));

  /**
   * @swagger
   * /api/update-attendance:
   *   post:
   *     summary: Update attendance (non-versioned)
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
   *               - status
   *               - date
   *             properties:
   *               participant_id:
   *                 oneOf:
   *                   - type: integer
   *                   - type: array
   *                     items:
   *                       type: integer
   *                 description: Single participant ID or array of IDs
   *               status:
   *                 type: string
   *                 enum: [present, absent, late, excused]
   *               date:
   *                 type: string
   *                 format: date
   *     responses:
   *       200:
   *         description: Attendance updated successfully
   */
  router.post('/update-attendance',
    authenticate,
    blockDemoRoles,
    requirePermission('attendance.manage'),
    validateAttendanceStatus,
    validateDate('date'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { participant_id, status, date } = req.body;

      // Handle both single participant_id and array of participant_ids
      const participantIds = Array.isArray(participant_id) ? participant_id : [participant_id];

      // Validate participant IDs
      if (participantIds.length === 0 || participantIds.some(id => !Number.isInteger(Number(id)) || Number(id) < 1)) {
        return res.status(400).json({ success: false, message: 'At least one valid participant ID (positive integer) is required' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get point system rules for this organization
        const pointRules = await getPointSystemRules(client, organizationId);
        const pointUpdates = [];

        // PERFORMANCE FIX: Use CTE to batch process all attendance updates in one query
        // This eliminates N+1 query problem (was 4 queries per participant)

        // First, get existing attendance statuses and group IDs for all participants
        const existingDataResult = await client.query(
          `SELECT
          p.id as participant_id,
          a.status as previous_status,
          pg.group_id
         FROM unnest($1::int[]) as p(id)
         LEFT JOIN attendance a ON a.participant_id = p.id
           AND a.organization_id = $2 AND a.date = $3
         LEFT JOIN participant_groups pg ON pg.participant_id = p.id
           AND pg.organization_id = $2`,
          [participantIds, organizationId, date]
        );

        // Build VALUES clause for batch upsert
        const attendanceValues = participantIds.map((_, idx) =>
          `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`
        ).join(', ');

        const attendanceParams = participantIds.flatMap(pid =>
          [pid, organizationId, date, status]
        );

        // Batch upsert all attendance records
        await client.query(
          `INSERT INTO attendance (participant_id, organization_id, date, status)
         VALUES ${attendanceValues}
         ON CONFLICT (participant_id, organization_id, date)
         DO UPDATE SET status = EXCLUDED.status`,
          attendanceParams
        );

        // Calculate point adjustments and prepare batch insert
        const pointsToInsert = [];
        for (const row of existingDataResult.rows) {
          const pointAdjustment = calculateAttendancePoints(row.previous_status, status, pointRules);

          if (pointAdjustment !== 0) {
            pointsToInsert.push({
              participant_id: row.participant_id,
              group_id: row.group_id,
              points: pointAdjustment,
              previous_status: row.previous_status
            });

            pointUpdates.push({
              participant_id: row.participant_id,
              previous_status: row.previous_status,
              new_status: status,
              points: pointAdjustment
            });

            logger.info(`[attendance] Participant ${row.participant_id}: ${row.previous_status || 'none'} -> ${status}, points: ${pointAdjustment > 0 ? '+' : ''}${pointAdjustment}`);
          }
        }

        // Batch insert all points if any adjustments needed
        if (pointsToInsert.length > 0) {
          const pointsValues = pointsToInsert.map((_, idx) =>
            `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5})`
          ).join(', ');

          const pointsParams = pointsToInsert.flatMap(p =>
            [p.participant_id, p.group_id, organizationId, p.points, date]
          );

          await client.query(
            `INSERT INTO points (participant_id, group_id, organization_id, value, created_at)
           VALUES ${pointsValues}`,
            pointsParams
          );
        }

        await client.query('COMMIT');
        return success(res, { pointUpdates }, 'Attendance updated successfully');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }));

  return router;
};
