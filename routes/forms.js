/**
 * Form Routes
 *
 * Handles form submissions, form structures, risk acceptance, and health forms
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/forms
 */

const express = require('express');
const { authenticate, blockDemoRoles, getOrganizationId, getUserDataScope, requireAnyPermission, requirePermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { findRolesInUnit } = require('../services/roleAssignment');

// Import utilities
const { getCurrentOrganizationId, verifyJWT, handleOrganizationResolutionError, verifyOrganizationMembership, getFormPermissionsForRoles, checkFormPermission } = require('../utils/api-helpers');

/** Largest value of a PostgreSQL integer column. */
const MAX_INTEGER_ID = 2147483647;

/** Unit-wide permissions that open any form's submissions for reading. */
const FORM_READ_PERMISSIONS = ['forms.view', 'forms.submit', 'forms.manage'];

/** Unit-wide permission that sets any submission's review status. */
const FORM_APPROVE_PERMISSIONS = ['forms.manage'];

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with form routes
 */
module.exports = (pool, logger) => {
  const router = express.Router();
  const parseFormSchema = (schemaValue) => {
    if (!schemaValue) {
      return {};
    }

    if (typeof schemaValue === 'object') {
      return schemaValue;
    }

    try {
      return JSON.parse(schemaValue);
    } catch {
      return {};
    }
  };


  /**
   * Resolve an enrolled participant for a form request while respecting the
   * authenticated user's organization or participant-level data scope.
   *
   * @param {Object} req - Authenticated Express request
   * @param {number} participantId - Participant identifier
   * @returns {Promise<{organizationId: number, scoutYearId: number}|null>}
   */
  const resolveParticipantFormAccess = async (req, participantId) => {
    const organizationId = await getOrganizationId(req, pool);
    const dataScope = await getUserDataScope(req, pool);
    const hasOrganizationScope = dataScope === 'organization';
    const result = await pool.query(
      `SELECT pe.scout_year_id
       FROM participant_enrollments pe
       WHERE pe.participant_id = $1
         AND pe.organization_id = $2
         AND pe.status = 'active'
         AND ($3::boolean OR EXISTS (
           SELECT 1 FROM user_participants up
           WHERE up.participant_id = pe.participant_id AND up.user_id = $4
         ))
       ORDER BY pe.created_at DESC
       LIMIT 1`,
      [participantId, organizationId, hasOrganizationScope, req.user.id],
    );

    if (!result.rows[0]) return null;
    return { organizationId, scoutYearId: result.rows[0].scout_year_id };
  };

  /**
   * Read a row id from a request: a positive integer within the
   * database's integer range, or null.
   *
   * @param {*} value - Raw value from the query string or body
   * @returns {number|null} The id, or null when it is not one
   */
  const parseIntegerId = (value) => {
    if (typeof value !== 'number' && typeof value !== 'string') {
      return null;
    }
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) {
      return null;
    }
    const id = Number(text);
    return id > 0 && id <= MAX_INTEGER_ID ? id : null;
  };

  /**
   * Whether an account may act on a participant's form submissions in a unit.
   *
   * The child must have an active enrollment in the unit, as for the risk
   * acceptance form (resolveParticipantFormAccess). Someone who sees the whole unit
   * (a role with organization scope) reaches every child there; an account
   * limited to its own children reaches only the children linked to it.
   *
   * @param {string} userId - Acting user (UUID)
   * @param {number} organizationId - Unit
   * @param {number} participantId - Participant
   * @returns {Promise<boolean>} True when the account reaches the child
   */
  const mayReachParticipant = async (userId, organizationId, participantId) => {
    const result = await pool.query(
      `SELECT EXISTS (
                SELECT 1 FROM participant_enrollments pe
                 WHERE pe.participant_id = $1 AND pe.organization_id = $2
                   AND pe.status = 'active'
              )
          AND (
                EXISTS (
                  SELECT 1
                    FROM user_organizations uo
                    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
                    JOIN roles r ON r.id = role_id_text::integer
                   WHERE uo.user_id = $3 AND uo.organization_id = $2
                     AND uo.status = 'active'
                     AND r.data_scope = 'organization'
                )
                OR EXISTS (
                  SELECT 1 FROM user_participants up
                   WHERE up.user_id = $3 AND up.participant_id = $1
                )
              ) AS reachable`,
      [participantId, organizationId, userId]
    );
    return result.rows[0]?.reachable === true;
  };

  /**
   * Whether an account sees the whole unit: a role with organization scope
   * in an active membership.
   *
   * @param {string} userId - Acting user (UUID)
   * @param {number} organizationId - Unit
   * @returns {Promise<boolean>} True when it does
   */
  const seesWholeUnit = async (userId, organizationId) => {
    const result = await pool.query(
      `SELECT 1
         FROM user_organizations uo
         CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
         JOIN roles r ON r.id = role_id_text::integer
        WHERE uo.user_id = $1 AND uo.organization_id = $2
          AND uo.status = 'active'
          AND r.data_scope = 'organization'
        LIMIT 1`,
      [userId, organizationId]
    );
    return result.rows.length > 0;
  };

  /**
   * Whether an account may read submissions of a form type: a unit-wide forms
   * permission, or the view right the unit gave one of its roles on that form
   * type -- the same per-form rights that let it save the form.
   *
   * @param {string} userId - Acting user (UUID)
   * @param {number} organizationId - Unit
   * @param {string[]} roleNames - The account's role names in the unit
   * @param {string} formType - Form type
   * @returns {Promise<boolean>} True when it may
   */
  const mayReadFormType = async (userId, organizationId, roleNames, formType) => (
    await holdsAnyPermission(userId, organizationId, FORM_READ_PERMISSIONS)
    || checkFormPermission(pool, organizationId, roleNames, formType, 'view')
  );

  /**
   * Whether an account holds any of the given permissions in a unit, through
   * an active membership.
   *
   * @param {string} userId - Acting user (UUID)
   * @param {number} organizationId - Unit
   * @param {string[]} permissionKeys - Permissions, any of which will do
   * @returns {Promise<boolean>} True when one is held
   */
  const holdsAnyPermission = async (userId, organizationId, permissionKeys) => {
    const result = await pool.query(
      `SELECT 1
         FROM user_organizations uo
         CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
         JOIN role_permissions rp ON rp.role_id = role_id_text::integer
         JOIN permissions p ON p.id = rp.permission_id
        WHERE uo.user_id = $1 AND uo.organization_id = $2
          AND uo.status = 'active'
          AND p.permission_key = ANY($3::text[])
        LIMIT 1`,
      [userId, organizationId, permissionKeys]
    );
    return result.rows.length > 0;
  };

  /**
   * Refuse a request on a form type the account holds no right on.
   *
   * @param {Object} res - Express response
   * @param {string} action - 'view' or 'approve'
   * @returns {Object} The 403 response, naming the unit-wide permissions that would do
   */
  const refuseFormType = (res, action) => {
    const permissions = action === 'approve' ? FORM_APPROVE_PERMISSIONS : FORM_READ_PERMISSIONS;
    return res.status(403).json({
      success: false,
      message: `You do not have permission to ${action} this form type`,
      required: permissions,
      missing: permissions
    });
  };

  // Compatibility REST endpoints used by comprehensive API tests
  router.get('/', authenticate, requireAnyPermission('forms.view', 'forms.manage'), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);
      const { type } = req.query;

      const params = [organizationId];
      let whereClause = 'WHERE organization_id = $1 AND is_active = true';

      if (type) {
        params.push(type);
        whereClause += ` AND type = $${params.length}`;
      }

      const result = await pool.query(
        `SELECT id, name, type, version, organization_id, schema, is_active, created_at, updated_at
         FROM forms
         ${whereClause}
         ORDER BY updated_at DESC`,
        params
      );

      return success(res, result.rows.map((form) => ({
        ...form,
        schema: parseFormSchema(form.schema)
      })), 'Forms loaded');
    } catch (err) {
      logger.error('Error loading forms list:', err);
      return error(res, 'Unable to load forms', 500);
    }
  }));

  /**
   * @swagger
   * /api/form-types:
   *   get:
   *     summary: Get available form types
   *     description: Retrieve list of public form types available for the organization
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of form types
   *       401:
   *         description: Unauthorized
   */
  router.get('/types', authenticate, asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        "SELECT DISTINCT form_type FROM organization_form_formats WHERE organization_id = $1 AND display_type = 'public' ORDER BY form_type",
        [organizationId]
      );

      res.json({
        success: true,
        data: result.rows.map(row => row.form_type)
      });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error fetching form types:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  router.post('/', authenticate, blockDemoRoles, requirePermission('forms.manage'), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);
      const { name, type, schema } = req.body || {};

      if (!name || !type) {
        return error(res, 'Name and type are required', 400);
      }

      if (schema !== undefined && (typeof schema !== 'object' || Array.isArray(schema))) {
        return error(res, 'Schema must be a JSON object', 400);
      }

      const result = await pool.query(
        `INSERT INTO forms (name, type, version, organization_id, schema, is_active)
         VALUES ($1, $2, 1, $3, $4, true)
         RETURNING id, name, type, version, organization_id, schema, is_active, created_at, updated_at`,
        [name, type, organizationId, JSON.stringify(schema || {})]
      );

      if (!result.rows[0]) {
        return error(res, 'Forbidden', 403);
      }

      return success(res, {
        ...result.rows[0],
        schema: parseFormSchema(result.rows[0].schema)
      }, 'Form created', 201);
    } catch (err) {
      logger.error('Error creating form:', err);
      return error(res, 'Unable to create form', 500);
    }
  }));

  /**
   * @swagger
   * /api/v1/forms/formats:
   *   get:
   *     summary: Get organization form formats
   *     description: Retrieve form formats configured for the organization that the user has permission to view, optionally filtered by display context
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: context
   *         schema:
   *           type: string
   *           enum: [participant, organization, admin_panel, public, form_builder]
   *         description: Filter forms by display context
   *     responses:
   *       200:
   *         description: Form formats retrieved successfully (filtered by permissions and context)
   *       401:
   *         description: Unauthorized
   */
  router.get('/formats', authenticate, asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization and get their roles
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      // Get context filter from query parameter
      const { context } = req.query;

      // Build query with optional context filter
      let query = `SELECT * FROM organization_form_formats WHERE organization_id = $1`;
      const params = [organizationId];

      if (context) {
        // Filter by display context using PostgreSQL array containment
        query += ` AND $2 = ANY(display_context)`;
        params.push(context);
      }

      // Get form formats for the organization (optionally filtered by context)
      const result = await pool.query(query, params);

      // Get form permissions for user's roles
      const userRoles = authCheck.roles || [];
      const formPermissions = await getFormPermissionsForRoles(pool, organizationId, userRoles);

      // Transform and filter the data based on permissions
      const formatsObject = {};
      result.rows.forEach(row => {
        const permissions = formPermissions[row.form_type];

        // Only include forms the user can view
        if (permissions && permissions.can_view) {
          formatsObject[row.form_type] = {
            ...row,
            form_structure: typeof row.form_structure === 'string'
              ? JSON.parse(row.form_structure)
              : row.form_structure,
            // Include the user's permissions for this form
            permissions: permissions,
            // Include display_context for frontend use
            display_context: row.display_context || []
          };
        }
      });

      res.json({ success: true, data: formatsObject });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error fetching form formats:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/form-submission:
   *   get:
   *     summary: Get form submission for a participant
   *     description: Retrieve the most recent form submission for a specific participant and form type
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: form_type
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Form submission retrieved successfully
   *       400:
   *         description: Missing required parameters
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Access denied
   */
  router.get('/submissions', authenticate, asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { form_type } = req.query;
      const participant_id = parseIntegerId(req.query.participant_id);

      if (!participant_id || !form_type || typeof form_type !== 'string') {
        return res.status(400).json({ success: false, message: 'Participant ID and form_type are required' });
      }

      if (!(await mayReadFormType(decoded.user_id, organizationId, authCheck.roles || [], form_type))) {
        return refuseFormType(res, 'view');
      }

      if (!(await mayReachParticipant(decoded.user_id, organizationId, participant_id))) {
        return res.status(403).json({ success: false, message: 'Access denied to this participant' });
      }

      // Get form submission with participant basic information
      const result = await pool.query(
        `SELECT fs.*,
                p.first_name, p.last_name, p.date_naissance
         FROM form_submissions fs
         JOIN participants p ON fs.participant_id = p.id
         WHERE fs.participant_id = $1 AND fs.organization_id = $2 AND fs.form_type = $3
         ORDER BY fs.updated_at DESC
         LIMIT 1`,
        [participant_id, organizationId, form_type]
      );

      if (result.rows.length > 0) {
        const submission = result.rows[0];
        // Merge submission_data with participant basic info for frontend compatibility
        const formData = {
          ...submission.submission_data,
          first_name: submission.first_name,
          last_name: submission.last_name,
          date_naissance: submission.date_naissance || submission.date_of_birth,
          participant_id: submission.participant_id
        };

        res.json({
          success: true,
          data: submission,
          form_data: formData // Add form_data for frontend compatibility
        });
      } else {
        // No submission found, but return participant basic info for new forms
        const participantResult = await pool.query(
          `SELECT first_name, last_name, date_naissance, id
           FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE p.id = $1 AND po.organization_id = $2`,
          [participant_id, organizationId]
        );

        if (participantResult.rows.length > 0) {
          const participant = participantResult.rows[0];
          const formData = {
            first_name: participant.first_name,
            last_name: participant.last_name,
            date_naissance: participant.date_naissance,
            participant_id: participant.id
          };

          res.json({
            success: true,
            data: null,
            form_data: formData,
            message: 'No submission found, returning participant basic info'
          });
        } else {
          res.json({ success: true, data: null, form_data: {}, message: 'No submission or participant found' });
        }
      }
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error fetching form submission:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/save-form-submission:
   *   post:
   *     summary: Save form submission
   *     description: Create or update a form submission for a participant
   *     tags: [Forms]
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
   *               - form_type
   *               - submission_data
   *             properties:
   *               participant_id:
   *                 type: integer
   *               form_type:
   *                 type: string
   *               submission_data:
   *                 type: object
   *     responses:
   *       200:
   *         description: Form saved successfully
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   */
  /**
   * @swagger
   * /api/v1/forms/submissions/needs-review:
   *   get:
   *     summary: List required forms waiting for a review
   *     description: >
   *       After a year transition the content of a form is kept but flagged so
   *       the parent re-reads it. Parents see their own children only; staff see
   *       the whole unit.
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Submissions waiting for a review
   */
  router.get('/submissions/needs-review', authenticate,
    asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const dataScope = await getUserDataScope(req, pool);
    const isStaff = dataScope === 'organization';

    // A unit-wide forms permission covers every form type; otherwise, only the
    // form types the unit let one of the account's roles view.
    let viewableTypes = null;
    if (!(await holdsAnyPermission(req.user.id, organizationId, FORM_READ_PERMISSIONS))) {
      const membership = await verifyOrganizationMembership(pool, req.user.id, organizationId);
      const formRights = await getFormPermissionsForRoles(pool, organizationId, membership.roles || []);
      viewableTypes = Object.keys(formRights).filter((formType) => formRights[formType].can_view);
    }

    const result = await pool.query(
      `SELECT fs.id,
              fs.participant_id,
              fs.form_type,
              fs.flagged_for_review_at,
              fs.last_reviewed_at,
              p.first_name,
              p.last_name,
              off.display_name,
              off.category
         FROM form_submissions fs
         JOIN participants p ON p.id = fs.participant_id
         JOIN participant_organizations po ON po.participant_id = fs.participant_id
          AND po.organization_id = fs.organization_id
         LEFT JOIN organization_form_formats off
           ON off.organization_id = fs.organization_id AND off.form_type = fs.form_type
        WHERE fs.organization_id = $1
          AND fs.review_state = 'needs_review'
          AND ($2 OR EXISTS (
                SELECT 1 FROM user_participants up
                 WHERE up.user_id = $3 AND up.participant_id = fs.participant_id
              ))
          AND ($4::text[] IS NULL OR fs.form_type = ANY($4::text[]))
        ORDER BY p.first_name, p.last_name, off.display_order NULLS LAST, fs.form_type`,
      [organizationId, isStaff, req.user.id, viewableTypes]
    );

    return success(res, result.rows);
    }));

  /**
   * @swagger
   * /api/v1/forms/submissions/{submissionId}/confirm-review:
   *   post:
   *     summary: Confirm a form is still accurate, without changing it
   *     description: >
   *       Clears the review flag and records when the form was last re-read.
   *       Confirming without editing is a valid answer, and a distinct fact from
   *       updated_at, which confirming never moves.
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Review recorded
   *       403:
   *         description: No access to this participant
   *       404:
   *         description: Submission not found
   */
  router.post('/submissions/:submissionId/confirm-review', authenticate, blockDemoRoles,
    asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const submissionId = parseIntegerId(req.params.submissionId);

    if (!submissionId) {
      return error(res, 'Invalid submission identifier', 400);
    }

    const existing = await pool.query(
      'SELECT id, participant_id, form_type FROM form_submissions WHERE id = $1 AND organization_id = $2',
      [submissionId, organizationId]
    );

    if (existing.rows.length === 0) {
      return error(res, 'Form submission not found', 404);
    }

    const { participant_id: participantId, form_type: formType } = existing.rows[0];
    const dataScope = await getUserDataScope(req, pool);

    if (dataScope === 'organization') {
      // Organization scope alone is not authority over a form: without this
      // check, any organization-scoped role could clear the review flag of any
      // participant and record itself as the reviewer.
      const membership = await verifyOrganizationMembership(pool, req.user.id, organizationId);
      const userRoles = membership.roles || [];
      const canEdit = await checkFormPermission(pool, organizationId, userRoles, formType, 'edit');
      const canSubmit = await checkFormPermission(pool, organizationId, userRoles, formType, 'submit');

      if (!canEdit && !canSubmit) {
        return error(res, 'You do not have permission to review this form type', 403);
      }
    } else {
      // A family confirms its own children's forms, on a form type it may
      // fill: a unit-wide forms permission, or the submit or edit right the
      // unit gave one of its roles on that form.
      const membership = await verifyOrganizationMembership(pool, req.user.id, organizationId);
      const userRoles = membership.roles || [];
      const mayConfirm = await holdsAnyPermission(req.user.id, organizationId, FORM_READ_PERMISSIONS)
        || await checkFormPermission(pool, organizationId, userRoles, formType, 'submit')
        || await checkFormPermission(pool, organizationId, userRoles, formType, 'edit');
      if (!mayConfirm) {
        return error(res, 'You do not have permission to review this form type', 403);
      }

      const accessCheck = await pool.query(
        'SELECT 1 FROM user_participants WHERE user_id = $1 AND participant_id = $2',
        [req.user.id, participantId]
      );
      if (accessCheck.rows.length === 0) {
        return error(res, 'Access denied to this participant', 403);
      }
    }

    const result = await pool.query(
      `UPDATE form_submissions
          SET review_state = 'current',
              flagged_for_review_at = NULL,
              last_reviewed_at = now(),
              last_reviewed_by = $3::uuid
        WHERE id = $1 AND organization_id = $2
        RETURNING id, participant_id, form_type, review_state, last_reviewed_at`,
      [submissionId, organizationId, req.user.id]
    );

    logger.info(`Form submission ${submissionId} confirmed as reviewed by ${req.user.id}`);

    return success(res, result.rows[0], 'Form confirmed as up to date');
    }));

  router.post('/submissions', authenticate, blockDemoRoles, asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization and get their roles
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { form_type, submission_data, status } = req.body;
      const participant_id = parseIntegerId(req.body.participant_id);

      if (!participant_id || !form_type || !submission_data) {
        return res.status(400).json({ success: false, message: 'Participant ID, form_type, and submission_data are required' });
      }

      // Check if user has permission to submit/edit this form type
      const userRoles = authCheck.roles || [];
      const canSubmit = await checkFormPermission(pool, organizationId, userRoles, form_type, 'submit');
      const canEdit = await checkFormPermission(pool, organizationId, userRoles, form_type, 'edit');

      if (!canSubmit && !canEdit) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to submit or edit this form type'
        });
      }

      // The right to fill a form type is not a right over every child's copy:
      // a family writes only the forms of its own children.
      if (!(await mayReachParticipant(decoded.user_id, organizationId, participant_id))) {
        return res.status(403).json({ success: false, message: 'Access denied to this participant' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get the current active version for this form type
        const versionResult = await client.query(
          `SELECT ffv.id as version_id
           FROM organization_form_formats off
           JOIN form_format_versions ffv ON off.current_version_id = ffv.id
           WHERE off.organization_id = $1 AND off.form_type = $2 AND ffv.is_active = true`,
          [organizationId, form_type]
        );

        const formVersionId = versionResult.rows.length > 0 ? versionResult.rows[0].version_id : null;

        // Get client IP and user agent for audit trail
        const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress || null;
        const userAgent = req.headers['user-agent'] || null;

        // Check if a submission already exists
        const existingResult = await client.query(
          `SELECT id FROM form_submissions
           WHERE participant_id = $1 AND organization_id = $2 AND form_type = $3`,
          [participant_id, organizationId, form_type]
        );

        let result;
        const submissionStatus = status || 'submitted';

        if (existingResult.rows.length > 0) {
          // Update existing submission
          result = await client.query(
            `UPDATE form_submissions
             SET submission_data = $1::jsonb,
                 updated_at = NOW(),
                 user_id = $2::uuid,
                 form_version_id = COALESCE($3::integer, form_version_id),
                 status = $4::varchar,
                 submitted_at = CASE WHEN $4::varchar = 'submitted' AND submitted_at IS NULL THEN NOW() ELSE submitted_at END,
                 ip_address = $5,
                 user_agent = $6,
                 review_state = 'current',
                 flagged_for_review_at = NULL,
                 last_reviewed_at = NOW(),
                 last_reviewed_by = $2::uuid
             WHERE participant_id = $7 AND organization_id = $8 AND form_type = $9
             RETURNING *`,
            [JSON.stringify(submission_data), decoded.user_id, formVersionId, submissionStatus,
              ipAddress, userAgent, participant_id, organizationId, form_type]
          );
        } else {
          // Insert new submission
          result = await client.query(
            `INSERT INTO form_submissions
             (participant_id, organization_id, form_type, submission_data, user_id,
              form_version_id, status, submitted_at, ip_address, user_agent)
             VALUES ($1, $2, $3, $4::jsonb, $5::uuid, $6::integer, $7::varchar,
                     CASE WHEN $7::varchar = 'submitted' THEN NOW() ELSE NULL END, $8, $9)
             RETURNING *`,
            [participant_id, organizationId, form_type, JSON.stringify(submission_data),
              decoded.user_id, formVersionId, submissionStatus, ipAddress, userAgent]
          );
        }

        await client.query('COMMIT');
        logger.info(`Form ${form_type} saved for participant ${participant_id} (status: ${submissionStatus})`);

        // Include cache invalidation hint in response
        res.json({
          success: true,
          data: result.rows[0],
          message: 'Form saved successfully',
          cache: { invalidate: ['forms', 'form-submissions', form_type] }
        });
      } catch (err) {
        if (handleOrganizationResolutionError(res, err, logger)) {
          return;
        }
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error saving form submission:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/v1/forms/submissions:
   *   delete:
   *     summary: Delete form submission
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   */
  router.delete('/submissions', authenticate, blockDemoRoles, asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const form_type = req.query.form_type || req.body?.form_type;
      const participant_id = parseIntegerId(req.query.participant_id || req.body?.participant_id);

      if (!participant_id || !form_type) {
        return res.status(400).json({ success: false, message: 'Participant ID and form_type are required' });
      }

      const userRoles = authCheck.roles || [];
      const canManage = await checkFormPermission(pool, organizationId, userRoles, form_type, 'edit');

      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete this form type'
        });
      }

      if (!(await mayReachParticipant(decoded.user_id, organizationId, participant_id))) {
        return res.status(403).json({ success: false, message: 'Access denied to this participant' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `DELETE FROM form_submissions
           WHERE participant_id = $1 AND organization_id = $2 AND form_type = $3`,
          [participant_id, organizationId, form_type]
        );

        await client.query('COMMIT');

        res.json({
          success: true,
          message: 'Form submission deleted successfully',
          cache: { invalidate: ['forms', 'form-submissions', form_type] }
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error deleting form submission:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/form-structure:
   *   get:
   *     summary: Get form structure for a specific form type
   *     description: Retrieve the structure/schema for a specific form type
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: form_type
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Form structure
   *       400:
   *         description: Form type is required
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Form structure not found
   */
  router.get('/structure/:form_type', authenticate, asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { form_type } = req.params;

      if (!form_type) {
        return res.status(400).json({ success: false, message: 'Form type is required' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        "SELECT form_structure FROM organization_form_formats WHERE form_type = $1 AND organization_id = $2",
        [form_type, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Form structure not found' });
      }

      res.json({
        success: true,
        // PostgreSQL JSONB values are normally decoded by `pg` already, while
        // some test and compatibility adapters still return JSON strings.
        data: parseFormSchema(result.rows[0].form_structure)
      });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error fetching form structure:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/form-submissions-list:
   *   get:
   *     summary: Get form submissions for a specific form type
   *     description: Retrieve all submissions or a specific participant's submission for a form type
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: form_type
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: participant_id
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Form submissions
   *       400:
   *         description: Form type is required
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: No submission data found
   */
  router.get('/submissions/list', authenticate, asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { form_type } = req.query;
      const hasParticipant = req.query.participant_id !== undefined;
      const participant_id = hasParticipant ? parseIntegerId(req.query.participant_id) : null;

      if (!form_type || typeof form_type !== 'string') {
        return res.status(400).json({ success: false, message: 'Form type is required' });
      }
      if (hasParticipant && !participant_id) {
        return res.status(400).json({ success: false, message: 'Invalid participant ID' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }
      if (!(await mayReadFormType(decoded.user_id, organizationId, authCheck.roles || [], form_type))) {
        return refuseFormType(res, 'view');
      }

      if (participant_id) {
        if (!(await mayReachParticipant(decoded.user_id, organizationId, participant_id))) {
          return res.status(403).json({ success: false, message: 'Access denied to this participant' });
        }

        const result = await pool.query(
          "SELECT submission_data FROM form_submissions WHERE participant_id = $1 AND form_type = $2 AND organization_id = $3",
          [participant_id, form_type, organizationId]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'No submission data found' });
        }

        const submissionData = result.rows[0].submission_data;
        res.json({
          success: true,
          data: typeof submissionData === 'string' ? JSON.parse(submissionData) : submissionData
        });
      } else {
        // The unit's list, or only the account's own children when it does
        // not see the whole unit.
        const unitWide = await seesWholeUnit(decoded.user_id, organizationId);
        const result = await pool.query(
          `SELECT fs.participant_id, fs.submission_data, p.first_name, p.last_name
           FROM form_submissions fs
           JOIN participant_organizations po ON fs.participant_id = po.participant_id
           JOIN participants p ON fs.participant_id = p.id
           WHERE po.organization_id = $1 AND fs.form_type = $2
             AND fs.organization_id = $1
             AND ($3::boolean OR EXISTS (
                   SELECT 1 FROM user_participants up
                    WHERE up.user_id = $4 AND up.participant_id = fs.participant_id
                 ))
           ORDER BY p.first_name, p.last_name`,
          [organizationId, form_type, unitWide, decoded.user_id]
        );

        res.json({
          success: true,
          data: result.rows.map(row => ({
            participant_id: row.participant_id,
            first_name: row.first_name,
            last_name: row.last_name,
            submission_data: typeof row.submission_data === 'string'
              ? JSON.parse(row.submission_data)
              : row.submission_data
          }))
        });
      }
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error fetching form submissions:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/risk-acceptance:
   *   get:
   *     summary: Get risk acceptance for a participant
   *     description: Retrieve risk acceptance/waiver information for a participant
   *     tags: [Forms]
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
   *         description: Risk acceptance data
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Risk acceptance not found
   */
  router.get('/risk-acceptance', authenticate, asyncHandler(async (req, res) => {
    try {
      const participantId = Number(req.query.participant_id);
      if (!Number.isSafeInteger(participantId) || participantId <= 0) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const access = await resolveParticipantFormAccess(req, participantId);
      if (!access) return error(res, 'Risk acceptance not found', 404);

      const result = await pool.query(
        `SELECT submission_data
         FROM form_submissions
         WHERE participant_id = $1 AND organization_id = $2
           AND form_type = 'acceptation_risque'
         ORDER BY updated_at DESC
         LIMIT 1`,
        [participantId, access.organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Risk acceptance not found' });
      }

      res.json({
        success: true,
        data: { participant_id: participantId, ...result.rows[0].submission_data }
      });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error fetching risk acceptance:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/risk-acceptance:
   *   post:
   *     summary: Save risk acceptance for a participant
   *     description: Create or update risk acceptance/waiver for a participant
   *     tags: [Forms]
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
   *             properties:
   *               participant_id:
   *                 type: integer
   *               groupe_district:
   *                 type: string
   *               accepte_risques:
   *                 type: boolean
   *               accepte_covid19:
   *                 type: boolean
   *               participation_volontaire:
   *                 type: boolean
   *               declaration_sante:
   *                 type: boolean
   *               declaration_voyage:
   *                 type: boolean
   *               nom_parent_tuteur:
   *                 type: string
   *               date_signature:
   *                 type: string
   *                 format: date
   *     responses:
   *       200:
   *         description: Risk acceptance saved
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   */
  router.post('/risk-acceptance', authenticate, blockDemoRoles, asyncHandler(async (req, res) => {
    try {
      // The COVID-19, fourteen-day-symptom and travel-outside-Canada
      // declarations were dropped when this form was aligned with the current
      // ASC form, so they are no longer read or stored. Answers already recorded
      // against them stay in the stored JSON of past submissions.
      const {
        participant_id,
        groupe_district,
        accepte_risques,
        participation_volontaire,
        nom_parent_tuteur,
        date_signature
      } = req.body;

      const participantId = Number(participant_id);
      if (!Number.isSafeInteger(participantId) || participantId <= 0) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const access = await resolveParticipantFormAccess(req, participantId);
      if (!access) return error(res, 'Risk acceptance not found', 404);

      const submissionData = {
        participant_id: participantId,
        groupe_district,
        accepte_risques: Boolean(accepte_risques),
        participation_volontaire: Boolean(participation_volontaire),
        nom_parent_tuteur,
        date_signature
      };

      const result = await pool.query(
        `INSERT INTO form_submissions
           (participant_id, organization_id, form_type, submission_data,
            user_id, scout_year_id, status, submitted_at)
         VALUES ($1, $2, 'acceptation_risque', $3::jsonb, $4, $5, 'submitted', NOW())
         ON CONFLICT (participant_id, form_type, organization_id)
         DO UPDATE SET submission_data = EXCLUDED.submission_data,
                       user_id = EXCLUDED.user_id,
                       scout_year_id = EXCLUDED.scout_year_id,
                       status = 'submitted',
                       submitted_at = NOW(),
                       updated_at = NOW(),
                       review_state = 'current',
                       flagged_for_review_at = NULL
         RETURNING submission_data`,
        [participantId, access.organizationId, JSON.stringify(submissionData),
          req.user.id, access.scoutYearId]
      );

      res.json({ success: true, data: result.rows[0].submission_data });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error saving risk acceptance:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/form-submission-history/{submissionId}:
   *   get:
   *     summary: Get audit trail for a form submission
   *     description: Retrieve the complete history of changes for a form submission
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: submissionId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Submission history retrieved
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Access denied
   */
  router.get('/form-submission-history/:submissionId', authenticate, asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const submissionId = parseIntegerId(req.params.submissionId);
      if (!submissionId) {
        return res.status(400).json({ success: false, message: 'Invalid submission ID' });
      }

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      // Verify the submission belongs to this organization
      const submissionCheck = await pool.query(
        'SELECT organization_id, participant_id, form_type FROM form_submissions WHERE id = $1',
        [submissionId]
      );

      if (submissionCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Submission not found' });
      }

      const submission = submissionCheck.rows[0];
      if (submission.organization_id !== organizationId) {
        return res.status(403).json({ success: false, message: 'Access denied to this submission' });
      }
      if (!(await mayReadFormType(decoded.user_id, organizationId, authCheck.roles || [], submission.form_type))) {
        return refuseFormType(res, 'view');
      }
      if (!(await mayReachParticipant(decoded.user_id, organizationId, submission.participant_id))) {
        return res.status(403).json({ success: false, message: 'Access denied to this participant' });
      }

      // Get the history
      const result = await pool.query(
        `SELECT
           fsh.id,
           fsh.submission_data,
           fsh.status,
           fsh.edited_at,
           fsh.change_reason,
           fsh.changes_summary,
           u.full_name as edited_by_name,
           u.email as edited_by_email
         FROM form_submission_history fsh
         LEFT JOIN users u ON fsh.edited_by = u.id
         WHERE fsh.form_submission_id = $1
         ORDER BY fsh.edited_at DESC`,
        [submissionId]
      );

      res.json({ success: true, data: result.rows });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error fetching submission history:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/form-submission-status:
   *   put:
   *     summary: Update form submission status
   *     description: Approve, reject, or change status of a form submission
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - submission_id
   *               - status
   *             properties:
   *               submission_id:
   *                 type: integer
   *               status:
   *                 type: string
   *                 enum: [draft, submitted, reviewed, approved, rejected]
   *               review_notes:
   *                 type: string
   *     responses:
   *       200:
   *         description: Status updated successfully
   *       401:
   *         description: Unauthorized
   */
  router.put('/form-submission-status', authenticate, blockDemoRoles, asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { submission_id, status, review_notes } = req.body;

      if (!submission_id || !status) {
        return res.status(400).json({ success: false, message: 'submission_id and status are required' });
      }

      // Validate status
      const validStatuses = ['draft', 'submitted', 'reviewed', 'approved', 'rejected'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status value' });
      }

      const submissionId = parseIntegerId(submission_id);
      if (!submissionId) {
        return res.status(400).json({ success: false, message: 'Invalid submission ID' });
      }

      const existing = await pool.query(
        'SELECT participant_id, form_type FROM form_submissions WHERE id = $1 AND organization_id = $2',
        [submissionId, organizationId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Submission not found' });
      }

      // Setting a review status is a reviewer's act: forms.manage, or the
      // approve right the unit gave one of the account's roles on this form.
      const { participant_id: participantId, form_type: formType } = existing.rows[0];
      const mayApprove = await holdsAnyPermission(decoded.user_id, organizationId, FORM_APPROVE_PERMISSIONS)
        || await checkFormPermission(pool, organizationId, authCheck.roles || [], formType, 'approve');
      if (!mayApprove) {
        return refuseFormType(res, 'approve');
      }
      if (!(await mayReachParticipant(decoded.user_id, organizationId, participantId))) {
        return res.status(403).json({ success: false, message: 'Access denied to this participant' });
      }

      const result = await pool.query(
        `UPDATE form_submissions
         SET status = $1,
             reviewed_by = $2,
             reviewed_at = NOW(),
             review_notes = COALESCE($3, review_notes),
             updated_at = NOW()
         WHERE id = $4 AND organization_id = $5
         RETURNING *`,
        [status, decoded.user_id, review_notes, submissionId, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Submission not found' });
      }

      logger.info(`Form submission ${submission_id} status changed to ${status} by ${decoded.user_id}`);

      res.json({
        success: true,
        data: result.rows[0],
        message: 'Status updated successfully',
        cache: { invalidate: ['form-submissions'] }
      });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error updating submission status:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/form-versions/{formType}:
   *   get:
   *     summary: Get all versions of a form
   *     description: Retrieve version history for a specific form type
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: formType
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Form versions retrieved
   *       401:
   *         description: Unauthorized
   */
  router.get('/form-versions/:formType', authenticate, asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const formType = req.params.formType;

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const result = await pool.query(
        `SELECT
           ffv.id,
           ffv.version_number,
           ffv.form_structure,
           ffv.display_name,
           ffv.change_description,
           ffv.is_active,
           ffv.created_at,
           u.full_name as created_by_name,
           u.email as created_by_email,
           (SELECT COUNT(*) FROM form_submissions fs
            WHERE fs.form_version_id = ffv.id) as submission_count
         FROM form_format_versions ffv
         JOIN organization_form_formats off ON ffv.form_format_id = off.id
         LEFT JOIN users u ON ffv.created_by = u.id
         WHERE off.organization_id = $1 AND off.form_type = $2
         ORDER BY ffv.version_number DESC`,
        [organizationId, formType]
      );

      res.json({ success: true, data: result.rows });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error fetching form versions:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/form-permissions:
   *   get:
   *     summary: Get form permissions for all roles
   *     description: Retrieve form permissions matrix showing which roles can view/submit/edit/approve each form
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Form permissions retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions (requires forms.manage)
   */
  router.get('/form-permissions', authenticate, requirePermission('forms.manage'), asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization and has admin access
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      // Get all form permissions for this organization (including display_context)
      const result = await pool.query(
        `SELECT
           off.id AS form_format_id,
           off.form_type,
           off.display_name,
           off.display_context,
           r.id AS role_id,
           r.role_name,
           r.display_name AS role_display_name,
           COALESCE(fp.can_view, false) AS can_view,
           COALESCE(fp.can_submit, false) AS can_submit,
           COALESCE(fp.can_edit, false) AS can_edit,
           COALESCE(fp.can_approve, false) AS can_approve,
           fp.id AS permission_id
         FROM organization_form_formats off
         CROSS JOIN roles r
         LEFT JOIN form_permissions fp ON fp.form_format_id = off.id AND fp.role_id = r.id
         WHERE off.organization_id = $1
           -- the shared built-in roles and this unit's own (services/roleAssignment.js)
           AND (r.organization_id = $1 OR (r.organization_id IS NULL AND r.is_system_role))
         ORDER BY off.form_type, r.role_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error fetching form permissions:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/form-display-context:
   *   put:
   *     summary: Update form display context
   *     description: Update the display contexts where a form should appear (admin only)
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - form_format_id
   *               - display_context
   *             properties:
   *               form_format_id:
   *                 type: integer
   *               display_context:
   *                 type: array
   *                 items:
   *                   type: string
   *                   enum: [participant, organization, admin_panel, public, form_builder]
   *     responses:
   *       200:
   *         description: Display context updated successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.put('/form-display-context', authenticate, blockDemoRoles, requirePermission('forms.manage'), asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization and has admin access
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { form_format_id, display_context } = req.body;

      if (!form_format_id || !Array.isArray(display_context)) {
        return res.status(400).json({
          success: false,
          message: 'form_format_id and display_context array are required'
        });
      }

      // Validate display_context values
      const validContexts = ['participant', 'organization', 'admin_panel', 'public', 'form_builder'];
      const invalidContexts = display_context.filter(ctx => !validContexts.includes(ctx));
      if (invalidContexts.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid context values: ${invalidContexts.join(', ')}`
        });
      }

      // Verify the form belongs to this organization
      const formCheck = await pool.query(
        'SELECT organization_id, form_type FROM organization_form_formats WHERE id = $1',
        [form_format_id]
      );

      if (formCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Form not found' });
      }

      if (formCheck.rows[0].organization_id !== organizationId) {
        return res.status(403).json({ success: false, message: 'Access denied to this form' });
      }

      // Update the display_context
      const result = await pool.query(
        `UPDATE organization_form_formats
         SET display_context = $1
         WHERE id = $2
         RETURNING *`,
        [display_context, form_format_id]
      );

      logger.info(`User ${decoded.user_id} updated display context for form ${formCheck.rows[0].form_type}`);

      res.json({
        success: true,
        data: result.rows[0],
        message: 'Display context updated successfully'
      });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error updating form display context:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  /**
   * @swagger
   * /api/form-permissions:
   *   put:
   *     summary: Update form permissions
   *     description: Update permissions for a specific form and role combination
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - form_format_id
   *               - role_id
   *             properties:
   *               form_format_id:
   *                 type: integer
   *               role_id:
   *                 type: integer
   *               can_view:
   *                 type: boolean
   *               can_submit:
   *                 type: boolean
   *               can_edit:
   *                 type: boolean
   *               can_approve:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Permissions updated successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.put('/form-permissions', authenticate, blockDemoRoles, requirePermission('forms.manage'), asyncHandler(async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization and has admin access
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { form_format_id, role_id, can_view, can_submit, can_edit, can_approve } = req.body;

      if (!form_format_id || !role_id) {
        return res.status(400).json({
          success: false,
          message: 'form_format_id and role_id are required'
        });
      }

      // Verify the form belongs to this organization
      const formCheck = await pool.query(
        'SELECT organization_id FROM organization_form_formats WHERE id = $1',
        [form_format_id]
      );

      if (formCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Form not found' });
      }

      if (formCheck.rows[0].organization_id !== organizationId) {
        return res.status(403).json({ success: false, message: 'Access denied to this form' });
      }

      // The role must be one this unit may use.
      if ((await findRolesInUnit(pool, [role_id], organizationId)).length === 0) {
        return res.status(404).json({ success: false, message: 'Role not found' });
      }

      // Upsert the permission
      const result = await pool.query(
        `INSERT INTO form_permissions (form_format_id, role_id, can_view, can_submit, can_edit, can_approve)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (form_format_id, role_id)
         DO UPDATE SET
           can_view = EXCLUDED.can_view,
           can_submit = EXCLUDED.can_submit,
           can_edit = EXCLUDED.can_edit,
           can_approve = EXCLUDED.can_approve
         RETURNING *`,
        [form_format_id, role_id, can_view || false, can_submit || false, can_edit || false, can_approve || false]
      );

      logger.info(`User ${decoded.user_id} updated form permissions for form ${form_format_id} and role ${role_id}`);

      res.json({
        success: true,
        data: result.rows[0],
        message: 'Permissions updated successfully'
      });
    } catch (err) {
      if (handleOrganizationResolutionError(res, err, logger)) {
        return;
      }
      logger.error('Error updating form permissions:', err);
      return error(res, 'internal_server_error', 500);
    }
  }));

  // ---- Parameterized /:id routes MUST be last to avoid shadowing literal paths ----

  router.get('/:id', authenticate, requireAnyPermission('forms.view', 'forms.manage'), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);
      const formId = Number.parseInt(req.params.id, 10);

      if (!Number.isInteger(formId) || !/^\d+$/.test(req.params.id)) {
        return error(res, 'Form not found', 404);
      }

      const result = await pool.query(
        `SELECT id, name, type, version, organization_id, schema, is_active, created_at, updated_at
         FROM forms
         WHERE id = $1 AND organization_id = $2`,
        [formId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Form not found', 404);
      }

      return success(res, {
        ...result.rows[0],
        schema: parseFormSchema(result.rows[0].schema)
      }, 'Form loaded');
    } catch (err) {
      logger.error('Error loading form:', err);
      return error(res, 'Unable to load form', 500);
    }
  }));

  router.post('/:id/submit', authenticate, blockDemoRoles, requireAnyPermission('forms.submit', 'forms.manage'), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);
      const formId = Number.parseInt(req.params.id, 10);
      const { participant_id, data } = req.body || {};

      if (!participant_id || !data || typeof data !== 'object' || Array.isArray(data)) {
        return error(res, 'participant_id and data are required', 400);
      }

      const formResult = await pool.query(
        'SELECT id, schema FROM forms WHERE id = $1 AND organization_id = $2',
        [formId, organizationId]
      );

      if (formResult.rows.length === 0) {
        return error(res, 'Form not found', 404);
      }

      const schema = parseFormSchema(formResult.rows[0].schema);
      const requiredFields = (schema.fields || []).filter((field) => field.required).map((field) => field.name);
      const missing = requiredFields.filter((fieldName) => !Object.prototype.hasOwnProperty.call(data, fieldName));
      if (missing.length > 0) {
        return error(res, `Missing required fields: ${missing.join(', ')}`, 400);
      }

      // Without a unit-wide role, only a child linked to the account
      if ((await getUserDataScope(req, pool)) !== 'organization') {
        const childAccess = await pool.query(
          'SELECT 1 FROM user_participants WHERE user_id = $1 AND participant_id = $2',
          [req.user.id, participant_id]
        );

        if (childAccess.rows.length === 0) {
          return error(res, 'Access denied', 403);
        }
      }

      const result = await pool.query(
        `INSERT INTO form_submissions (form_id, participant_id, organization_id, data, status, submitted_by, submitted_at)
         VALUES ($1, $2, $3, $4, 'submitted', $5, NOW())
         RETURNING id, form_id, participant_id, organization_id, data, status, submitted_at`,
        [formId, participant_id, organizationId, JSON.stringify(data), req.user.id]
      );

      return success(res, result.rows[0], 'Form submitted', 201);
    } catch (err) {
      logger.error('Error submitting form:', err);
      return error(res, 'Unable to submit form', 500);
    }
  }));

  router.get('/:id/submissions', authenticate, requireAnyPermission('forms.view', 'forms.manage'), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);
      const formId = Number.parseInt(req.params.id, 10);
      const { status } = req.query;
      const params = [formId, organizationId];
      let whereClause = 'WHERE form_id = $1 AND organization_id = $2';

      if (status) {
        params.push(status);
        whereClause += ` AND status = $${params.length}`;
      }

      const result = await pool.query(
        `SELECT id, form_id, participant_id, organization_id, data, status, submitted_at, approved_at, approved_by, approved_notes
         FROM form_submissions
         ${whereClause}
         ORDER BY submitted_at DESC`,
        params
      );

      return success(res, result.rows.map((submission) => ({
        ...submission,
        data: parseFormSchema(submission.data)
      })), 'Form submissions loaded');
    } catch (err) {
      logger.error('Error loading form submissions:', err);
      return error(res, 'Unable to load submissions', 500);
    }
  }));

  router.put('/:id/submissions/:submissionId/approve', authenticate, blockDemoRoles, requirePermission('forms.manage'), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);
      const formId = Number.parseInt(req.params.id, 10);
      const submissionId = Number.parseInt(req.params.submissionId, 10);
      const { approved_notes } = req.body || {};

      const result = await pool.query(
        `UPDATE form_submissions SET status = 'approved', approved_at = NOW(), approved_by = $1, approved_notes = $2
         WHERE id = $3 AND form_id = $4 AND organization_id = $5
         RETURNING id, form_id, participant_id, status, approved_at, approved_by, approved_notes`,
        [req.user.id, approved_notes || null, submissionId, formId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Submission not found', 404);
      }

      return success(res, result.rows[0], 'Submission approved');
    } catch (err) {
      logger.error('Error approving form submission:', err);
      return error(res, 'Unable to approve submission', 500);
    }
  }));

  return router;
};
