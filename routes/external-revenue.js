const express = require('express');
const router = express.Router();
const { authenticate, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { verifyOrganizationMembership } = require('../utils/api-helpers');
const {
  toNumeric,
  validateMoney,
  validateDate
} = require('../utils/validation-helpers');

module.exports = (pool, logger) => {
  /**
   * GET /api/v1/revenue/external
   * List external revenue entries (donations, sponsorships, grants, other)
   * Permission: finance.view
   */
  router.get('/v1/revenue/external', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const permissionCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: ['finance.view'],
    });

    if (!permissionCheck.authorized) {
      return error(res, permissionCheck.message, 403);
    }
    const { start_date, end_date, revenue_type, category_id } = req.query;

    const hasCategoryFilter = category_id && category_id !== 'all';
    let parsedCategoryId = null;

    if (hasCategoryFilter) {
      parsedCategoryId = Number.parseInt(category_id, 10);

      if (!Number.isInteger(parsedCategoryId)) {
        return error(res, 'category_id must be a valid integer or "all"', 400);
      }
    }

    let query = `
      SELECT
        br.id,
        br.organization_id,
        br.budget_category_id,
        bc.name as category_name,
        br.amount,
        br.revenue_date,
        br.description,
        br.payment_method,
        br.reference_number,
        br.receipt_url,
        br.notes,
        br.revenue_type,
        br.created_by,
        u.full_name as created_by_name,
        br.created_at,
        br.updated_at
      FROM budget_revenues br
      LEFT JOIN budget_categories bc ON br.budget_category_id = bc.id
      LEFT JOIN users u ON br.created_by = u.id
      WHERE br.organization_id = $1
    `;
    const params = [organizationId];
    let paramCount = 1;

    if (start_date) {
      paramCount++;
      query += ` AND br.revenue_date >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      query += ` AND br.revenue_date <= $${paramCount}`;
      params.push(end_date);
    }

    if (hasCategoryFilter) {
      paramCount++;
      query += ` AND br.budget_category_id = $${paramCount}`;
      params.push(parsedCategoryId);
    }

    if (revenue_type && revenue_type !== 'all') {
      paramCount++;
      query += ` AND br.revenue_type = $${paramCount}`;
      params.push(revenue_type);
    }

    query += ` ORDER BY br.revenue_date DESC, br.created_at DESC`;

    const result = await pool.query(query, params);

    const revenues = result.rows.map(row => ({
      ...row,
      amount: toNumeric(row.amount)
    }));

    return success(res, revenues, 'External revenue entries loaded');
  }));

  /**
   * POST /api/v1/revenue/external
   * Create a new external revenue entry
   * Permission: finance.manage
   */
  router.post('/v1/revenue/external', authenticate, asyncHandler(async (req, res) => {
    try {
      logger.info('[external-revenue] POST request received:', { body: req.body, user: req.user?.id });

      const organizationId = await getOrganizationId(req, pool);
      const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
        requiredPermissions: ['finance.manage'],
      });

      if (!authCheck.authorized) {
        return error(res, authCheck.message, 403);
      }

      const {
        budget_category_id,
        amount,
        revenue_date,
        description,
        revenue_type = 'other',
        payment_method,
        reference_number,
        receipt_url,
        notes
      } = req.body;

      // Validation
      const amountValidation = validateMoney(amount, 'amount');
      const dateValidation = validateDate(revenue_date, 'revenue_date');

      if (!amountValidation.valid || !dateValidation.valid) {
        return error(res, amountValidation.message || dateValidation.message, 400);
      }

      if (!description || description.trim().length === 0) {
        return error(res, 'Description is required', 400);
      }

      // Validate and normalize budget_category_id
      // Accept null, undefined, or empty string as "no category"
      // If a value is provided, it must be a valid integer
      let normalizedCategoryId = null;
      if (budget_category_id !== null && budget_category_id !== undefined && budget_category_id !== '') {
        const categoryId = Number.parseInt(budget_category_id, 10);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
          return error(res, 'budget_category_id must be a valid positive integer or null', 400);
        }
        normalizedCategoryId = categoryId;
      }

      const result = await pool.query(
        `INSERT INTO budget_revenues
          (organization_id, budget_category_id, budget_item_id, amount, revenue_date,
           description, payment_method, reference_number, receipt_url, notes, created_by, revenue_type)
        VALUES ($1, $2, NULL, $3::numeric, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          organizationId,
          normalizedCategoryId,
          amountValidation.value,
          revenue_date,
          description.trim(),
          payment_method,
          reference_number,
          receipt_url,
          notes,
          req.user.id,
          revenue_type
        ]
      );

      logger.info(`External revenue recorded: ${amountValidation.value} (${revenue_type}) for organization ${organizationId}`);

      const revenue = {
        ...result.rows[0],
        amount: toNumeric(result.rows[0].amount),
        revenue_type
      };

      return success(res, revenue, 'External revenue recorded successfully', 201);
    } catch (err) {
      logger.error('[external-revenue] POST error:', {
        error: err.message,
        stack: err.stack,
        code: err.code,
        detail: err.detail,
        body: req.body
      });
      return error(res, `Database error: ${err.message}`, 500);
    }
  }));

  /**
   * PUT /api/v1/revenue/external/:id
   * Update an external revenue entry
   * Permission: finance.manage
   */
  router.put('/v1/revenue/external/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: ['finance.manage'],
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;
    const {
      budget_category_id,
      amount,
      revenue_date,
      description,
      revenue_type,
      payment_method,
      reference_number,
      receipt_url,
      notes
    } = req.body;

    // Validate amount if provided
    if (amount !== undefined && amount !== null) {
      const validation = validateMoney(amount, 'amount');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    // Validate date if provided
    if (revenue_date) {
      const validation = validateDate(revenue_date, 'revenue_date');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    // Validate and normalize budget_category_id if provided
    let normalizedCategoryId = budget_category_id;
    if (budget_category_id !== undefined && budget_category_id !== null && budget_category_id !== '') {
      const categoryId = Number.parseInt(budget_category_id, 10);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return error(res, 'budget_category_id must be a valid positive integer or null', 400);
      }
      normalizedCategoryId = categoryId;
    } else if (budget_category_id === '') {
      // Normalize empty string to null
      normalizedCategoryId = null;
    }

    const result = await pool.query(
      `UPDATE budget_revenues
      SET budget_category_id = COALESCE($1, budget_category_id),
          amount = COALESCE($2::numeric, amount),
          revenue_date = COALESCE($3, revenue_date),
          description = COALESCE($4, description),
          payment_method = COALESCE($5, payment_method),
          reference_number = COALESCE($6, reference_number),
          receipt_url = COALESCE($7, receipt_url),
          notes = COALESCE($8, notes),
          revenue_type = COALESCE($9, revenue_type),
          updated_at = NOW()
      WHERE id = $10 AND organization_id = $11
      RETURNING *`,
      [
        normalizedCategoryId,
        amount,
        revenue_date,
        description,
        payment_method,
        reference_number,
        receipt_url,
        notes,
        revenue_type,
        id,
        organizationId
      ]
    );

    logger.info(`External revenue updated: ${id} for organization ${organizationId}`);

    const revenue = {
      ...result.rows[0],
      amount: toNumeric(result.rows[0].amount)
    };

    return success(res, revenue, 'External revenue updated successfully');
  }));

  /**
   * DELETE /api/v1/revenue/external/:id
   * Delete an external revenue entry
   * Permission: finance.manage
   */
  router.delete('/v1/revenue/external/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: ['finance.manage'],
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM budget_revenues
      WHERE id = $1 AND organization_id = $2
      RETURNING *`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'External revenue entry not found', 404);
    }

    logger.info(`External revenue deleted: ${id} for organization ${organizationId}`);
    return success(res, result.rows[0], 'External revenue deleted successfully');
  }));

  /**
   * GET /api/v1/revenue/external/summary
   * Get summary of external revenue by category and type
   * Permission: finance.view
   */
  router.get('/v1/revenue/external/summary', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const permissionCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: ['finance.view'],
    });

    if (!permissionCheck.authorized) {
      return error(res, permissionCheck.message, 403);
    }
    const { start_date, end_date } = req.query;

    let query = `
      SELECT
        br.budget_category_id,
        bc.name as category_name,
        br.revenue_type,
        COUNT(*) as entry_count,
        SUM(br.amount) as total_amount
      FROM budget_revenues br
      LEFT JOIN budget_categories bc ON br.budget_category_id = bc.id
      WHERE br.organization_id = $1
    `;
    const params = [organizationId];
    let paramCount = 1;

    if (start_date) {
      paramCount++;
      query += ` AND br.revenue_date >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      query += ` AND br.revenue_date <= $${paramCount}`;
      params.push(end_date);
    }

    query += ` GROUP BY br.budget_category_id, bc.name, br.revenue_type
               ORDER BY total_amount DESC`;

    const result = await pool.query(query, params);

    // Aggregate by type and category
    const byType = {};
    const byCategory = {};
    let totalAmount = 0;
    let totalCount = 0;

    result.rows.forEach(row => {
      const revenueType = row.revenue_type || 'other';
      const amount = toNumeric(row.total_amount);
      const count = parseInt(row.entry_count || 0);

      totalAmount += amount;
      totalCount += count;

      // Aggregate by type
      if (!byType[revenueType]) {
        byType[revenueType] = { revenue_type: revenueType, total_amount: 0, entry_count: 0 };
      }
      byType[revenueType].total_amount += amount;
      byType[revenueType].entry_count += count;

      // Aggregate by category
      const categoryName = row.category_name || 'Uncategorized';
      const categoryId = row.budget_category_id || 0;
      const key = `${categoryId}-${categoryName}`;
      
      if (!byCategory[key]) {
        byCategory[key] = {
          budget_category_id: categoryId,
          category_name: categoryName,
          total_amount: 0,
          entry_count: 0
        };
      }
      byCategory[key].total_amount += amount;
      byCategory[key].entry_count += count;
    });

    return success(res, {
      totals: {
        total_amount: totalAmount,
        entry_count: totalCount
      },
      by_type: Object.values(byType),
      by_category: Object.values(byCategory)
    }, 'External revenue summary loaded');
  }));

  return router;
};
