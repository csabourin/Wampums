/**
 * Calendar Routes
 *
 * Handles calendar entries, payment tracking, and scheduling
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/calendars
 */

const express = require('express');
const router = express.Router();

// Import utilities
const { getCurrentOrganizationId, verifyJWT, verifyOrganizationMembership } = require('../utils/api-helpers');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with calendar routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/calendars:
   *   get:
   *     summary: Get all calendar entries
   *     description: Retrieve calendar entries with participant and payment information
   *     tags: [Calendars]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Calendar entries retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/calendars', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT c.participant_id, c.amount, c.amount_paid, c.paid, c.updated_at,
                p.first_name, p.last_name, g.name as group_name
         FROM calendars c
         JOIN participants p ON c.participant_id = p.id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE c.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );

      res.json({
        success: true,
        calendars: result.rows
      });
    } catch (error) {
      logger.error('Error fetching calendars:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/calendars/{id}:
   *   put:
   *     summary: Update calendar entry
   *     description: Update calendar entry details (admin/animation only)
   *     tags: [Calendars]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               participant_id:
   *                 type: integer
   *               date:
   *                 type: string
   *                 format: date
   *               amount_due:
   *                 type: number
   *               amount_paid:
   *                 type: number
   *               paid:
   *                 type: boolean
   *               notes:
   *                 type: string
   *     responses:
   *       200:
   *         description: Calendar updated successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   *       404:
   *         description: Calendar entry not found
   */
  router.put('/calendars/:id', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const { id } = req.params;
      const { participant_id, date, amount_due, amount_paid, paid, notes } = req.body;

      const result = await pool.query(
        `UPDATE calendars
         SET participant_id = COALESCE($1, participant_id),
             date = COALESCE($2, date),
             amount_due = COALESCE($3, amount_due),
             amount_paid = COALESCE($4, amount_paid),
             paid = COALESCE($5, paid),
             notes = COALESCE($6, notes),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $7 AND organization_id = $8
         RETURNING *`,
        [participant_id, date, amount_due, amount_paid, paid, notes, id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Calendar entry not found' });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      logger.error('Error updating calendar:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/calendars/{id}/payment:
   *   put:
   *     summary: Update payment amount for a calendar entry
   *     description: Update payment information for calendar (admin/animation only)
   *     tags: [Calendars]
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
   *             required:
   *               - amount_paid
   *             properties:
   *               amount_paid:
   *                 type: number
   *     responses:
   *       200:
   *         description: Payment updated successfully
   *       400:
   *         description: Amount paid is required
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   *       404:
   *         description: Calendar entry not found
   */
  router.put('/calendars/:id/payment', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const { id } = req.params;
      const { amount_paid } = req.body;

      if (amount_paid === undefined) {
        return res.status(400).json({ success: false, message: 'Amount paid is required' });
      }

      // Get current amount due to determine if fully paid
      const currentResult = await pool.query(
        `SELECT amount_due FROM calendars WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]
      );

      if (currentResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Calendar entry not found' });
      }

      const amountDue = parseFloat(currentResult.rows[0].amount_due);
      const paid = parseFloat(amount_paid) >= amountDue;

      const result = await pool.query(
        `UPDATE calendars
         SET amount_paid = $1,
             paid = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND organization_id = $4
         RETURNING *`,
        [amount_paid, paid, id, organizationId]
      );

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      logger.error('Error updating calendar payment:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/participant-calendar:
   *   get:
   *     summary: Get calendar entries for a specific participant
   *     description: Retrieve all calendar entries for a participant
   *     tags: [Calendars]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Participant calendar entries retrieved successfully
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   */
  router.get('/participant-calendar', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { participant_id } = req.query;

      if (!participant_id) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT c.*, p.first_name, p.last_name
         FROM calendars c
         JOIN participants p ON c.participant_id = p.id
         WHERE c.participant_id = $1 AND c.organization_id = $2
         ORDER BY c.date DESC`,
        [participant_id, organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching participant calendar:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
