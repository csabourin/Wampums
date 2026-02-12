const express = require('express');
const router = express.Router();
const { authenticate, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { verifyOrganizationMembership } = require('../utils/api-helpers');

const MEDICATION_READ_PERMISSIONS = ['medication.view'];
const MEDICATION_MANAGE_PERMISSIONS = ['medication.manage'];

const validateStatus = (status) => ['scheduled', 'given', 'missed', 'cancelled'].includes(status);

const parseParticipantIds = (participantIds) => {
  if (!Array.isArray(participantIds)) {
    return [];
  }

  const unique = new Set();
  participantIds.forEach((id) => {
    const numeric = Number.parseInt(id, 10);
    if (Number.isInteger(numeric) && numeric > 0) {
      unique.add(numeric);
    }
  });

  return Array.from(unique);
};

const normalizeText = (value, maxLength = 1000) => {
  if (typeof value !== 'string') {
    return null;
  }
  return value.trim().slice(0, maxLength);
};

module.exports = (pool, logger) => {
  /**
   * GET /v1/medication/requirements
   * List medication requirement definitions for the organization
   * Permission: participants.view
   */
  router.get('/v1/medication/requirements', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_READ_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const result = await pool.query(
      `SELECT id, organization_id, medication_name, dosage_instructions,
              frequency_text, frequency_preset_type, frequency_times, frequency_slots,
              frequency_interval_hours, frequency_interval_start,
              route, default_dose_amount, default_dose_unit, general_notes,
              start_date, end_date, created_by, created_at, updated_at
       FROM medication_requirements
       WHERE organization_id = $1
       ORDER BY medication_name ASC, created_at DESC`,
      [organizationId]
    );

    return success(res, { requirements: result.rows }, 'Medication requirements loaded');
  }));

  /**
   * GET /v1/medication/fiche-medications
   * List distinct medications captured in fiche_sante submissions
   * Permission: participants.view
   */
  router.get('/v1/medication/fiche-medications', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_READ_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const result = await pool.query(
      `SELECT DISTINCT TRIM(medication) AS medication
         FROM form_submissions,
              unnest(string_to_array(submission_data->>'medicament', E'\\n')) AS medication
        WHERE organization_id = $1
          AND form_type = 'fiche_sante'
          AND submission_data->>'medicament' IS NOT NULL
          AND TRIM(medication) <> ''
        ORDER BY medication ASC`,
      [organizationId]
    );

    return success(res, { medications: result.rows.map((row) => row.medication) }, 'Fiche_sante medications loaded');
  }));

  /**
   * POST /v1/medication/requirements
   * Create a medication requirement and participant assignments
   * Permission: participants.edit
   */
  router.post('/v1/medication/requirements', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_MANAGE_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const {
      medication_name,
      dosage_instructions,
      frequency_text,
      frequency_preset_type,
      frequency_times,
      frequency_slots,
      frequency_interval_hours,
      frequency_interval_start,
      route,
      default_dose_amount,
      default_dose_unit,
      general_notes,
      start_date,
      end_date,
      participant_ids
    } = req.body || {};

    const normalizedName = normalizeText(medication_name, 200);
    const participants = parseParticipantIds(participant_ids);

    if (!normalizedName) {
      return error(res, 'Medication name and a participant are required', 400);
    }

    if (participants.length !== 1) {
      return error(res, 'Medication requirements must target exactly one participant', 400);
    }

    const numericDoseAmount = default_dose_amount !== undefined && default_dose_amount !== null
      ? Number(default_dose_amount)
      : null;

    if (numericDoseAmount !== null && !Number.isFinite(numericDoseAmount)) {
      return error(res, 'Default dose amount must be a valid number', 400);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertRequirement = await client.query(
        `INSERT INTO medication_requirements (
          organization_id, medication_name, dosage_instructions, frequency_text,
          frequency_preset_type, frequency_times, frequency_slots,
          frequency_interval_hours, frequency_interval_start,
          route, default_dose_amount, default_dose_unit, general_notes,
          start_date, end_date, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *`,
        [
          organizationId,
          normalizedName,
          normalizeText(dosage_instructions),
          normalizeText(frequency_text, 120),
          normalizeText(frequency_preset_type, 30),
          frequency_times ? JSON.stringify(frequency_times) : null,
          frequency_slots ? JSON.stringify(frequency_slots) : null,
          frequency_interval_hours ? Number(frequency_interval_hours) : null,
          frequency_interval_start || null,
          normalizeText(route, 120),
          numericDoseAmount,
          normalizeText(default_dose_unit, 50),
          normalizeText(general_notes),
          start_date || null,
          end_date || null,
          req.user.id
        ]
      );

      const requirement = insertRequirement.rows[0];

      for (const participantId of participants) {
        await client.query(
          `INSERT INTO participant_medications (
            organization_id, medication_requirement_id, participant_id, participant_notes
          ) VALUES ($1, $2, $3, NULL)
          ON CONFLICT (organization_id, medication_requirement_id, participant_id)
          DO UPDATE SET updated_at = NOW()`,
          [organizationId, requirement.id, participantId]
        );
      }

      await client.query('COMMIT');
      return success(res, requirement, 'Medication requirement saved', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error creating medication requirement', err);
      return error(res, 'Unable to save medication requirement', 500);
    } finally {
      client.release();
    }
  }));

/**
 * PUT /v1/medication/requirements/:id
 * Update a medication requirement and participant assignments
 * Permission: participants.edit
 */
  router.put('/v1/medication/requirements/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_MANAGE_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const requirementId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(requirementId) || requirementId <= 0) {
      return error(res, 'Invalid requirement ID', 400);
    }

    const {
      medication_name,
      dosage_instructions,
      frequency_text,
      frequency_preset_type,
      frequency_times,
      frequency_slots,
      frequency_interval_hours,
      frequency_interval_start,
      route,
      default_dose_amount,
      default_dose_unit,
      general_notes,
      start_date,
      end_date,
      participant_ids
    } = req.body || {};

    const normalizedName = normalizeText(medication_name, 200);
    const participants = parseParticipantIds(participant_ids);

    if (!normalizedName) {
      return error(res, 'Medication name and a participant are required', 400);
    }

    if (participants.length !== 1) {
      return error(res, 'Medication requirements must target exactly one participant', 400);
    }

    const numericDoseAmount = default_dose_amount !== undefined && default_dose_amount !== null
      ? Number(default_dose_amount)
      : null;

    if (numericDoseAmount !== null && !Number.isFinite(numericDoseAmount)) {
      return error(res, 'Default dose amount must be a valid number', 400);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT id FROM medication_requirements WHERE id = $1 AND organization_id = $2',
        [requirementId, organizationId]
      );

      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return error(res, 'Medication requirement not found', 404);
      }

      const updatedRequirement = await client.query(
        `UPDATE medication_requirements
         SET medication_name = $1,
             dosage_instructions = $2,
             frequency_text = $3,
             frequency_preset_type = $4,
             frequency_times = $5,
             frequency_slots = $6,
             frequency_interval_hours = $7,
             frequency_interval_start = $8,
             route = $9,
             default_dose_amount = $10,
             default_dose_unit = $11,
             general_notes = $12,
             start_date = $13,
             end_date = $14,
             updated_at = NOW()
         WHERE id = $15 AND organization_id = $16
         RETURNING *`,
        [
          normalizedName,
          normalizeText(dosage_instructions),
          normalizeText(frequency_text, 120),
          normalizeText(frequency_preset_type, 30),
          frequency_times ? JSON.stringify(frequency_times) : null,
          frequency_slots ? JSON.stringify(frequency_slots) : null,
          frequency_interval_hours ? Number(frequency_interval_hours) : null,
          frequency_interval_start || null,
          normalizeText(route, 120),
          numericDoseAmount,
          normalizeText(default_dose_unit, 50),
          normalizeText(general_notes),
          start_date || null,
          end_date || null,
          requirementId,
          organizationId
        ]
      );

      for (const participantId of participants) {
        await client.query(
          `INSERT INTO participant_medications (
            organization_id, medication_requirement_id, participant_id, participant_notes
          ) VALUES ($1, $2, $3, NULL)
          ON CONFLICT (organization_id, medication_requirement_id, participant_id)
          DO UPDATE SET updated_at = NOW()`,
          [organizationId, requirementId, participantId]
        );
      }

      await client.query(
        `DELETE FROM participant_medications
         WHERE organization_id = $1
           AND medication_requirement_id = $2
           AND participant_id <> ALL($3::int[])`,
        [organizationId, requirementId, participants]
      );

      await client.query('COMMIT');
      return success(res, updatedRequirement.rows[0], 'Medication requirement updated');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error updating medication requirement', err);
      return error(res, 'Unable to update medication requirement', 500);
    } finally {
      client.release();
    }
  }));

/**
 * GET /v1/medication/participant-medications
 * List participant medication assignments
 * Permission: participants.view
 */
  router.get('/v1/medication/participant-medications', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_READ_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const result = await pool.query(
      `SELECT id, organization_id, medication_requirement_id, participant_id,
              participant_notes, custom_dosage, custom_frequency, created_at, updated_at
       FROM participant_medications
       WHERE organization_id = $1
       ORDER BY medication_requirement_id, participant_id`,
      [organizationId]
    );

    return success(res, { participant_medications: result.rows }, 'Participant medications loaded');
  }));

/**
 * GET /v1/medication/distributions
 * List scheduled and historical medication distributions
 * Permission: participants.edit
 */
  router.get('/v1/medication/distributions', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_MANAGE_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const filters = ['organization_id = $1'];
    const params = [organizationId];

    const upcomingOnly = String(req.query.upcoming_only || '').toLowerCase() === 'true';
    if (upcomingOnly) {
      filters.push('scheduled_for >= NOW() - INTERVAL \'1 day\'');
    }

    const result = await pool.query(
      `SELECT id, organization_id, medication_requirement_id, participant_id, participant_medication_id,
              scheduled_for, activity_name, dose_amount, dose_unit, dose_notes, general_notice,
              status, administered_at, administered_by, witness_name, created_at, updated_at
       FROM medication_distributions
       WHERE ${filters.join(' AND ')}
       ORDER BY scheduled_for ASC`,
      params
    );

    return success(res, { distributions: result.rows }, 'Medication distributions loaded');
  }));

/**
 * POST /v1/medication/distributions
 * Schedule or update medication distributions for a single participant per entry
 * Permission: participants.edit
 */
  router.post('/v1/medication/distributions', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_READ_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const {
      medication_requirement_id,
      participant_ids,
      scheduled_for,
      activity_name,
      dose_amount,
      dose_unit,
      dose_notes,
      general_notice,
      witness_name
    } = req.body || {};

    const requirementId = Number.parseInt(medication_requirement_id, 10);
    const participants = parseParticipantIds(participant_ids);
    const scheduledDate = new Date(scheduled_for);

    if (!Number.isInteger(requirementId) || requirementId <= 0) {
      return error(res, 'A valid medication requirement is required', 400);
    }

    if (participants.length !== 1) {
      return error(res, 'Exactly one participant must be scheduled per distribution', 400);
    }

    if (Number.isNaN(scheduledDate.getTime())) {
      return error(res, 'Scheduled time must be a valid date/time', 400);
    }

    const numericDoseAmount = dose_amount !== undefined && dose_amount !== null ? Number(dose_amount) : null;
    if (numericDoseAmount !== null && !Number.isFinite(numericDoseAmount)) {
      return error(res, 'Dose amount must be a valid number', 400);
    }

    const requirementResult = await pool.query(
      `SELECT id, default_dose_amount, default_dose_unit
       FROM medication_requirements
       WHERE id = $1 AND organization_id = $2`,
      [requirementId, organizationId]
    );

    if (requirementResult.rows.length === 0) {
      return error(res, 'Medication requirement not found', 404);
    }

    const requirement = requirementResult.rows[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const participantId of participants) {
        // Prevent duplicate dose: check if a distribution already exists at this time and is already given
        const existingGiven = await client.query(
          `SELECT id FROM medication_distributions
           WHERE organization_id = $1
             AND medication_requirement_id = $2
             AND participant_id = $3
             AND scheduled_for = $4
             AND status = 'given'`,
          [organizationId, requirementId, participantId, scheduledDate.toISOString()]
        );

        if (existingGiven.rows.length > 0) {
          await client.query('ROLLBACK');
          return error(res, 'This dose has already been given and cannot be given again', 409);
        }

        const assignment = await client.query(
          `INSERT INTO participant_medications (organization_id, medication_requirement_id, participant_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (organization_id, medication_requirement_id, participant_id)
           DO UPDATE SET updated_at = NOW()
           RETURNING id` ,
          [organizationId, requirementId, participantId]
        );

        const participantMedicationId = assignment.rows[0]?.id || null;

        await client.query(
          `INSERT INTO medication_distributions (
            organization_id, medication_requirement_id, participant_id, participant_medication_id,
            scheduled_for, activity_name, dose_amount, dose_unit, dose_notes, general_notice,
            status, witness_name
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled', $11)
          ON CONFLICT (organization_id, medication_requirement_id, participant_id, scheduled_for)
          DO UPDATE SET
            activity_name = EXCLUDED.activity_name,
            dose_amount = EXCLUDED.dose_amount,
            dose_unit = EXCLUDED.dose_unit,
            dose_notes = EXCLUDED.dose_notes,
            general_notice = EXCLUDED.general_notice,
            witness_name = EXCLUDED.witness_name,
            status = EXCLUDED.status,
            updated_at = NOW()`,
          [
            organizationId,
            requirementId,
            participantId,
            participantMedicationId,
            scheduledDate.toISOString(),
            normalizeText(activity_name, 200),
            numericDoseAmount !== null ? numericDoseAmount : requirement.default_dose_amount,
            normalizeText(dose_unit, 50) || requirement.default_dose_unit,
            normalizeText(dose_notes),
            normalizeText(general_notice),
            normalizeText(witness_name, 150)
          ]
        );
      }

      await client.query('COMMIT');
      return success(res, null, 'Medication distributions saved', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Error saving medication distributions', err);
      return error(res, 'Unable to save medication distributions', 500);
    } finally {
      client.release();
    }
  }));

/**
 * PATCH /v1/medication/distributions/:id
 * Update the status of a medication distribution entry
 * Permission: participants.edit
 */
  router.patch('/v1/medication/distributions/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_MANAGE_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const distributionId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(distributionId) || distributionId <= 0) {
      return error(res, 'Invalid distribution ID', 400);
    }

    const { status, administered_at, witness_name } = req.body || {};
    const normalizedStatus = status ? String(status).toLowerCase() : 'scheduled';

    if (!validateStatus(normalizedStatus)) {
      return error(res, 'Invalid status value', 400);
    }

    const administeredAtDate = administered_at ? new Date(administered_at) : null;
    if (administeredAtDate && Number.isNaN(administeredAtDate.getTime())) {
      return error(res, 'administered_at must be a valid date', 400);
    }

    // Prevent duplicate dose: if this distribution is already marked as given, reject the update
    if (normalizedStatus === 'given') {
      const existing = await pool.query(
        'SELECT id, status FROM medication_distributions WHERE id = $1 AND organization_id = $2',
        [distributionId, organizationId]
      );

      if (existing.rows.length === 0) {
        return error(res, 'Distribution not found', 404);
      }

      if (existing.rows[0].status === 'given') {
        return error(res, 'This dose has already been given and cannot be given again', 409);
      }
    }

    const result = await pool.query(
      `UPDATE medication_distributions
       SET status = $1,
           administered_at = $2,
           administered_by = $3,
           witness_name = COALESCE($4, witness_name),
           updated_at = NOW()
       WHERE id = $5 AND organization_id = $6
       RETURNING *`,
      [
        normalizedStatus,
        administeredAtDate ? administeredAtDate.toISOString() : null,
        req.user.id,
        normalizeText(witness_name, 150),
        distributionId,
        organizationId
      ]
    );

    if (result.rows.length === 0) {
      return error(res, 'Distribution not found', 404);
    }

    return success(res, result.rows[0], 'Distribution updated');
  }));

  /**
   * GET /v1/medication/receptions
   * List medication receptions for an activity
   * Query params: activity_id (required)
   * Permission: participants.view
   */
  router.get('/v1/medication/receptions', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_READ_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const activityId = req.query.activity_id ? Number.parseInt(req.query.activity_id, 10) : null;

    let query = `
      SELECT
        mr.*,
        mreq.medication_name,
        mreq.dosage_instructions,
        mreq.route,
        mreq.general_notes as requirement_notes,
        p.first_name,
        p.last_name,
        u.full_name as received_by_name
      FROM medication_receptions mr
      LEFT JOIN medication_requirements mreq ON mr.medication_requirement_id = mreq.id
      LEFT JOIN participants p ON mr.participant_id = p.id
      LEFT JOIN users u ON mr.received_by = u.id
      WHERE mr.organization_id = $1
    `;

    const params = [organizationId];

    if (activityId && Number.isInteger(activityId)) {
      query += ` AND mr.activity_id = $2`;
      params.push(activityId);
    }

    query += ` ORDER BY p.last_name, p.first_name, mreq.medication_name`;

    const result = await pool.query(query, params);

    return success(res, { receptions: result.rows });
  }));

  /**
   * POST /v1/medication/receptions
   * Create or update medication reception record
   * Permission: participants.edit
   */
  router.post('/v1/medication/receptions', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_MANAGE_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const {
      activity_id,
      medication_requirement_id,
      participant_id,
      participant_medication_id,
      status,
      quantity_received,
      reception_notes
    } = req.body;

    // Validate required fields
    if (!medication_requirement_id || !participant_id) {
      return error(res, 'medication_requirement_id and participant_id are required', 400);
    }

    // Validate status
    const validStatuses = ['received', 'not_received', 'partial'];
    if (status && !validStatuses.includes(status)) {
      return error(res, 'Invalid status. Must be: received, not_received, or partial', 400);
    }

    const receivedAt = status === 'received' || status === 'partial' ? new Date() : null;

    // Check if reception already exists for this combination
    const existingCheck = await pool.query(
      `SELECT id FROM medication_receptions
       WHERE organization_id = $1
         AND medication_requirement_id = $2
         AND participant_id = $3
         AND activity_id IS NOT DISTINCT FROM $4`,
      [organizationId, medication_requirement_id, participant_id, activity_id || null]
    );

    let result;

    if (existingCheck.rows.length > 0) {
      // Update existing record
      result = await pool.query(
        `UPDATE medication_receptions
         SET status = $1,
             quantity_received = $2,
             reception_notes = $3,
             received_by = $4,
             received_at = $5,
             participant_medication_id = COALESCE($6, participant_medication_id),
             updated_at = NOW()
         WHERE id = $7 AND organization_id = $8
         RETURNING *`,
        [
          status || 'not_received',
          normalizeText(quantity_received, 500),
          normalizeText(reception_notes, 1000),
          req.user.id,
          receivedAt,
          participant_medication_id || null,
          existingCheck.rows[0].id,
          organizationId
        ]
      );
    } else {
      // Create new record
      result = await pool.query(
        `INSERT INTO medication_receptions (
           organization_id,
           activity_id,
           medication_requirement_id,
           participant_id,
           participant_medication_id,
           status,
           quantity_received,
           reception_notes,
           received_by,
           received_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          organizationId,
          activity_id || null,
          medication_requirement_id,
          participant_id,
          participant_medication_id || null,
          status || 'not_received',
          normalizeText(quantity_received, 500),
          normalizeText(reception_notes, 1000),
          req.user.id,
          receivedAt
        ]
      );
    }

    return success(res, result.rows[0], 'Medication reception recorded', 201);
  }));

  /**
   * PATCH /v1/medication/receptions/:id
   * Update medication reception record
   * Permission: participants.edit
   */
  router.patch('/v1/medication/receptions/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_MANAGE_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const receptionId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(receptionId)) {
      return error(res, 'Invalid reception ID', 400);
    }

    const {
      status,
      quantity_received,
      reception_notes
    } = req.body;

    // Validate status if provided
    const validStatuses = ['received', 'not_received', 'partial'];
    if (status && !validStatuses.includes(status)) {
      return error(res, 'Invalid status. Must be: received, not_received, or partial', 400);
    }

    const receivedAt = status === 'received' || status === 'partial' ? new Date() : null;

    const result = await pool.query(
      `UPDATE medication_receptions
       SET status = COALESCE($1, status),
           quantity_received = COALESCE($2, quantity_received),
           reception_notes = COALESCE($3, reception_notes),
           received_by = $4,
           received_at = COALESCE($5, received_at),
           updated_at = NOW()
       WHERE id = $6 AND organization_id = $7
       RETURNING *`,
      [
        status || null,
        normalizeText(quantity_received, 500) || null,
        normalizeText(reception_notes, 1000) || null,
        req.user.id,
        receivedAt,
        receptionId,
        organizationId
      ]
    );

    if (result.rows.length === 0) {
      return error(res, 'Reception record not found', 404);
    }

    return success(res, result.rows[0], 'Medication reception updated');
  }));

  /**
   * DELETE /v1/medication/receptions/:id
   * Delete medication reception record
   * Permission: participants.edit
   */
  router.delete('/v1/medication/receptions/:id', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const authCheck = await verifyOrganizationMembership(pool, req.user.id, organizationId, {
      requiredPermissions: MEDICATION_MANAGE_PERMISSIONS,
    });

    if (!authCheck.authorized) {
      return error(res, authCheck.message, 403);
    }

    const receptionId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(receptionId)) {
      return error(res, 'Invalid reception ID', 400);
    }

    const result = await pool.query(
      'DELETE FROM medication_receptions WHERE id = $1 AND organization_id = $2 RETURNING id',
      [receptionId, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Reception record not found', 404);
    }

    return success(res, null, 'Medication reception deleted');
  }));

  return router;
};
