/**
 * Form Routes
 *
 * Handles form submissions, form structures, risk acceptance, and health forms
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/forms
 */

const express = require('express');
const router = express.Router();
const { authenticate, getOrganizationId } = require('../middleware/auth');
const { success, error } = require('../middleware/response');

// Import utilities
const { getCurrentOrganizationId, verifyJWT, handleOrganizationResolutionError, verifyOrganizationMembership, getFormPermissionsForRoles, checkFormPermission } = require('../utils/api-helpers');
const { hasStaffRole } = require('../config/role-constants');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with form routes
 */
module.exports = (pool, logger) => {
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


  const hasAnyPermission = (req, required = []) => {
    const granted = Array.isArray(req?.user?.permissions) ? req.user.permissions : [];
    if (required.length === 0) {
      return true;
    }
    return required.some((perm) => granted.includes(perm));
  };

  // Compatibility REST endpoints used by comprehensive API tests
  router.get('/', authenticate, async (req, res) => {
    try {
      if (!hasAnyPermission(req, ['forms.view', 'forms.manage'])) {
        return error(res, 'Forbidden', 403);
      }
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
  });

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
  router.get('/types', async (req, res) => {
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
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form types:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  router.post('/', authenticate, async (req, res) => {
    try {
      if (!hasAnyPermission(req, ['forms.manage'])) {
        return error(res, 'Forbidden', 403);
      }
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
  });

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
  router.get('/formats', async (req, res) => {
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
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form formats:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.get('/submissions', async (req, res) => {
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

      const { participant_id, form_type } = req.query;

      if (!participant_id || !form_type) {
        return res.status(400).json({ success: false, message: 'Participant ID and form_type are required' });
      }

      // Get user's roles for access control
      const rolesQuery = `
        SELECT DISTINCT r.role_name
        FROM user_organizations uo
        CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
        JOIN roles r ON r.id = role_id_text::integer
        WHERE uo.user_id = $1 AND uo.organization_id = $2
      `;
      const rolesResult = await pool.query(rolesQuery, [decoded.user_id, organizationId]);
      const userRoles = rolesResult.rows.map(row => row.role_name);

      // Staff roles can access all participants in their organization
      // Parent roles can only access participants they're linked to
      // Use centralized role constants instead of hardcoded arrays
      const hasStaffAccess = hasStaffRole(userRoles);

      // Only restrict access for non-staff users (parents)
      if (!hasStaffAccess) {
        // For parent/demoparent roles, check if they have access to this participant
        const accessCheck = await pool.query(
          `SELECT 1 FROM user_participants
           WHERE user_id = $1 AND participant_id = $2`,
          [decoded.user_id, participant_id]
        );

        if (accessCheck.rows.length === 0) {
          return res.status(403).json({ success: false, message: 'Access denied to this participant' });
        }
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
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form submission:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.post('/submissions', async (req, res) => {
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

      const { participant_id, form_type, submission_data, status } = req.body;

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
                 user_agent = $6
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
      } catch (error) {
        if (handleOrganizationResolutionError(res, error, logger)) {
          return;
        }
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error saving form submission:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/v1/forms/submissions:
   *   delete:
   *     summary: Delete form submission
   *     tags: [Forms]
   *     security:
   *       - bearerAuth: []
   */
  router.delete('/submissions', async (req, res) => {
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

      const form_type = req.query.form_type || req.body.form_type;
      const participant_id = req.query.participant_id || req.body.participant_id;

      if (!participant_id || !form_type) {
        return res.status(400).json({ success: false, message: 'Participant ID and form_type are required' });
      }

      const userRoles = authCheck.roles || [];
      const canManage = await checkFormPermission(pool, organizationId, userRoles, form_type, 'edit');

      if (!canManage && !hasStaffRole(userRoles)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete this form type'
        });
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
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error deleting form submission:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.get('/structure/:form_type', async (req, res) => {
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
        data: JSON.parse(result.rows[0].form_structure)
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form structure:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.get('/submissions/list', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { form_type, participant_id } = req.query;

      if (!form_type) {
        return res.status(400).json({ success: false, message: 'Form type is required' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      if (participant_id) {
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
        const result = await pool.query(
          `SELECT fs.participant_id, fs.submission_data, p.first_name, p.last_name
           FROM form_submissions fs
           JOIN participant_organizations po ON fs.participant_id = po.participant_id
           JOIN participants p ON fs.participant_id = p.id
           WHERE po.organization_id = $1 AND fs.form_type = $2
           ORDER BY p.first_name, p.last_name`,
          [organizationId, form_type]
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
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form submissions:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.get('/risk-acceptance', async (req, res) => {
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

      const result = await pool.query(
        `SELECT * FROM acceptation_risque WHERE participant_id = $1`,
        [participant_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Risk acceptance not found' });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching risk acceptance:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.post('/risk-acceptance', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const {
        participant_id,
        groupe_district,
        accepte_risques,
        accepte_covid19,
        participation_volontaire,
        declaration_sante,
        declaration_voyage,
        nom_parent_tuteur,
        date_signature
      } = req.body;

      if (!participant_id) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const result = await pool.query(
        `INSERT INTO acceptation_risque
         (participant_id, groupe_district, accepte_risques, accepte_covid19,
          participation_volontaire, declaration_sante, declaration_voyage,
          nom_parent_tuteur, date_signature)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (participant_id)
         DO UPDATE SET
           groupe_district = EXCLUDED.groupe_district,
           accepte_risques = EXCLUDED.accepte_risques,
           accepte_covid19 = EXCLUDED.accepte_covid19,
           participation_volontaire = EXCLUDED.participation_volontaire,
           declaration_sante = EXCLUDED.declaration_sante,
           declaration_voyage = EXCLUDED.declaration_voyage,
           nom_parent_tuteur = EXCLUDED.nom_parent_tuteur,
           date_signature = EXCLUDED.date_signature
         RETURNING *`,
        [participant_id, groupe_district, accepte_risques, accepte_covid19,
          participation_volontaire, declaration_sante, declaration_voyage,
          nom_parent_tuteur, date_signature]
      );

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error saving risk acceptance:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/health-forms:
   *   post:
   *     summary: Save health form for a participant
   *     description: Create or update health form information for a participant
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
   *               nom_fille_mere:
   *                 type: string
   *               medecin_famille:
   *                 type: string
   *               nom_medecin:
   *                 type: string
   *               probleme_sante:
   *                 type: string
   *               allergie:
   *                 type: string
   *               epipen:
   *                 type: boolean
   *               medicament:
   *                 type: string
   *               limitation:
   *                 type: string
   *               vaccins_a_jour:
   *                 type: boolean
   *               blessures_operations:
   *                 type: string
   *               niveau_natation:
   *                 type: string
   *               doit_porter_vfi:
   *                 type: boolean
   *               regles:
   *                 type: string
   *               renseignee:
   *                 type: string
   *     responses:
   *       200:
   *         description: Health form saved successfully
   *       400:
   *         description: Missing participant_id
   *       401:
   *         description: Unauthorized
   */
  router.post('/health-forms', async (req, res) => {
    const client = await pool.connect();

    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const {
        participant_id,
        nom_fille_mere,
        medecin_famille,
        nom_medecin,
        probleme_sante,
        allergie,
        epipen,
        medicament,
        limitation,
        vaccins_a_jour,
        blessures_operations,
        niveau_natation,
        doit_porter_vfi,
        regles,
        renseignee
      } = req.body;

      if (!participant_id) {
        return res.status(400).json({ success: false, message: 'Missing participant_id' });
      }

      await client.query('BEGIN');

      // Check if health form already exists
      const checkResult = await client.query(
        'SELECT id FROM fiche_sante WHERE participant_id = $1',
        [participant_id]
      );

      const exists = checkResult.rows.length > 0;

      if (exists) {
        // Update existing record
        await client.query(
          `UPDATE fiche_sante SET
            nom_fille_mere = $1,
            medecin_famille = $2,
            nom_medecin = $3,
            probleme_sante = $4,
            allergie = $5,
            epipen = $6,
            medicament = $7,
            limitation = $8,
            vaccins_a_jour = $9,
            blessures_operations = $10,
            niveau_natation = $11,
            doit_porter_vfi = $12,
            regles = $13,
            renseignee = $14,
            updated_at = NOW()
           WHERE participant_id = $15`,
          [
            nom_fille_mere, medecin_famille, nom_medecin, probleme_sante,
            allergie, epipen, medicament, limitation, vaccins_a_jour,
            blessures_operations, niveau_natation, doit_porter_vfi,
            regles, renseignee, participant_id
          ]
        );
      } else {
        // Insert new record
        await client.query(
          `INSERT INTO fiche_sante
           (nom_fille_mere, medecin_famille, nom_medecin, probleme_sante, allergie,
            epipen, medicament, limitation, vaccins_a_jour, blessures_operations,
            niveau_natation, doit_porter_vfi, regles, renseignee, participant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            nom_fille_mere, medecin_famille, nom_medecin, probleme_sante,
            allergie, epipen, medicament, limitation, vaccins_a_jour,
            blessures_operations, niveau_natation, doit_porter_vfi,
            regles, renseignee, participant_id
          ]
        );
      }

      await client.query('COMMIT');

      res.json({ success: true, message: 'Health form saved successfully' });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      await client.query('ROLLBACK');
      logger.error('Error saving health form:', error);
      res.status(500).json({ success: false, message: 'Error saving health form: ' + error.message });
    } finally {
      client.release();
    }
  });

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
  router.get('/form-submission-history/:submissionId', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const submissionId = parseInt(req.params.submissionId, 10);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      // Verify the submission belongs to this organization
      const submissionCheck = await pool.query(
        'SELECT organization_id FROM form_submissions WHERE id = $1',
        [submissionId]
      );

      if (submissionCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Submission not found' });
      }

      if (submissionCheck.rows[0].organization_id !== organizationId) {
        return res.status(403).json({ success: false, message: 'Access denied to this submission' });
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
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching submission history:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.put('/form-submission-status', async (req, res) => {
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

      const result = await pool.query(
        `UPDATE form_submissions
         SET status = $1,
             reviewed_by = $2,
             reviewed_at = NOW(),
             review_notes = COALESCE($3, review_notes),
             updated_at = NOW()
         WHERE id = $4 AND organization_id = $5
         RETURNING *`,
        [status, decoded.user_id, review_notes, submission_id, organizationId]
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
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error updating submission status:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.get('/form-versions/:formType', async (req, res) => {
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
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form versions:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
   *         description: Insufficient permissions (requires district or unitadmin role)
   */
  router.get('/form-permissions', async (req, res) => {
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

      // Only district and unitadmin can manage form permissions
      const userRoles = authCheck.roles || [];
      if (!userRoles.includes('district') && !userRoles.includes('unitadmin')) {
        return res.status(403).json({
          success: false,
          message: 'Only district and unit administrators can manage form permissions'
        });
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
         ORDER BY off.form_type, r.role_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching form permissions:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.put('/form-display-context', async (req, res) => {
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

      // Only district and unitadmin can manage form display contexts
      const userRoles = authCheck.roles || [];
      if (!userRoles.includes('district') && !userRoles.includes('unitadmin')) {
        return res.status(403).json({
          success: false,
          message: 'Only district and unit administrators can manage form display contexts'
        });
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
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error updating form display context:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.put('/form-permissions', async (req, res) => {
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

      // Only district and unitadmin can manage form permissions
      const userRoles = authCheck.roles || [];
      if (!userRoles.includes('district') && !userRoles.includes('unitadmin')) {
        return res.status(403).json({
          success: false,
          message: 'Only district and unit administrators can manage form permissions'
        });
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
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error updating form permissions:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ---- Parameterized /:id routes MUST be last to avoid shadowing literal paths ----

  router.get('/:id', authenticate, async (req, res) => {
    try {
      if (!hasAnyPermission(req, ['forms.view', 'forms.manage'])) {
        return error(res, 'Forbidden', 403);
      }
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
  });

  router.post('/:id/submit', authenticate, async (req, res) => {
    try {
      if (!hasAnyPermission(req, ['forms.submit', 'forms.manage'])) {
        return error(res, 'Forbidden', 403);
      }
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

      const isParent = Array.isArray(req.user?.roleNames) && req.user.roleNames.includes('parent');
      if (isParent) {
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
  });

  router.get('/:id/submissions', authenticate, async (req, res) => {
    try {
      if (!hasAnyPermission(req, ['forms.view', 'forms.manage'])) {
        return error(res, 'Forbidden', 403);
      }
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
  });

  router.put('/:id/submissions/:submissionId/approve', authenticate, async (req, res) => {
    try {
      if (!hasAnyPermission(req, ['forms.manage'])) {
        return error(res, 'Forbidden', 403);
      }
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
  });

  return router;
};
