/**
 * Fundraiser Entry Routes
 *
 * Handles fundraiser entries, payment tracking, and participant management
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/fundraiser-entries
 */

const express = require('express');
const router = express.Router();

const {
  authenticate,
  blockDemoRoles,
  requirePermission,
  getOrganizationId,
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with fundraiser entry routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/v1/calendars:
   *   get:
   *     summary: List fundraiser entries
   *     description: Get all entries for a specific fundraiser
   *     tags: [Fundraisers]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: fundraiser_id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: List of fundraiser entries
   *       400:
   *         description: Missing fundraiser_id
   *       401:
   *         description: Unauthorized
   */
  router.get(
    '/',
    authenticate,
    requirePermission('finance.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const fundraiserId = req.query.fundraiser_id;

      if (!fundraiserId) {
        return error(res, 'fundraiser_id is required', 400);
      }

      const fundraiserCheck = await pool.query(
        `SELECT id FROM fundraisers WHERE id = $1 AND organization = $2`,
        [fundraiserId, organizationId]
      );

      if (fundraiserCheck.rows.length === 0) {
        return error(res, 'Access denied to this fundraiser', 403);
      }

      const result = await pool.query(
        `SELECT c.id, c.participant_id, c.amount as calendar_amount, c.amount_paid, c.paid, c.updated_at, c.fundraiser,
                p.first_name, p.last_name, g.name as group_name, pg.group_id
         FROM fundraiser_entries c
         JOIN participants p ON c.participant_id = p.id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE c.fundraiser = $2
         ORDER BY p.first_name, p.last_name`,
        [organizationId, fundraiserId]
      );

      return success(res, { fundraiser_entries: result.rows });
    })
  );

  /**
   * @swagger
   * /api/v1/calendars/{id}:
   *   put:
   *     summary: Update fundraiser entry
   *     description: Update amount, amount_paid, or paid status of a fundraiser entry
   *     tags: [Fundraisers]
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
   *               amount:
   *                 type: number
   *               amount_paid:
   *                 type: number
   *               paid:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Entry updated
   *       404:
   *         description: Entry not found
   */
  router.put(
    '/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('finance.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { id } = req.params;
      const { amount, amount_paid, paid } = req.body;

      const verifyResult = await pool.query(
        `SELECT c.* FROM fundraiser_entries c
         JOIN fundraisers f ON c.fundraiser = f.id
         WHERE c.id = $1 AND f.organization = $2`,
        [id, organizationId]
      );

      if (verifyResult.rows.length === 0) {
        return error(res, 'Fundraiser entry not found', 404);
      }

      const result = await pool.query(
        `UPDATE fundraiser_entries
         SET amount = COALESCE($1, amount),
             amount_paid = COALESCE($2, amount_paid),
             paid = COALESCE($3, paid),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING *`,
        [amount, amount_paid, paid, id]
      );

      return success(res, result.rows[0], 'Fundraiser entry updated');
    })
  );

  /**
   * @swagger
   * /api/v1/calendars/{id}/payment:
   *   put:
   *     summary: Update fundraiser entry payment
   *     description: Update the payment amount for a fundraiser entry and auto-calculate paid status
   *     tags: [Fundraisers]
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
   *             required: [amount_paid]
   *             properties:
   *               amount_paid:
   *                 type: number
   *     responses:
   *       200:
   *         description: Payment updated
   *       404:
   *         description: Entry not found
   */
  router.put(
    '/:id/payment',
    authenticate,
    blockDemoRoles,
    requirePermission('finance.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { id } = req.params;
      const { amount_paid } = req.body;

      if (amount_paid === undefined) {
        return error(res, 'Amount paid is required', 400);
      }

      const currentResult = await pool.query(
        `SELECT c.amount FROM fundraiser_entries c
         JOIN fundraisers f ON c.fundraiser = f.id
         WHERE c.id = $1 AND f.organization = $2`,
        [id, organizationId]
      );

      if (currentResult.rows.length === 0) {
        return error(res, 'Fundraiser entry not found', 404);
      }

      const amountDue = parseFloat(currentResult.rows[0].amount) || 0;
      const paid = parseFloat(amount_paid) >= amountDue;

      const result = await pool.query(
        `UPDATE fundraiser_entries
         SET amount_paid = $1,
             paid = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [amount_paid, paid, id]
      );

      return success(res, result.rows[0], 'Payment updated');
    })
  );

  /**
   * @swagger
   * /api/participant-calendar:
   *   get:
   *     summary: Get fundraiser entries for a specific participant
   *     description: Retrieve all fundraiser entries for a participant
   *     tags: [Fundraiser Entries]
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
   *         description: Participant fundraiser entries retrieved successfully
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   */
  router.get(
    '/participant',
    authenticate,
    requirePermission('finance.view'),
    asyncHandler(async (req, res) => {
      const { participant_id } = req.query;

      if (!participant_id) {
        return error(res, 'Participant ID is required', 400);
      }

      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT c.*, p.first_name, p.last_name, f.name as fundraiser_name
       FROM fundraiser_entries c
       JOIN participants p ON c.participant_id = p.id
       JOIN fundraisers f ON c.fundraiser = f.id
       WHERE c.participant_id = $1 AND f.organization = $2
       ORDER BY f.start_date DESC`,
        [participant_id, organizationId]
      );

      return success(res, result.rows);
    })
  );

  return router;
};
