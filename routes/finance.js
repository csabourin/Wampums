const express = require('express');
const router = express.Router();
const { authenticate, getOrganizationId, requirePermission, blockDemoRoles, hasAnyRole } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { ROLE_GROUPS } = require('../config/role-constants');

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

function validatePositiveInteger(value, fieldName) {
  const numeric = Number.parseInt(value, 10);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return { valid: false, message: `${fieldName} must be a positive integer` };
  }

  return { valid: true, value: numeric };
}

function formatFeeRow(row) {
  const totalAmount = toNumeric(row.total_amount);
  const totalPaid = toNumeric(row.total_paid);
  const outstanding = totalAmount - totalPaid;

  return {
    ...row,
    total_amount: totalAmount,
    total_paid: totalPaid,
    outstanding
  };
}

module.exports = (pool, logger) => {
  router.get('/v1/finance/fee-definitions', authenticate, requirePermission('finance.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT id, organization_id, registration_fee, membership_fee, year_start, year_end, created_at
       FROM fee_definitions
       WHERE organization_id = $1
       ORDER BY year_start DESC, created_at DESC`,
      [organizationId]
    );

    return success(res, result.rows, 'Fee definitions loaded');
  }));

  router.post('/v1/finance/fee-definitions', authenticate, blockDemoRoles, requirePermission('finance.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { registration_fee, membership_fee, year_start, year_end } = req.body;

    const regValidation = validateMoney(registration_fee, 'registration_fee');
    const membershipValidation = validateMoney(membership_fee, 'membership_fee');
    const yearStartValidation = validateDate(year_start, 'year_start');
    const yearEndValidation = validateDate(year_end, 'year_end');

    if (!regValidation.valid || !membershipValidation.valid || !yearStartValidation.valid || !yearEndValidation.valid) {
      return error(
        res,
        regValidation.message || membershipValidation.message || yearStartValidation.message || yearEndValidation.message,
        400
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create fee definition
      const insertResult = await client.query(
        `INSERT INTO fee_definitions (organization_id, registration_fee, membership_fee, year_start, year_end)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id, registration_fee, membership_fee, year_start, year_end, created_at`,
        [organizationId, regValidation.value, membershipValidation.value, year_start, year_end]
      );

      const feeDefinition = insertResult.rows[0];

      // Auto-create participant fees for all active participants in this organization
      await client.query(
        `INSERT INTO participant_fees (participant_id, organization_id, fee_definition_id, total_registration_fee, total_membership_fee, status, notes)
         SELECT
           po.participant_id,
           po.organization_id,
           $1,
           $2,
           $3,
           'unpaid',
           ''
         FROM participant_organizations po
         WHERE po.organization_id = $4
         ON CONFLICT (participant_id, fee_definition_id, organization_id) DO NOTHING`,
        [feeDefinition.id, regValidation.value, membershipValidation.value, organizationId]
      );

      await client.query('COMMIT');
      return success(res, feeDefinition, 'Fee definition created and assigned to all participants', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  router.put('/v1/finance/fee-definitions/:id', authenticate, blockDemoRoles, requirePermission('finance.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { id } = req.params;
    const { registration_fee, membership_fee, year_start, year_end } = req.body;

    const regValidation = validateMoney(registration_fee, 'registration_fee');
    const membershipValidation = validateMoney(membership_fee, 'membership_fee');
    const yearStartValidation = validateDate(year_start, 'year_start');
    const yearEndValidation = validateDate(year_end, 'year_end');

    if (!regValidation.valid || !membershipValidation.valid || !yearStartValidation.valid || !yearEndValidation.valid) {
      return error(
        res,
        regValidation.message || membershipValidation.message || yearStartValidation.message || yearEndValidation.message,
        400
      );
    }

    const existing = await pool.query(
      'SELECT id FROM fee_definitions WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );

    if (existing.rows.length === 0) {
      return error(res, 'Fee definition not found', 404);
    }

    const updateResult = await pool.query(
      `UPDATE fee_definitions
       SET registration_fee = $1,
           membership_fee = $2,
           year_start = $3,
           year_end = $4
       WHERE id = $5 AND organization_id = $6
       RETURNING id, organization_id, registration_fee, membership_fee, year_start, year_end, created_at`,
      [regValidation.value, membershipValidation.value, year_start, year_end, id, organizationId]
    );

    return success(res, updateResult.rows[0], 'Fee definition updated');
  }));

  router.delete('/v1/finance/fee-definitions/:id', authenticate, blockDemoRoles, requirePermission('finance.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { id } = req.params;

    const existing = await pool.query(
      'SELECT id FROM fee_definitions WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );

    if (existing.rows.length === 0) {
      return error(res, 'Fee definition not found', 404);
    }

    await pool.query('DELETE FROM fee_definitions WHERE id = $1 AND organization_id = $2', [id, organizationId]);

    return success(res, true, 'Fee definition deleted');
  }));

  router.get('/v1/finance/participant-fees', authenticate, requirePermission('finance.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `WITH paid AS (
        SELECT participant_fee_id, SUM(amount) AS total_paid
        FROM payments
        GROUP BY participant_fee_id
      )
      SELECT pf.id, pf.participant_id, pf.organization_id, pf.fee_definition_id,
             pf.total_registration_fee, pf.total_membership_fee, pf.total_amount,
             pf.status, pf.notes, pf.created_at,
             p.first_name, p.last_name,
             fd.year_start, fd.year_end,
             COALESCE(paid.total_paid, 0) AS total_paid
      FROM participant_fees pf
      JOIN participants p ON p.id = pf.participant_id
      JOIN fee_definitions fd ON fd.id = pf.fee_definition_id
      LEFT JOIN paid ON paid.participant_fee_id = pf.id
      WHERE pf.organization_id = $1
      ORDER BY pf.created_at DESC`,
      [organizationId]
    );

    const formatted = result.rows.map(formatFeeRow);
    return success(res, formatted, 'Participant fees loaded');
  }));

  router.post('/v1/finance/participant-fees', authenticate, blockDemoRoles, requirePermission('finance.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const {
      participant_id,
      fee_definition_id,
      total_registration_fee,
      total_membership_fee,
      status = 'unpaid',
      notes = ''
    } = req.body;

    if (!participant_id || !fee_definition_id) {
      return error(res, 'Participant and fee definition are required', 400);
    }

    const registrationValidation = validateMoney(total_registration_fee, 'total_registration_fee');
    const membershipValidation = validateMoney(total_membership_fee, 'total_membership_fee');

    if (!registrationValidation.valid || !membershipValidation.valid) {
      return error(res, registrationValidation.message || membershipValidation.message, 400);
    }

    const participantCheck = await pool.query(
      'SELECT 1 FROM participant_organizations WHERE participant_id = $1 AND organization_id = $2',
      [participant_id, organizationId]
    );

    if (participantCheck.rows.length === 0) {
      return error(res, 'Participant is not part of this organization', 400);
    }

    const feeDefinitionCheck = await pool.query(
      'SELECT id FROM fee_definitions WHERE id = $1 AND organization_id = $2',
      [fee_definition_id, organizationId]
    );

    if (feeDefinitionCheck.rows.length === 0) {
      return error(res, 'Fee definition not found for this organization', 404);
    }

    const insertResult = await pool.query(
      `INSERT INTO participant_fees (
         participant_id,
         organization_id,
         fee_definition_id,
         total_registration_fee,
         total_membership_fee,
         status,
         notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        participant_id,
        organizationId,
        fee_definition_id,
        registrationValidation.value,
        membershipValidation.value,
        status,
        notes
      ]
    );

    return success(res, formatFeeRow(insertResult.rows[0]), 'Participant fee created', 201);
  }));

  router.put('/v1/finance/participant-fees/:id', authenticate, blockDemoRoles, requirePermission('finance.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { id } = req.params;
    const {
      total_registration_fee,
      total_membership_fee,
      status,
      notes
    } = req.body;

    const existing = await pool.query(
      'SELECT * FROM participant_fees WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );

    if (existing.rows.length === 0) {
      return error(res, 'Participant fee not found', 404);
    }

    const base = existing.rows[0];
    const registrationValidation = total_registration_fee !== undefined
      ? validateMoney(total_registration_fee, 'total_registration_fee')
      : { valid: true, value: base.total_registration_fee };
    const membershipValidation = total_membership_fee !== undefined
      ? validateMoney(total_membership_fee, 'total_membership_fee')
      : { valid: true, value: base.total_membership_fee };

    if (!registrationValidation.valid || !membershipValidation.valid) {
      return error(res, registrationValidation.message || membershipValidation.message, 400);
    }

    const updateResult = await pool.query(
      `UPDATE participant_fees
       SET total_registration_fee = $1,
           total_membership_fee = $2,
           status = $3,
           notes = $4
       WHERE id = $5 AND organization_id = $6
       RETURNING *`,
      [
        registrationValidation.value,
        membershipValidation.value,
        status || base.status,
        notes !== undefined ? notes : base.notes,
        id,
        organizationId
      ]
    );

    return success(res, formatFeeRow(updateResult.rows[0]), 'Participant fee updated');
  }));

  router.get('/v1/finance/participant-fees/:id/payments', authenticate, requirePermission('finance.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { id } = req.params;
    const feeRow = await pool.query(
      'SELECT id FROM participant_fees WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );

    if (feeRow.rows.length === 0) {
      return error(res, 'Participant fee not found', 404);
    }

    const payments = await pool.query(
      `SELECT id, participant_fee_id, payment_plan_id, amount, payment_date, method, reference_number, created_at
       FROM payments
       WHERE participant_fee_id = $1
       ORDER BY payment_date DESC, created_at DESC`,
      [id]
    );

    return success(res, payments.rows, 'Payments loaded');
  }));

  router.post('/v1/finance/participant-fees/:id/payments', authenticate, blockDemoRoles, requirePermission('finance.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { id } = req.params;
    const { payment_plan_id, amount, payment_date, method, reference_number } = req.body;

    const feeRow = await pool.query(
      'SELECT id FROM participant_fees WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );

    if (feeRow.rows.length === 0) {
      return error(res, 'Participant fee not found', 404);
    }

    const amountValidation = validateMoney(amount, 'amount');
    const dateValidation = validateDate(payment_date, 'payment_date');

    if (!amountValidation.valid || !dateValidation.valid) {
      return error(res, amountValidation.message || dateValidation.message, 400);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert payment
      const insertResult = await client.query(
         `INSERT INTO payments (participant_fee_id, payment_plan_id, amount, payment_date, method, reference_number)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, participant_fee_id, payment_plan_id, amount, payment_date, method, reference_number, created_at`,
        [id, payment_plan_id || null, amountValidation.value, payment_date, method || null, reference_number || null]
      );

      // Auto-calculate and update status
      await client.query(
        `UPDATE participant_fees pf
         SET status = CASE
           WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE participant_fee_id = pf.id), 0) >= pf.total_amount THEN 'paid'
           WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE participant_fee_id = pf.id), 0) > 0 THEN 'partial'
           ELSE 'unpaid'
         END
         WHERE pf.id = $1`,
        [id]
      );

      await client.query('COMMIT');
      return success(res, insertResult.rows[0], 'Payment recorded', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  router.put('/v1/finance/payments/:paymentId', authenticate, blockDemoRoles, requirePermission('finance.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { paymentId } = req.params;
    const { amount, payment_date, method, reference_number } = req.body;

    const amountValidation = validateMoney(amount, 'amount');
    const dateValidation = validateDate(payment_date, 'payment_date');

    if (!amountValidation.valid || !dateValidation.valid) {
      return error(res, amountValidation.message || dateValidation.message, 400);
    }

    const paymentRow = await pool.query(
      `SELECT pay.id, pf.organization_id
       FROM payments pay
       JOIN participant_fees pf ON pf.id = pay.participant_fee_id
       WHERE pay.id = $1`,
      [paymentId]
    );

    if (paymentRow.rows.length === 0) {
      return error(res, 'Payment not found', 404);
    }

    if (paymentRow.rows[0].organization_id !== organizationId) {
      return error(res, 'Payment does not belong to this organization', 403);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update payment
      const updated = await client.query(
        `UPDATE payments
         SET amount = $1,
             payment_date = $2,
             method = $3,
             reference_number = $4
         WHERE id = $5
         RETURNING id, participant_fee_id, payment_plan_id, amount, payment_date, method, reference_number, created_at`,
        [amountValidation.value, payment_date, method || null, reference_number || null, paymentId]
      );

      // Auto-calculate and update status
      const feeId = updated.rows[0].participant_fee_id;
      await client.query(
        `UPDATE participant_fees pf
         SET status = CASE
           WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE participant_fee_id = pf.id), 0) >= pf.total_amount THEN 'paid'
           WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE participant_fee_id = pf.id), 0) > 0 THEN 'partial'
           ELSE 'unpaid'
         END
         WHERE pf.id = $1`,
        [feeId]
      );

      await client.query('COMMIT');
      return success(res, updated.rows[0], 'Payment updated');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  router.get('/v1/finance/participant-fees/:id/payment-plans', authenticate, requirePermission('finance.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { id } = req.params;
    const feeRow = await pool.query(
      'SELECT id FROM participant_fees WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );

    if (feeRow.rows.length === 0) {
      return error(res, 'Participant fee not found', 404);
    }

    const plans = await pool.query(
      `SELECT id, participant_fee_id, number_of_payments, amount_per_payment, start_date, frequency, notes, created_at
       FROM payment_plans
       WHERE participant_fee_id = $1
       ORDER BY created_at DESC`,
      [id]
    );

    return success(res, plans.rows, 'Payment plans loaded');
  }));

  router.post('/v1/finance/participant-fees/:id/payment-plans', authenticate, blockDemoRoles, requirePermission('finance.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { id } = req.params;
    const { number_of_payments, amount_per_payment, start_date, frequency, notes } = req.body;

    const feeRow = await pool.query(
      'SELECT id FROM participant_fees WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );

    if (feeRow.rows.length === 0) {
      return error(res, 'Participant fee not found', 404);
    }

    const paymentsValidation = validatePositiveInteger(number_of_payments, 'number_of_payments');
    const amountValidation = validateMoney(amount_per_payment, 'amount_per_payment');
    const startDateValidation = validateDate(start_date, 'start_date');

    if (!paymentsValidation.valid || !amountValidation.valid || !startDateValidation.valid || !frequency) {
      return error(
        res,
        paymentsValidation.message || amountValidation.message || startDateValidation.message || 'frequency is required',
        400
      );
    }

    const insertResult = await pool.query(
       `INSERT INTO payment_plans (participant_fee_id, number_of_payments, amount_per_payment, start_date, frequency, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, participant_fee_id, number_of_payments, amount_per_payment, start_date, frequency, notes, created_at`,
      [id, paymentsValidation.value, amountValidation.value, start_date, frequency, notes || null]
    );

    return success(res, insertResult.rows[0], 'Payment plan created', 201);
  }));

  router.put('/v1/finance/payment-plans/:planId', authenticate, blockDemoRoles, requirePermission('finance.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { planId } = req.params;
    const { number_of_payments, amount_per_payment, start_date, frequency, notes } = req.body;

    const paymentsValidation = validatePositiveInteger(number_of_payments, 'number_of_payments');
    const amountValidation = validateMoney(amount_per_payment, 'amount_per_payment');
    const startDateValidation = validateDate(start_date, 'start_date');

    if (!paymentsValidation.valid || !amountValidation.valid || !startDateValidation.valid || !frequency) {
      return error(
        res,
        paymentsValidation.message || amountValidation.message || startDateValidation.message || 'frequency is required',
        400
      );
    }

    const existing = await pool.query(
      `SELECT pp.id, pf.organization_id
       FROM payment_plans pp
       JOIN participant_fees pf ON pf.id = pp.participant_fee_id
       WHERE pp.id = $1`,
      [planId]
    );

    if (existing.rows.length === 0) {
      return error(res, 'Payment plan not found', 404);
    }

    if (existing.rows[0].organization_id !== organizationId) {
      return error(res, 'Payment plan does not belong to this organization', 403);
    }

    const updated = await pool.query(
      `UPDATE payment_plans
       SET number_of_payments = $1,
           amount_per_payment = $2,
           start_date = $3,
           frequency = $4,
           notes = $5
       WHERE id = $6
       RETURNING id, participant_fee_id, number_of_payments, amount_per_payment, start_date, frequency, notes, created_at`,
      [paymentsValidation.value, amountValidation.value, start_date, frequency, notes || null, planId]
    );

    return success(res, updated.rows[0], 'Payment plan updated');
  }));

  router.delete('/v1/finance/payment-plans/:planId', authenticate, blockDemoRoles, requirePermission('finance.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { planId } = req.params;

    const existing = await pool.query(
      `SELECT pp.id, pf.organization_id
       FROM payment_plans pp
       JOIN participant_fees pf ON pf.id = pp.participant_fee_id
       WHERE pp.id = $1`,
      [planId]
    );

    if (existing.rows.length === 0) {
      return error(res, 'Payment plan not found', 404);
    }

    if (existing.rows[0].organization_id !== organizationId) {
      return error(res, 'Payment plan does not belong to this organization', 403);
    }

    await pool.query('DELETE FROM payment_plans WHERE id = $1', [planId]);
    return success(res, true, 'Payment plan deleted');
  }));

  router.get('/v1/finance/reports/summary', authenticate, requirePermission('finance.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const totalsResult = await pool.query(
      `WITH paid AS (
         SELECT participant_fee_id, SUM(amount) AS total_paid
         FROM payments
         GROUP BY participant_fee_id
       )
       SELECT COALESCE(SUM(pf.total_amount), 0) AS total_billed,
              COALESCE(SUM(paid.total_paid), 0) AS total_paid,
              COUNT(pf.id) AS fee_count
       FROM participant_fees pf
       LEFT JOIN paid ON paid.participant_fee_id = pf.id
       WHERE pf.organization_id = $1`,
      [organizationId]
    );

    const participantBreakdown = await pool.query(
      `WITH paid AS (
         SELECT participant_fee_id, SUM(amount) AS total_paid
         FROM payments
         GROUP BY participant_fee_id
       )
       SELECT pf.participant_id, p.first_name, p.last_name,
              COALESCE(SUM(pf.total_amount), 0) AS total_billed,
              COALESCE(SUM(paid.total_paid), 0) AS total_paid
       FROM participant_fees pf
       JOIN participants p ON p.id = pf.participant_id
       LEFT JOIN paid ON paid.participant_fee_id = pf.id
       WHERE pf.organization_id = $1
       GROUP BY pf.participant_id, p.first_name, p.last_name
       ORDER BY p.last_name, p.first_name`,
      [organizationId]
    );

    const byDefinition = await pool.query(
      `WITH paid AS (
         SELECT participant_fee_id, SUM(amount) AS total_paid
         FROM payments
         GROUP BY participant_fee_id
       )
       SELECT fd.id, fd.year_start, fd.year_end,
              COALESCE(SUM(pf.total_amount), 0) AS total_billed,
              COALESCE(SUM(paid.total_paid), 0) AS total_paid
       FROM fee_definitions fd
       LEFT JOIN participant_fees pf ON pf.fee_definition_id = fd.id AND pf.organization_id = $1
       LEFT JOIN paid ON paid.participant_fee_id = pf.id
       WHERE fd.organization_id = $1
       GROUP BY fd.id, fd.year_start, fd.year_end
       ORDER BY fd.year_start DESC, fd.year_end DESC`,
      [organizationId]
    );

    const totalsRow = totalsResult.rows[0];
    const totalBilled = toNumeric(totalsRow.total_billed);
    const totalPaid = toNumeric(totalsRow.total_paid);

    const payload = {
      totals: {
        total_billed: totalBilled,
        total_paid: totalPaid,
        total_outstanding: totalBilled - totalPaid,
        fee_count: Number(totalsRow.fee_count || 0)
      },
      participants: participantBreakdown.rows.map((row) => ({
        ...row,
        total_billed: toNumeric(row.total_billed),
        total_paid: toNumeric(row.total_paid),
        total_outstanding: toNumeric(row.total_billed) - toNumeric(row.total_paid)
      })),
      definitions: byDefinition.rows.map((row) => ({
        ...row,
        total_billed: toNumeric(row.total_billed),
        total_paid: toNumeric(row.total_paid),
        total_outstanding: toNumeric(row.total_billed) - toNumeric(row.total_paid)
      }))
    };

    return success(res, payload, 'Financial summary ready');
  }));

  router.get('/v1/finance/participants/:participantId/statement', authenticate, requirePermission('finance.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { participantId } = req.params;

    const participantRow = await pool.query(
      `SELECT p.id, p.first_name, p.last_name
       FROM participants p
       JOIN participant_organizations po ON po.participant_id = p.id
       WHERE p.id = $1 AND po.organization_id = $2`,
      [participantId, organizationId]
    );

    if (participantRow.rows.length === 0) {
      return error(res, 'Participant not found in this organization', 404);
    }

    // Use centralized role constants for finance access
    const isStaff = hasAnyRole(req, ...ROLE_GROUPS.FINANCE_ACCESS);

    if (!isStaff) {
      const guardianLink = await pool.query(
        `SELECT 1
         FROM user_participants up
         JOIN participant_organizations po ON po.participant_id = up.participant_id AND po.organization_id = $2
         WHERE up.user_id = $1 AND up.participant_id = $3`,
        [req.user.id, organizationId, participantId]
      );

      if (guardianLink.rows.length === 0) {
        return error(res, 'Insufficient permissions to view this statement', 403);
      }
    }

    const statementResult = await pool.query(
      `WITH payments AS (
         SELECT participant_fee_id, COALESCE(SUM(amount), 0) AS total_paid
         FROM payments
         GROUP BY participant_fee_id
       )
       SELECT pf.id, pf.participant_id, pf.fee_definition_id, pf.total_registration_fee, pf.total_membership_fee,
              pf.total_amount, pf.status, pf.notes, pf.created_at,
              fd.year_start, fd.year_end, COALESCE(p.total_paid, 0) AS total_paid
       FROM participant_fees pf
       JOIN fee_definitions fd ON fd.id = pf.fee_definition_id
       LEFT JOIN payments p ON p.participant_fee_id = pf.id
       WHERE pf.participant_id = $1 AND pf.organization_id = $2
       ORDER BY pf.created_at DESC`,
      [participantId, organizationId]
    );

    const fees = statementResult.rows.map(formatFeeRow);
    const totals = fees.reduce(
      (acc, fee) => {
        acc.total_billed += toNumeric(fee.total_amount);
        acc.total_paid += toNumeric(fee.total_paid);
        acc.total_outstanding += toNumeric(fee.outstanding);
        return acc;
      },
      { total_billed: 0, total_paid: 0, total_outstanding: 0 }
    );

    return success(
      res,
      {
        participant: participantRow.rows[0],
        totals,
        fees
      },
      'Participant financial statement ready'
    );
  }));

  return router;
};
