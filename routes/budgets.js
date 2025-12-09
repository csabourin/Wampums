const express = require('express');
const router = express.Router();
const { authenticate, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { verifyOrganizationMembership } = require('../utils/api-helpers');

function toNumeric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function validateMoney(value, fieldName) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { valid: false, message: `${fieldName} must be a non-negative number` };
  }
  return { valid: true, value: Math.round(numeric * 100) / 100 };
}

function validateDate(value, fieldName) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { valid: false, message: `${fieldName} must be a valid date` };
  }
  return { valid: true };
}

module.exports = (pool, logger) => {
  // ===== BUDGET CATEGORIES =====

  /**
   * GET /v1/budget/categories
   * Get all budget categories for the organization
   */
  router.get('/v1/budget/categories', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT
        bc.id,
        bc.organization_id,
        bc.name,
        bc.description,
        bc.category_type,
        bc.display_order,
        bc.active,
        bc.created_at,
        COUNT(bi.id) as item_count
      FROM budget_categories bc
      LEFT JOIN budget_items bi ON bc.id = bi.budget_category_id AND bi.active = true
      WHERE bc.organization_id = $1 AND bc.active = true
      GROUP BY bc.id
      ORDER BY bc.display_order, bc.name`,
      [organizationId]
    );

    return success(res, result.rows, 'Budget categories loaded');
  }));

  /**
   * POST /v1/budget/categories
   * Create a new budget category (admin only)
   */
  router.post('/v1/budget/categories', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { name, description, category_type, display_order } = req.body;

    if (!name || name.trim().length === 0) {
      return error(res, 'Category name is required', 400);
    }

    const result = await pool.query(
      `INSERT INTO budget_categories
        (organization_id, name, description, category_type, display_order)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [organizationId, name.trim(), description, category_type || 'other', display_order || 0]
    );

    logger.info(`Budget category created: ${name} for organization ${organizationId}`);
    return success(res, result.rows[0], 'Budget category created successfully', 201);
  }));

  /**
   * PUT /v1/budget/categories/:id
   * Update a budget category (admin only)
   */
  router.put('/v1/budget/categories/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;
    const { name, description, category_type, display_order, active } = req.body;

    const result = await pool.query(
      `UPDATE budget_categories
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          category_type = COALESCE($3, category_type),
          display_order = COALESCE($4, display_order),
          active = COALESCE($5, active),
          updated_at = NOW()
      WHERE id = $6 AND organization_id = $7
      RETURNING *`,
      [name, description, category_type, display_order, active, id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Budget category not found', 404);
    }

    logger.info(`Budget category updated: ${id} for organization ${organizationId}`);
    return success(res, result.rows[0], 'Budget category updated successfully');
  }));

  /**
   * DELETE /v1/budget/categories/:id
   * Soft delete a budget category (admin only)
   */
  router.delete('/v1/budget/categories/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;

    const result = await pool.query(
      `UPDATE budget_categories
      SET active = false, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2
      RETURNING *`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Budget category not found', 404);
    }

    logger.info(`Budget category deleted: ${id} for organization ${organizationId}`);
    return success(res, result.rows[0], 'Budget category deleted successfully');
  }));

  // ===== BUDGET ITEMS =====

  /**
   * GET /v1/budget/items
   * Get all budget items, optionally filtered by category
   */
  router.get('/v1/budget/items', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { category_id } = req.query;

    let query = `
      SELECT
        bi.*,
        bc.name as category_name,
        bc.category_type
      FROM budget_items bi
      JOIN budget_categories bc ON bi.budget_category_id = bc.id
      WHERE bi.organization_id = $1 AND bi.active = true
    `;
    const params = [organizationId];

    if (category_id) {
      query += ` AND bi.budget_category_id = $2`;
      params.push(category_id);
    }

    query += ` ORDER BY bi.display_order, bi.name`;

    const result = await pool.query(query, params);
    return success(res, result.rows, 'Budget items loaded');
  }));

  /**
   * POST /v1/budget/items
   * Create a new budget item (admin/animation)
   */
  router.post('/v1/budget/items', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin', 'animation']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const {
      budget_category_id,
      name,
      description,
      item_type,
      unit_price,
      estimated_quantity,
      display_order
    } = req.body;

    if (!budget_category_id || !name) {
      return error(res, 'Category ID and name are required', 400);
    }

    // Validate unit_price if provided
    if (unit_price !== undefined && unit_price !== null) {
      const validation = validateMoney(unit_price, 'unit_price');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    const result = await pool.query(
      `INSERT INTO budget_items
        (organization_id, budget_category_id, name, description, item_type,
         unit_price, estimated_quantity, display_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        organizationId,
        budget_category_id,
        name.trim(),
        description,
        item_type || 'other',
        unit_price,
        estimated_quantity,
        display_order || 0
      ]
    );

    logger.info(`Budget item created: ${name} for organization ${organizationId}`);
    return success(res, result.rows[0], 'Budget item created successfully', 201);
  }));

  /**
   * PUT /v1/budget/items/:id
   * Update a budget item (admin/animation)
   */
  router.put('/v1/budget/items/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin', 'animation']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;
    const {
      name,
      description,
      item_type,
      unit_price,
      estimated_quantity,
      display_order,
      active
    } = req.body;

    // Validate unit_price if provided
    if (unit_price !== undefined && unit_price !== null) {
      const validation = validateMoney(unit_price, 'unit_price');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    const result = await pool.query(
      `UPDATE budget_items
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          item_type = COALESCE($3, item_type),
          unit_price = COALESCE($4, unit_price),
          estimated_quantity = COALESCE($5, estimated_quantity),
          display_order = COALESCE($6, display_order),
          active = COALESCE($7, active),
          updated_at = NOW()
      WHERE id = $8 AND organization_id = $9
      RETURNING *`,
      [name, description, item_type, unit_price, estimated_quantity, display_order, active, id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Budget item not found', 404);
    }

    logger.info(`Budget item updated: ${id} for organization ${organizationId}`);
    return success(res, result.rows[0], 'Budget item updated successfully');
  }));

  /**
   * DELETE /v1/budget/items/:id
   * Soft delete a budget item (admin/animation)
   */
  router.delete('/v1/budget/items/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin', 'animation']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;

    const result = await pool.query(
      `UPDATE budget_items
      SET active = false, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2
      RETURNING *`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Budget item not found', 404);
    }

    logger.info(`Budget item deleted: ${id} for organization ${organizationId}`);
    return success(res, result.rows[0], 'Budget item deleted successfully');
  }));

  // ===== BUDGET EXPENSES =====

  /**
   * GET /v1/budget/expenses
   * Get expenses with optional filters
   */
  router.get('/v1/budget/expenses', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { start_date, end_date, category_id, item_id } = req.query;

    let query = `
      SELECT
        be.*,
        bc.name as category_name,
        bi.name as item_name,
        u.full_name as created_by_name
      FROM budget_expenses be
      LEFT JOIN budget_categories bc ON be.budget_category_id = bc.id
      LEFT JOIN budget_items bi ON be.budget_item_id = bi.id
      LEFT JOIN users u ON be.created_by = u.id
      WHERE be.organization_id = $1
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

    if (category_id) {
      paramCount++;
      query += ` AND be.budget_category_id = $${paramCount}`;
      params.push(category_id);
    }

    if (item_id) {
      paramCount++;
      query += ` AND be.budget_item_id = $${paramCount}`;
      params.push(item_id);
    }

    query += ` ORDER BY be.expense_date DESC, be.created_at DESC`;

    const result = await pool.query(query, params);

    // Convert numeric fields
    const expenses = result.rows.map(row => ({
      ...row,
      amount: toNumeric(row.amount)
    }));

    return success(res, expenses, 'Expenses loaded');
  }));

  /**
   * POST /v1/budget/expenses
   * Record a new expense (admin/animation)
   */
  router.post('/v1/budget/expenses', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin', 'animation']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const {
      budget_category_id,
      budget_item_id,
      amount,
      expense_date,
      description,
      payment_method,
      reference_number,
      receipt_url,
      notes
    } = req.body;

    // Validation
    const amountValidation = validateMoney(amount, 'amount');
    const dateValidation = validateDate(expense_date, 'expense_date');

    if (!amountValidation.valid || !dateValidation.valid) {
      return error(res, amountValidation.message || dateValidation.message, 400);
    }

    if (!description || description.trim().length === 0) {
      return error(res, 'Description is required', 400);
    }

    const result = await pool.query(
      `INSERT INTO budget_expenses
        (organization_id, budget_category_id, budget_item_id, amount, expense_date,
         description, payment_method, reference_number, receipt_url, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        organizationId,
        budget_category_id,
        budget_item_id,
        amountValidation.value,
        expense_date,
        description.trim(),
        payment_method,
        reference_number,
        receipt_url,
        notes,
        req.user.id
      ]
    );

    logger.info(`Expense recorded: ${amountValidation.value} for organization ${organizationId}`);

    const expense = {
      ...result.rows[0],
      amount: toNumeric(result.rows[0].amount)
    };

    return success(res, expense, 'Expense recorded successfully', 201);
  }));

  /**
   * PUT /v1/budget/expenses/:id
   * Update an expense (admin/animation)
   */
  router.put('/v1/budget/expenses/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin', 'animation']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;
    const {
      budget_category_id,
      budget_item_id,
      amount,
      expense_date,
      description,
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
    if (expense_date) {
      const validation = validateDate(expense_date, 'expense_date');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    const result = await pool.query(
      `UPDATE budget_expenses
      SET budget_category_id = COALESCE($1, budget_category_id),
          budget_item_id = COALESCE($2, budget_item_id),
          amount = COALESCE($3, amount),
          expense_date = COALESCE($4, expense_date),
          description = COALESCE($5, description),
          payment_method = COALESCE($6, payment_method),
          reference_number = COALESCE($7, reference_number),
          receipt_url = COALESCE($8, receipt_url),
          notes = COALESCE($9, notes),
          updated_at = NOW()
      WHERE id = $10 AND organization_id = $11
      RETURNING *`,
      [
        budget_category_id,
        budget_item_id,
        amount,
        expense_date,
        description,
        payment_method,
        reference_number,
        receipt_url,
        notes,
        id,
        organizationId
      ]
    );

    if (result.rows.length === 0) {
      return error(res, 'Expense not found', 404);
    }

    logger.info(`Expense updated: ${id} for organization ${organizationId}`);

    const expense = {
      ...result.rows[0],
      amount: toNumeric(result.rows[0].amount)
    };

    return success(res, expense, 'Expense updated successfully');
  }));

  /**
   * DELETE /v1/budget/expenses/:id
   * Delete an expense (admin only)
   */
  router.delete('/v1/budget/expenses/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM budget_expenses
      WHERE id = $1 AND organization_id = $2
      RETURNING *`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Expense not found', 404);
    }

    logger.info(`Expense deleted: ${id} for organization ${organizationId}`);
    return success(res, result.rows[0], 'Expense deleted successfully');
  }));

  // ===== BUDGET REPORTS =====

  /**
   * GET /v1/budget/reports/summary
   * Get comprehensive budget summary combining all revenue sources and expenses
   */
  router.get('/v1/budget/reports/summary', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { fiscal_year_start, fiscal_year_end } = req.query;

    // Get summary by category using the view
    let query = `
      SELECT
        organization_id,
        budget_category_id,
        category_name,
        total_revenue,
        total_expense,
        net_amount
      FROM v_budget_summary_by_category
      WHERE organization_id = $1
    `;
    const params = [organizationId];

    // Note: The view doesn't filter by date, so we need to calculate with date filters if provided
    let summaryResult;
    if (fiscal_year_start && fiscal_year_end) {
      // Get revenue by category with date filter
      const revenueResult = await pool.query(
        `SELECT
          budget_category_id,
          category_name,
          SUM(amount) as total_revenue
        FROM v_budget_revenue
        WHERE organization_id = $1
          AND revenue_date BETWEEN $2 AND $3
        GROUP BY budget_category_id, category_name`,
        [organizationId, fiscal_year_start, fiscal_year_end]
      );

      // Get expenses by category with date filter
      const expenseResult = await pool.query(
        `SELECT
          be.budget_category_id,
          bc.name as category_name,
          SUM(be.amount) as total_expense
        FROM budget_expenses be
        LEFT JOIN budget_categories bc ON be.budget_category_id = bc.id
        WHERE be.organization_id = $1
          AND be.expense_date BETWEEN $2 AND $3
        GROUP BY be.budget_category_id, bc.name`,
        [organizationId, fiscal_year_start, fiscal_year_end]
      );

      // Combine results
      const categoryMap = new Map();

      revenueResult.rows.forEach(row => {
        const catId = row.budget_category_id || 0;
        categoryMap.set(catId, {
          budget_category_id: catId,
          category_name: row.category_name || 'Uncategorized',
          total_revenue: toNumeric(row.total_revenue),
          total_expense: 0,
          net_amount: toNumeric(row.total_revenue)
        });
      });

      expenseResult.rows.forEach(row => {
        const catId = row.budget_category_id || 0;
        if (categoryMap.has(catId)) {
          const cat = categoryMap.get(catId);
          cat.total_expense = toNumeric(row.total_expense);
          cat.net_amount = cat.total_revenue - cat.total_expense;
        } else {
          categoryMap.set(catId, {
            budget_category_id: catId,
            category_name: row.category_name || 'Uncategorized',
            total_revenue: 0,
            total_expense: toNumeric(row.total_expense),
            net_amount: -toNumeric(row.total_expense)
          });
        }
      });

      summaryResult = { rows: Array.from(categoryMap.values()) };
    } else {
      summaryResult = await pool.query(query, params);
    }

    // Convert numeric fields and calculate totals
    const categories = summaryResult.rows.map(row => ({
      budget_category_id: row.budget_category_id,
      category_name: row.category_name,
      total_revenue: toNumeric(row.total_revenue),
      total_expense: toNumeric(row.total_expense),
      net_amount: toNumeric(row.net_amount)
    }));

    const totals = categories.reduce(
      (acc, cat) => ({
        total_revenue: acc.total_revenue + cat.total_revenue,
        total_expense: acc.total_expense + cat.total_expense,
        net_amount: acc.net_amount + cat.net_amount
      }),
      { total_revenue: 0, total_expense: 0, net_amount: 0 }
    );

    return success(res, {
      categories,
      totals,
      fiscal_year: {
        start: fiscal_year_start,
        end: fiscal_year_end
      }
    }, 'Budget summary loaded');
  }));

  /**
   * GET /v1/budget/reports/revenue-breakdown
   * Get detailed revenue breakdown by source
   */
  router.get('/v1/budget/reports/revenue-breakdown', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { fiscal_year_start, fiscal_year_end, category_id } = req.query;

    let query = `
      SELECT
        revenue_source,
        budget_category_id,
        category_name,
        COUNT(*) as transaction_count,
        SUM(amount) as total_amount
      FROM v_budget_revenue
      WHERE organization_id = $1
    `;
    const params = [organizationId];
    let paramCount = 1;

    if (fiscal_year_start && fiscal_year_end) {
      paramCount++;
      query += ` AND revenue_date BETWEEN $${paramCount} AND $${paramCount + 1}`;
      params.push(fiscal_year_start, fiscal_year_end);
      paramCount++;
    }

    if (category_id) {
      paramCount++;
      query += ` AND budget_category_id = $${paramCount}`;
      params.push(category_id);
    }

    query += ` GROUP BY revenue_source, budget_category_id, category_name
               ORDER BY total_amount DESC`;

    const result = await pool.query(query, params);

    const breakdown = result.rows.map(row => ({
      ...row,
      total_amount: toNumeric(row.total_amount)
    }));

    return success(res, breakdown, 'Revenue breakdown loaded');
  }));

  // ===== BUDGET PLANS =====

  /**
   * GET /v1/budget/plans
   * Get budget plans with optional fiscal year filter
   */
  router.get('/v1/budget/plans', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { fiscal_year_start, fiscal_year_end } = req.query;

    let query = `
      SELECT
        bp.*,
        bi.name as item_name,
        bc.name as category_name
      FROM budget_plans bp
      LEFT JOIN budget_items bi ON bp.budget_item_id = bi.id
      LEFT JOIN budget_categories bc ON bi.budget_category_id = bc.id
      WHERE bp.organization_id = $1
    `;
    const params = [organizationId];
    let paramCount = 1;

    if (fiscal_year_start && fiscal_year_end) {
      paramCount++;
      query += ` AND bp.fiscal_year_start = $${paramCount}`;
      params.push(fiscal_year_start);
      
      paramCount++;
      query += ` AND bp.fiscal_year_end = $${paramCount}`;
      params.push(fiscal_year_end);
    }

    query += ` ORDER BY bp.fiscal_year_start DESC, bi.name`;

    const result = await pool.query(query, params);

    const plans = result.rows.map(row => ({
      ...row,
      budgeted_revenue: toNumeric(row.budgeted_revenue),
      budgeted_expense: toNumeric(row.budgeted_expense)
    }));

    return success(res, plans, 'Budget plans loaded');
  }));

  /**
   * POST /v1/budget/plans
   * Create a new budget plan (admin/animation)
   */
  router.post('/v1/budget/plans', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin', 'animation']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const {
      budget_item_id,
      fiscal_year_start,
      fiscal_year_end,
      budgeted_revenue,
      budgeted_expense,
      notes
    } = req.body;

    // Validation
    if (!fiscal_year_start || !fiscal_year_end) {
      return error(res, 'Fiscal year start and end dates are required', 400);
    }

    const startValidation = validateDate(fiscal_year_start, 'fiscal_year_start');
    const endValidation = validateDate(fiscal_year_end, 'fiscal_year_end');

    if (!startValidation.valid || !endValidation.valid) {
      return error(res, startValidation.message || endValidation.message, 400);
    }

    // Validate monetary values if provided
    if (budgeted_revenue !== undefined && budgeted_revenue !== null) {
      const validation = validateMoney(budgeted_revenue, 'budgeted_revenue');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    if (budgeted_expense !== undefined && budgeted_expense !== null) {
      const validation = validateMoney(budgeted_expense, 'budgeted_expense');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    const result = await pool.query(
      `INSERT INTO budget_plans
        (organization_id, budget_item_id, fiscal_year_start, fiscal_year_end,
         budgeted_revenue, budgeted_expense, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        organizationId,
        budget_item_id,
        fiscal_year_start,
        fiscal_year_end,
        budgeted_revenue || 0,
        budgeted_expense || 0,
        notes
      ]
    );

    logger.info(`Budget plan created for organization ${organizationId}`);

    const plan = {
      ...result.rows[0],
      budgeted_revenue: toNumeric(result.rows[0].budgeted_revenue),
      budgeted_expense: toNumeric(result.rows[0].budgeted_expense)
    };

    return success(res, plan, 'Budget plan created successfully', 201);
  }));

  /**
   * PUT /v1/budget/plans/:id
   * Update an existing budget plan (admin/animation)
   */
  router.put('/v1/budget/plans/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin', 'animation']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;
    const {
      budget_item_id,
      fiscal_year_start,
      fiscal_year_end,
      budgeted_revenue,
      budgeted_expense,
      notes
    } = req.body;

    // Validate dates if provided
    if (fiscal_year_start) {
      const validation = validateDate(fiscal_year_start, 'fiscal_year_start');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    if (fiscal_year_end) {
      const validation = validateDate(fiscal_year_end, 'fiscal_year_end');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    // Validate monetary values if provided
    if (budgeted_revenue !== undefined && budgeted_revenue !== null) {
      const validation = validateMoney(budgeted_revenue, 'budgeted_revenue');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    if (budgeted_expense !== undefined && budgeted_expense !== null) {
      const validation = validateMoney(budgeted_expense, 'budgeted_expense');
      if (!validation.valid) {
        return error(res, validation.message, 400);
      }
    }

    const result = await pool.query(
      `UPDATE budget_plans
      SET budget_item_id = COALESCE($1, budget_item_id),
          fiscal_year_start = COALESCE($2, fiscal_year_start),
          fiscal_year_end = COALESCE($3, fiscal_year_end),
          budgeted_revenue = COALESCE($4, budgeted_revenue),
          budgeted_expense = COALESCE($5, budgeted_expense),
          notes = COALESCE($6, notes),
          updated_at = NOW()
      WHERE id = $7 AND organization_id = $8
      RETURNING *`,
      [
        budget_item_id,
        fiscal_year_start,
        fiscal_year_end,
        budgeted_revenue,
        budgeted_expense,
        notes,
        id,
        organizationId
      ]
    );

    if (result.rows.length === 0) {
      return error(res, 'Budget plan not found', 404);
    }

    logger.info(`Budget plan updated: ${id} for organization ${organizationId}`);

    const plan = {
      ...result.rows[0],
      budgeted_revenue: toNumeric(result.rows[0].budgeted_revenue),
      budgeted_expense: toNumeric(result.rows[0].budgeted_expense)
    };

    return success(res, plan, 'Budget plan updated successfully');
  }));

  /**
   * DELETE /v1/budget/plans/:id
   * Delete a budget plan (admin only)
   */
  router.delete('/v1/budget/plans/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, ['admin']);

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM budget_plans
      WHERE id = $1 AND organization_id = $2
      RETURNING *`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Budget plan not found', 404);
    }

    logger.info(`Budget plan deleted: ${id} for organization ${organizationId}`);
    return success(res, result.rows[0], 'Budget plan deleted successfully');
  }));

  return router;
};
