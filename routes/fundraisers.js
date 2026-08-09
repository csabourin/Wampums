/**
 * Fundraiser Routes
 *
 * Handles fundraiser management, including creation, listing, archiving
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/fundraisers
 */

const express = require('express');

// Import auth middleware
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { asyncHandler, success, error } = require('../middleware/response');
const {
  CAMPAIGN_TYPE_KEYS,
  DEFAULT_CAMPAIGN_TYPE,
  campaignModelColumnsSql,
  entryAmountSql,
  entryHoursSql,
  entryQuantitySql,
  hasCampaignModelColumns,
  isValidCampaignType,
  toNullableNumber,
} = require('../services/fundraiserCampaigns');

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME_LENGTH = 255;

/**
 * Normalise a date-like request value to an ISO `YYYY-MM-DD` string.
 * Accepts the `YYYY-MM-DDTHH:mm:ss...` shape a Date-serialising client sends.
 *
 * @param {*} value - Raw request value
 * @returns {string|null} ISO date string, or null when unusable
 */
function toIsoDate(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const [datePart] = value.trim().split('T');
  if (!ISO_DATE_PATTERN.test(datePart)) {
    return null;
  }
  // Reject calendar-invalid dates such as 2026-02-31.
  const parsed = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== datePart) {
    return null;
  }
  return datePart;
}

/**
 * Validate and normalise a campaign payload.
 *
 * Returns the field-level problems rather than a single opaque message so the
 * client can tell the user which input is wrong.
 *
 * @param {Object} body - Request body
 * @param {Object} [options] - Validation options
 * @param {boolean} [options.partial=false] - Treat missing fields as "unchanged"
 * @returns {{errors: Array<{field: string, message: string}>, values: Object}}
 */
function validateCampaignPayload(body, { partial = false } = {}) {
  const errors = [];
  const values = {};
  const provided = (field) => Object.prototype.hasOwnProperty.call(body, field);

  if (provided('name') || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      errors.push({ field: 'name', message: 'Name is required' });
    } else if (name.length > MAX_NAME_LENGTH) {
      errors.push({ field: 'name', message: `Name must be at most ${MAX_NAME_LENGTH} characters` });
    } else {
      values.name = name;
    }
  }

  ['start_date', 'end_date'].forEach((field) => {
    if (!provided(field) && partial) {
      return;
    }
    const isoDate = toIsoDate(body[field]);
    if (!isoDate) {
      errors.push({ field, message: `${field} is required and must be a valid YYYY-MM-DD date` });
      return;
    }
    values[field] = isoDate;
  });

  if (values.start_date && values.end_date && values.end_date < values.start_date) {
    errors.push({ field: 'end_date', message: 'end_date must be on or after start_date' });
  }

  ['objective', 'result', 'unit_price'].forEach((field) => {
    if (!provided(field)) {
      return;
    }
    if (body[field] === null || body[field] === '') {
      values[field] = null;
      return;
    }
    const parsed = toNullableNumber(body[field]);
    if (parsed === null || parsed < 0) {
      errors.push({ field, message: `${field} must be a number greater than or equal to 0` });
      return;
    }
    values[field] = parsed;
  });

  if (provided('campaign_type')) {
    const campaignType = typeof body.campaign_type === 'string' ? body.campaign_type.trim() : '';
    if (!isValidCampaignType(campaignType)) {
      errors.push({
        field: 'campaign_type',
        message: `campaign_type must be one of: ${CAMPAIGN_TYPE_KEYS.join(', ')}`,
      });
    } else {
      values.campaign_type = campaignType;
    }
  } else if (!partial) {
    values.campaign_type = DEFAULT_CAMPAIGN_TYPE;
  }

  if (provided('unit_label')) {
    const unitLabel = typeof body.unit_label === 'string' ? body.unit_label.trim() : '';
    values.unit_label = unitLabel || null;
  }

  return { errors, values };
}

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with fundraiser routes
 */
module.exports = (pool, logger) => {
  const router = express.Router();
  /**
   * @swagger
   * /api/v1/fundraisers:
   *   get:
   *     summary: List all fundraisers
   *     description: Get all fundraisers for the current organization
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
   *         description: List of fundraisers
   *       401:
   *         description: Unauthorized
   */
  router.get('/', authenticate, requirePermission('fundraisers.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const includeArchived = req.query.include_archived === 'true';
      const extended = await hasCampaignModelColumns(pool);

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
          ${campaignModelColumnsSql('f', extended)},
          COUNT(DISTINCT c.id) as participant_count,
          COALESCE(SUM(${entryAmountSql('c', 'f', extended)}), 0) as total_amount,
          COALESCE(SUM(${entryQuantitySql('c', extended)}), 0) as total_quantity,
          COALESCE(SUM(${entryHoursSql('c', extended)}), 0) as total_hours,
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
                 ${extended ? ', f.campaign_type, f.unit_price, f.unit_label' : ''}
        ORDER BY f.start_date DESC, f.created_at DESC
      `;

      const result = await pool.query(query, [organizationId]);

      return success(res, { fundraisers: result.rows });
  }));

  /**
   * @swagger
   * /api/v1/fundraisers/{id}:
   *   get:
   *     summary: Get fundraiser by ID
   *     description: Get a single fundraiser with stats
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
   *         description: Fundraiser details
   *       404:
   *         description: Fundraiser not found
   */
  router.get('/:id', authenticate, requirePermission('fundraisers.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { id } = req.params;
      const extended = await hasCampaignModelColumns(pool);

      const result = await pool.query(
        `SELECT f.*,
                ${extended ? '' : `'${DEFAULT_CAMPAIGN_TYPE}'::text AS campaign_type,
                NULL::numeric AS unit_price,
                NULL::text AS unit_label,`}
                COUNT(DISTINCT c.id) as participant_count,
                COALESCE(SUM(${entryAmountSql('c', 'f', extended)}), 0) as total_amount,
                COALESCE(SUM(${entryQuantitySql('c', extended)}), 0) as total_quantity,
                COALESCE(SUM(${entryHoursSql('c', extended)}), 0) as total_hours,
                COALESCE(SUM(c.amount_paid), 0) as total_paid
         FROM fundraisers f
         LEFT JOIN fundraiser_entries c ON c.fundraiser = f.id
         WHERE f.id = $1 AND f.organization = $2
         GROUP BY f.id`,
        [id, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Fundraiser not found', 404);
      }

      return success(res, { fundraiser: result.rows[0] });
  }));

  /**
   * @swagger
   * /api/v1/fundraisers:
   *   post:
   *     summary: Create a new fundraiser
   *     description: Create a fundraiser and auto-generate entries for all org participants
   *     tags: [Fundraisers]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, start_date, end_date]
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
   *       201:
   *         description: Fundraiser created
   *       400:
   *         description: Missing required fields
   */
  router.post('/', authenticate, blockDemoRoles, requirePermission('fundraisers.create'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return error(res, 'Invalid request body. Expected JSON object payload.', 400);
      }

      const { errors: validationErrors, values } = validateCampaignPayload(req.body);

      if (validationErrors.length > 0) {
        return error(res, 'Invalid campaign data', 400, validationErrors);
      }

      const extended = await hasCampaignModelColumns(pool);

      if (!extended && values.campaign_type !== DEFAULT_CAMPAIGN_TYPE) {
        // The campaign is still created and usable, but its type cannot be
        // stored yet. Make that visible to operators instead of silently
        // downgrading it.
        logger?.warn?.(
          `Campaign type "${values.campaign_type}" stored as "${DEFAULT_CAMPAIGN_TYPE}": ` +
          'migration 001_initial.sql has not been applied to this database.'
        );
      }

      // Start a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create fundraiser. The generalised columns are only written when
        // they exist, so campaign creation keeps working on a database where
        // migration 004 has not been applied yet.
        const fundraiserResult = extended
          ? await client.query(
            `INSERT INTO fundraisers
               (name, start_date, end_date, objective, organization, archived, campaign_type, unit_price, unit_label)
             VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8)
             RETURNING *`,
            [
              values.name,
              values.start_date,
              values.end_date,
              values.objective ?? null,
              organizationId,
              values.campaign_type,
              values.unit_price ?? null,
              values.unit_label ?? null,
            ]
          )
          : await client.query(
            `INSERT INTO fundraisers
               (name, start_date, end_date, objective, organization, archived)
             VALUES ($1, $2, $3, $4, $5, false)
             RETURNING *`,
            [
              values.name,
              values.start_date,
              values.end_date,
              values.objective ?? null,
              organizationId,
            ]
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

        return success(
          res,
          {
            fundraiser: extended ? fundraiser : {
              ...fundraiser,
              campaign_type: DEFAULT_CAMPAIGN_TYPE,
              unit_price: null,
              unit_label: null,
            },
            participants_added: participantsResult.rows.length,
          },
          'Fundraiser created',
          201
        );
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
  }));

  /**
   * @swagger
   * /api/v1/fundraisers/{id}:
   *   put:
   *     summary: Update a fundraiser
   *     description: Update fundraiser details
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
   *         description: Fundraiser updated
   *       404:
   *         description: Fundraiser not found
   */
  router.put('/:id', authenticate, blockDemoRoles, requirePermission('fundraisers.edit'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const { id } = req.params;

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return error(res, 'Invalid request body. Expected JSON object payload.', 400);
      }

      const { errors: validationErrors, values } = validateCampaignPayload(req.body, { partial: true });

      if (validationErrors.length > 0) {
        return error(res, 'Invalid campaign data', 400, validationErrors);
      }

      const extended = await hasCampaignModelColumns(pool);

      // A partial update needs both start and end dates to compare them, so
      // re-check the ordering against the stored row when only one was sent.
      if ((values.start_date && !values.end_date) || (values.end_date && !values.start_date)) {
        const currentResult = await pool.query(
          'SELECT start_date, end_date FROM fundraisers WHERE id = $1 AND organization = $2',
          [id, organizationId]
        );
        if (currentResult.rows.length > 0) {
          const current = currentResult.rows[0];
          const toIso = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10));
          const startDate = values.start_date || toIso(current.start_date);
          const endDate = values.end_date || toIso(current.end_date);
          if (startDate && endDate && endDate < startDate) {
            return error(res, 'Invalid campaign data', 400, [
              { field: 'end_date', message: 'end_date must be on or after start_date' },
            ]);
          }
        }
      }

      const updateResult = extended
        ? await pool.query(
          `UPDATE fundraisers
           SET name = COALESCE($1, name),
               start_date = COALESCE($2, start_date),
               end_date = COALESCE($3, end_date),
               objective = COALESCE($4, objective),
               result = COALESCE($5, result),
               campaign_type = COALESCE($6, campaign_type),
               unit_price = COALESCE($7, unit_price),
               unit_label = COALESCE($8, unit_label)
           WHERE id = $9 AND organization = $10
           RETURNING *`,
          [
            values.name ?? null,
            values.start_date ?? null,
            values.end_date ?? null,
            values.objective ?? null,
            values.result ?? null,
            values.campaign_type ?? null,
            values.unit_price ?? null,
            values.unit_label ?? null,
            id,
            organizationId,
          ]
        )
        : await pool.query(
          `UPDATE fundraisers
           SET name = COALESCE($1, name),
               start_date = COALESCE($2, start_date),
               end_date = COALESCE($3, end_date),
               objective = COALESCE($4, objective),
               result = COALESCE($5, result)
           WHERE id = $6 AND organization = $7
           RETURNING *`,
          [
            values.name ?? null,
            values.start_date ?? null,
            values.end_date ?? null,
            values.objective ?? null,
            values.result ?? null,
            id,
            organizationId,
          ]
        );

      if (updateResult.rows.length === 0) {
        return error(res, 'Fundraiser not found', 404);
      }

      return success(res, { fundraiser: updateResult.rows[0] }, 'Fundraiser updated');
  }));

  /**
   * @swagger
   * /api/v1/fundraisers/{id}/archive:
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
  router.put('/:id/archive', authenticate, blockDemoRoles, requirePermission('fundraisers.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { id } = req.params;
    const { archived } = req.body;

    if (archived === undefined) {
      return error(res, 'Archived status is required', 400);
    }

    const result = await pool.query(
      `UPDATE fundraisers
         SET archived = $1
         WHERE id = $2 AND organization = $3
         RETURNING *`,
      [archived, id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Fundraiser not found', 404);
    }

    return success(res, { fundraiser: result.rows[0] }, 'Fundraiser archive status updated');
  }));

  /**
   * @swagger
   * /api/v1/fundraisers/{id}:
   *   delete:
   *     summary: Delete an empty campaign
   *     description: >
   *       Permanently delete a campaign that has no recorded results. A campaign
   *       whose entries carry any quantity, hours, amount raised or payment is
   *       refused with 409 so results cannot be destroyed by accident; archive
   *       it instead.
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
   *       204:
   *         description: Campaign deleted (no content)
   *       404:
   *         description: Campaign not found
   *       409:
   *         description: Campaign has recorded results
   */
  router.delete('/:id', authenticate, blockDemoRoles, requirePermission('fundraisers.delete'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { id } = req.params;
    const extended = await hasCampaignModelColumns(pool);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const campaignResult = await client.query(
        'SELECT id, name FROM fundraisers WHERE id = $1 AND organization = $2 FOR UPDATE',
        [id, organizationId]
      );

      if (campaignResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return error(res, 'Fundraiser not found', 404);
      }

      // Entries are created for every participant when the campaign is created,
      // so "has entries" is not the test — "has anything recorded" is.
      const recordedResult = await client.query(
        `SELECT COUNT(*)::int AS recorded
           FROM fundraiser_entries c
          WHERE c.fundraiser = $1
            AND (
              COALESCE(c.amount, 0) <> 0
              OR COALESCE(c.amount_paid, 0) <> 0
              OR c.paid = true
              ${extended ? `OR COALESCE(c.quantity, 0) <> 0
              OR COALESCE(c.hours, 0) <> 0
              OR COALESCE(c.amount_raised, 0) <> 0` : ''}
            )`,
        [id]
      );

      const recorded = recordedResult.rows[0]?.recorded || 0;
      if (recorded > 0) {
        await client.query('ROLLBACK');
        return error(
          res,
          'This campaign has recorded results and cannot be deleted. Archive it instead.',
          409
        );
      }

      await client.query('DELETE FROM fundraiser_entries WHERE fundraiser = $1', [id]);
      await client.query('DELETE FROM fundraisers WHERE id = $1 AND organization = $2', [id, organizationId]);

      await client.query('COMMIT');

      logger?.info?.(`Fundraiser deleted: ${id} for organization ${organizationId}`);
      // 204 No Content is the contract for a successful DELETE; the SPA
      // response handler already maps it to { success: true, data: null }.
      return res.status(204).end();
    } catch (deleteError) {
      await client.query('ROLLBACK');
      throw deleteError;
    } finally {
      client.release();
    }
  }));

  return router;
};
