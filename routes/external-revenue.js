const express = require('express');
const router = express.Router();
const { authenticate, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { verifyOrganizationMembership } = require('../utils/api-helpers');
const {
  toNumeric,
  validateMoney,
  validateDate,
  cleanExternalRevenueNotes,
  extractRevenueType,
  formatExternalRevenueNotes
} = require('../utils/validation-helpers');

module.exports = (pool, logger) => {
  /**
   * GET /api/v1/revenue/external
   * List external revenue entries (donations, sponsorships, grants, other)
   */
  router.get('/v1/revenue/external', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
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
        be.id,
        be.organization_id,
        be.budget_category_id,
        bc.name as category_name,
        be.amount,
        be.expense_date as revenue_date,
        be.description,
        be.payment_method,
        be.reference_number,
        be.receipt_url,
        be.notes,
        be.created_by,
        u.full_name as created_by_name,
        be.created_at,
        be.updated_at
      FROM budget_expenses be
      LEFT JOIN budget_categories bc ON be.budget_category_id = bc.id
      LEFT JOIN users u ON be.created_by = u.id
      WHERE be.organization_id = $1
        AND be.notes LIKE '%[EXTERNAL_REVENUE]%'
    `;
    const params = [organizationId];
    let paramCount = 1;

    if (start_date) {
      paramCount++;
      query += ` AND be.expense_date >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      query += ` AND be.expense_date <= $${paramCount}`;
      params.push(end_date);
    }

    if (hasCategoryFilter) {
      paramCount++;
      query += ` AND be.budget_category_id = $${paramCount}`;
      params.push(parsedCategoryId);
    }

    if (revenue_type && revenue_type !== 'all') {
      paramCount++;
      query += ` AND be.notes LIKE $${paramCount}`;
      params.push(`%[TYPE:${revenue_type}]%`);
    }

    query += ` ORDER BY be.expense_date DESC, be.created_at DESC`;

    const result = await pool.query(query, params);

    // Parse revenue type from notes
    const revenues = result.rows.map(row => ({
      ...row,
      revenue_type: extractRevenueType(row.notes),
      notes: cleanExternalRevenueNotes(row.notes),
      amount: toNumeric(row.amount)
    }));

    return success(res, revenues, 'External revenue entries loaded');
  }));

  /**
   * POST /api/v1/revenue/external
   * Create a new external revenue entry
   */
  router.post('/v1/revenue/external', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin', 'animation']);

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

    // Store as negative amount in budget_expenses to represent revenue
    // Mark as external revenue with special notes tag
    const markedNotes = formatExternalRevenueNotes(revenue_type, notes);

    const result = await pool.query(
      `INSERT INTO budget_expenses
        (organization_id, budget_category_id, budget_item_id, amount, expense_date,
         description, payment_method, reference_number, receipt_url, notes, created_by)
      VALUES ($1, $2, NULL, -$3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        organizationId,
        budget_category_id,
        amountValidation.value,
        revenue_date,
        description.trim(),
        payment_method,
        reference_number,
        receipt_url,
        markedNotes,
        req.user.id
      ]
    );

    logger.info(`External revenue recorded: ${amountValidation.value} (${revenue_type}) for organization ${organizationId}`);

    const revenue = {
      ...result.rows[0],
      amount: Math.abs(toNumeric(result.rows[0].amount)),
      revenue_type: revenue_type,
      notes: notes || ''
    };

    return success(res, revenue, 'External revenue recorded successfully', 201);
  }));

  /**
   * PUT /api/v1/revenue/external/:id
   * Update an external revenue entry
   */
  router.put('/v1/revenue/external/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin', 'animation']);

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

    // Verify this is an external revenue entry
    const checkResult = await pool.query(
      `SELECT id, notes FROM budget_expenses 
       WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );

    if (checkResult.rows.length === 0) {
      return error(res, 'External revenue entry not found', 404);
    }

    if (!checkResult.rows[0].notes?.includes('[EXTERNAL_REVENUE]')) {
      return error(res, 'Not an external revenue entry', 400);
    }

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

    // Build update notes
    let updateNotes = checkResult.rows[0].notes;
    if (notes !== undefined || revenue_type !== undefined) {
      const currentType = extractRevenueType(updateNotes);
      const newType = revenue_type || currentType;
      updateNotes = formatExternalRevenueNotes(newType, notes || '');
    }

    const result = await pool.query(
      `UPDATE budget_expenses
      SET budget_category_id = COALESCE($1, budget_category_id),
          amount = COALESCE(-$2, amount),
          expense_date = COALESCE($3, expense_date),
          description = COALESCE($4, description),
          payment_method = COALESCE($5, payment_method),
          reference_number = COALESCE($6, reference_number),
          receipt_url = COALESCE($7, receipt_url),
          notes = COALESCE($8, notes),
          updated_at = NOW()
      WHERE id = $9 AND organization_id = $10
      RETURNING *`,
      [
        budget_category_id,
        amount,
        revenue_date,
        description,
        payment_method,
        reference_number,
        receipt_url,
        updateNotes,
        id,
        organizationId
      ]
    );

    logger.info(`External revenue updated: ${id} for organization ${organizationId}`);

    const revenue = {
      ...result.rows[0],
      amount: Math.abs(toNumeric(result.rows[0].amount)),
      revenue_type: extractRevenueType(result.rows[0].notes),
      notes: cleanExternalRevenueNotes(result.rows[0].notes)
    };

    return success(res, revenue, 'External revenue updated successfully');
  }));

  /**
   * DELETE /api/v1/revenue/external/:id
   * Delete an external revenue entry
   */
  router.delete('/v1/revenue/external/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;

    // Verify this is an external revenue entry
    const checkResult = await pool.query(
      `SELECT id, notes FROM budget_expenses 
       WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );

    if (checkResult.rows.length === 0) {
      return error(res, 'External revenue entry not found', 404);
    }

    if (!checkResult.rows[0].notes?.includes('[EXTERNAL_REVENUE]')) {
      return error(res, 'Not an external revenue entry', 400);
    }

    const result = await pool.query(
      `DELETE FROM budget_expenses
      WHERE id = $1 AND organization_id = $2
      RETURNING *`,
      [id, organizationId]
    );

    logger.info(`External revenue deleted: ${id} for organization ${organizationId}`);
    return success(res, result.rows[0], 'External revenue deleted successfully');
  }));

  /**
   * GET /api/v1/revenue/external/summary
   * Get summary of external revenue by category and type
   */
  router.get('/v1/revenue/external/summary', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { start_date, end_date } = req.query;

    let query = `
      SELECT
        be.budget_category_id,
        bc.name as category_name,
        be.notes,
        COUNT(*) as entry_count,
        ABS(SUM(be.amount)) as total_amount
      FROM budget_expenses be
      LEFT JOIN budget_categories bc ON be.budget_category_id = bc.id
      WHERE be.organization_id = $1
        AND be.notes LIKE '%[EXTERNAL_REVENUE]%'
    `;
    const params = [organizationId];
    let paramCount = 1;

    if (start_date) {
      paramCount++;
      query += ` AND be.expense_date >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      query += ` AND be.expense_date <= $${paramCount}`;
      params.push(end_date);
    }

    query += ` GROUP BY be.budget_category_id, bc.name, be.notes
               ORDER BY total_amount DESC`;

    const result = await pool.query(query, params);

    // Aggregate by type and category
    const byType = {};
    const byCategory = {};
    let totalAmount = 0;
    let totalCount = 0;

    result.rows.forEach(row => {
      const revenueType = extractRevenueType(row.notes);
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
