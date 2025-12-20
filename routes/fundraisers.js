/**
 * Fundraiser Routes
 *
 * Handles fundraiser management, including creation, listing, archiving
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/fundraisers
 */

const express = require('express');
const router = express.Router();

// Import auth middleware
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/response');

// Import utilities
const { getCurrentOrganizationId, verifyJWT, verifyOrganizationMembership, handleOrganizationResolutionError } = require('../utils/api-helpers');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with fundraiser routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/fundraisers:
   *   get:
   *     summary: Get all fundraisers for organization
   *     description: Retrieve all fundraisers (active and archived) with totals
   *     tags: [Fundraisers]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: include_archived
   *         schema:
   *           type: boolean
   *         description: Include archived fundraisers
   *     responses:
   *       200:
   *         description: Fundraisers retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/fundraisers', authenticate, requirePermission('fundraisers.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const includeArchived = req.query.include_archived === 'true';

      let query = `
        SELECT
          f.id,
          f.name,
          f.start_date,
          f.end_date,
          f.objective,
          f.result,
          f.archived,
          f.created_at,
          COUNT(DISTINCT c.id) as participant_count,
          COALESCE(SUM(c.amount), 0) as total_amount,
          COALESCE(SUM(c.amount_paid), 0) as total_paid
        FROM fundraisers f
        LEFT JOIN fundraiser_entries c ON c.fundraiser = f.id
        WHERE f.organization = $1
      `;

      if (!includeArchived) {
        query += ` AND (f.archived IS NULL OR f.archived = false)`;
      }

      query += `
        GROUP BY f.id, f.name, f.start_date, f.end_date, f.objective, f.result, f.archived, f.created_at
        ORDER BY f.start_date DESC, f.created_at DESC
      `;

      const result = await pool.query(query, [organizationId]);

      res.json({
        success: true,
        fundraisers: result.rows
      });
  }));

  /**
   * @swagger
   * /api/fundraisers/{id}:
   *   get:
   *     summary: Get single fundraiser details
   *     description: Get detailed information about a specific fundraiser
   *     tags: [Fundraisers]
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
   *         description: Fundraiser retrieved successfully
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Fundraiser not found
   */
  router.get('/fundraisers/:id', authenticate, requirePermission('fundraisers.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { id } = req.params;

      const result = await pool.query(
        `SELECT f.*,
                COUNT(DISTINCT c.id) as participant_count,
                COALESCE(SUM(c.amount), 0) as total_amount,
                COALESCE(SUM(c.amount_paid), 0) as total_paid
         FROM fundraisers f
         LEFT JOIN fundraiser_entries c ON c.fundraiser = f.id
         WHERE f.id = $1 AND f.organization = $2
         GROUP BY f.id`,
        [id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Fundraiser not found' });
      }

      res.json({ success: true, fundraiser: result.rows[0] });
  }));

  /**
   * @swagger
   * /api/fundraisers:
   *   post:
   *     summary: Create a new fundraiser
   *     description: Create a new fundraiser and automatically add all active participants
   *     tags: [Fundraisers]
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
   *               - start_date
   *               - end_date
   *             properties:
   *               name:
   *                 type: string
   *               start_date:
   *                 type: string
   *                 format: date
   *               end_date:
   *                 type: string
   *                 format: date
   *               objective:
   *                 type: number
   *     responses:
   *       200:
   *         description: Fundraiser created successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.post('/fundraisers', authenticate, blockDemoRoles, requirePermission('fundraisers.create'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const { name, start_date, end_date, objective } = req.body;

      if (!name || !start_date || !end_date) {
        return res.status(400).json({ success: false, message: 'Name, start_date, and end_date are required' });
      }

      // Start a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create fundraiser
        const fundraiserResult = await client.query(
          `INSERT INTO fundraisers (name, start_date, end_date, objective, organization, archived)
           VALUES ($1, $2, $3, $4, $5, false)
           RETURNING *`,
          [name, start_date, end_date, objective || null, organizationId]
        );

        const fundraiser = fundraiserResult.rows[0];

        // Get all participants for this organization
        const participantsResult = await client.query(
          `SELECT DISTINCT p.id
           FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE po.organization_id = $1`,
          [organizationId]
        );

        // Create calendar entries for all participants
        if (participantsResult.rows.length > 0) {
          const values = participantsResult.rows.map((p, idx) => {
            const offset = idx * 5;
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
          }).join(',');

          const params = participantsResult.rows.flatMap(p => [
            p.id,              // participant_id
            fundraiser.id,     // fundraiser
            0,                 // amount (default to 0)
            false,             // paid (default to false)
            0                  // amount_paid (default to 0)
          ]);

          await client.query(
            `INSERT INTO fundraiser_entries (participant_id, fundraiser, amount, paid, amount_paid)
             VALUES ${values}
             ON CONFLICT DO NOTHING`,
            params
          );
        }

        await client.query('COMMIT');

        res.json({
          success: true,
          fundraiser,
          participants_added: participantsResult.rows.length
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
  }));

  /**
   * @swagger
   * /api/fundraisers/{id}:
   *   put:
   *     summary: Update a fundraiser
   *     description: Update fundraiser details (admin/animation only)
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
   *               name:
   *                 type: string
   *               start_date:
   *                 type: string
   *                 format: date
   *               end_date:
   *                 type: string
   *                 format: date
   *               objective:
   *                 type: number
   *               result:
   *                 type: number
   *     responses:
   *       200:
   *         description: Fundraiser updated successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   *       404:
   *         description: Fundraiser not found
   */
  router.put('/fundraisers/:id', authenticate, blockDemoRoles, requirePermission('fundraisers.edit'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const { id } = req.params;
      const { name, start_date, end_date, objective, result } = req.body;

      const updateResult = await pool.query(
        `UPDATE fundraisers
         SET name = COALESCE($1, name),
             start_date = COALESCE($2, start_date),
             end_date = COALESCE($3, end_date),
             objective = COALESCE($4, objective),
             result = COALESCE($5, result)
         WHERE id = $6 AND organization = $7
         RETURNING *`,
        [name, start_date, end_date, objective, result, id, organizationId]
      );

      if (updateResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Fundraiser not found' });
      }

      res.json({ success: true, fundraiser: updateResult.rows[0] });
  }));

  /**
   * @swagger
   * /api/fundraisers/{id}/archive:
   *   put:
   *     summary: Archive/unarchive a fundraiser
   *     description: Toggle archive status of a fundraiser (admin/animation only)
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
   *             required:
   *               - archived
   *             properties:
   *               archived:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Fundraiser archive status updated
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   *       404:
   *         description: Fundraiser not found
   */
  router.put('/fundraisers/:id/archive', authenticate, blockDemoRoles, requirePermission('fundraisers.edit'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const { id } = req.params;
      const { archived } = req.body;

      if (archived === undefined) {
        return res.status(400).json({ success: false, message: 'Archived status is required' });
      }

      const result = await pool.query(
        `UPDATE fundraisers
         SET archived = $1
         WHERE id = $2 AND organization = $3
         RETURNING *`,
        [archived, id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Fundraiser not found' });
      }

      res.json({ success: true, fundraiser: result.rows[0] });
  }));

  return router;
};
