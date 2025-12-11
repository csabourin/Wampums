/**
 * Form Builder Routes
 *
 * Handles CRUD operations for form formats and translation management
 * All endpoints in this module are prefixed with /api
 *
 * Security Note: Rate limiting is applied globally via generalLimiter in api.js
 * All routes also require admin authentication via authenticate and authorize middleware
 *
 * @module routes/formBuilder
 */

const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate, authorize } = require('../middleware/auth');
const { success, error: errorResponse } = require('../middleware/response');

// Import utilities
const { getCurrentOrganizationId, verifyJWT, verifyOrganizationMembership, handleOrganizationResolutionError } = require('../utils/api-helpers');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with form builder routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/form-formats:
   *   get:
   *     summary: Get all form formats for organization
   *     description: Retrieve all form formats configured for the organization (admin only)
   *     tags: [Form Builder]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Form formats retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/form-formats', authenticate, authorize('admin'), async (req, res) => {
    try {
      const organizationId = req.user.organizationId;

      const result = await pool.query(
        `SELECT id, form_type, form_structure, display_type, created_at, updated_at
         FROM organization_form_formats
         WHERE organization_id = $1
         ORDER BY form_type`,
        [organizationId]
      );

      return success(res, result.rows);
    } catch (error) {
      logger.error('Error fetching form formats:', error);
      return errorResponse(res, 'Failed to fetch form formats', 500);
    }
  });

  /**
   * @swagger
   * /api/form-formats/{id}:
   *   get:
   *     summary: Get specific form format by ID
   *     description: Retrieve a specific form format (admin only)
   *     tags: [Form Builder]
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
   *         description: Form format retrieved successfully
   *       404:
   *         description: Form format not found
   */
  router.get('/form-formats/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
      const organizationId = req.user.organizationId;
      const formFormatId = parseInt(req.params.id, 10);

      const result = await pool.query(
        `SELECT id, form_type, form_structure, display_type, created_at, updated_at
         FROM organization_form_formats
         WHERE id = $1 AND organization_id = $2`,
        [formFormatId, organizationId]
      );

      if (result.rows.length === 0) {
        return errorResponse(res, 'Form format not found', 404);
      }

      return success(res, result.rows[0]);
    } catch (error) {
      logger.error('Error fetching form format:', error);
      return errorResponse(res, 'Failed to fetch form format', 500);
    }
  });

  /**
   * @swagger
   * /api/form-formats:
   *   post:
   *     summary: Create new form format
   *     description: Create a new form format for the organization (admin only)
   *     tags: [Form Builder]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - form_type
   *               - form_structure
   *             properties:
   *               form_type:
   *                 type: string
   *               form_structure:
   *                 type: object
   *               display_type:
   *                 type: string
   *     responses:
   *       201:
   *         description: Form format created successfully
   *       400:
   *         description: Invalid input
   */
  router.post('/form-formats', authenticate, authorize('admin'), async (req, res) => {
    try {
      const organizationId = req.user.organizationId;
      const { form_type, form_structure, display_type } = req.body;

      // Validate required fields
      if (!form_type || !form_structure) {
        return errorResponse(res, 'form_type and form_structure are required', 400);
      }

      // Validate form_structure has fields array
      if (!form_structure.fields || !Array.isArray(form_structure.fields)) {
        return errorResponse(res, 'form_structure must have a fields array', 400);
      }

      // Check if form type already exists for this organization
      const existingCheck = await pool.query(
        `SELECT id FROM organization_form_formats
         WHERE organization_id = $1 AND form_type = $2`,
        [organizationId, form_type]
      );

      if (existingCheck.rows.length > 0) {
        return errorResponse(res, 'Form type already exists for this organization', 409);
      }

      const result = await pool.query(
        `INSERT INTO organization_form_formats
         (organization_id, form_type, form_structure, display_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING id, form_type, form_structure, display_type, created_at, updated_at`,
        [organizationId, form_type, JSON.stringify(form_structure), display_type || null]
      );

      logger.info(`Form format created: ${form_type} for organization ${organizationId}`);
      return success(res, result.rows[0], 'Form format created successfully', 201);
    } catch (error) {
      logger.error('Error creating form format:', error);
      return errorResponse(res, 'Failed to create form format', 500);
    }
  });

  /**
   * @swagger
   * /api/form-formats/{id}:
   *   put:
   *     summary: Update form format
   *     description: Update an existing form format (admin only)
   *     tags: [Form Builder]
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
   *               form_structure:
   *                 type: object
   *               display_type:
   *                 type: string
   *     responses:
   *       200:
   *         description: Form format updated successfully
   *       404:
   *         description: Form format not found
   */
  router.put('/form-formats/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
      const organizationId = req.user.organizationId;
      const formFormatId = parseInt(req.params.id, 10);
      const { form_structure, display_type } = req.body;

      // Validate form_structure if provided
      if (form_structure) {
        if (!form_structure.fields || !Array.isArray(form_structure.fields)) {
          return errorResponse(res, 'form_structure must have a fields array', 400);
        }
      }

      // Check if form format exists and belongs to organization
      const existingCheck = await pool.query(
        `SELECT id FROM organization_form_formats
         WHERE id = $1 AND organization_id = $2`,
        [formFormatId, organizationId]
      );

      if (existingCheck.rows.length === 0) {
        return errorResponse(res, 'Form format not found', 404);
      }

      const result = await pool.query(
        `UPDATE organization_form_formats
         SET form_structure = COALESCE($1, form_structure),
             display_type = COALESCE($2, display_type),
             updated_at = NOW()
         WHERE id = $3 AND organization_id = $4
         RETURNING id, form_type, form_structure, display_type, created_at, updated_at`,
        [
          form_structure ? JSON.stringify(form_structure) : null,
          display_type !== undefined ? display_type : null,
          formFormatId,
          organizationId
        ]
      );

      logger.info(`Form format updated: ${formFormatId} for organization ${organizationId}`);
      return success(res, result.rows[0], 'Form format updated successfully');
    } catch (error) {
      logger.error('Error updating form format:', error);
      return errorResponse(res, 'Failed to update form format', 500);
    }
  });

  /**
   * @swagger
   * /api/form-formats/{id}:
   *   delete:
   *     summary: Delete form format
   *     description: Delete a form format (admin only)
   *     tags: [Form Builder]
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
   *         description: Form format deleted successfully
   *       404:
   *         description: Form format not found
   */
  router.delete('/form-formats/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
      const organizationId = req.user.organizationId;
      const formFormatId = parseInt(req.params.id, 10);

      const result = await pool.query(
        `DELETE FROM organization_form_formats
         WHERE id = $1 AND organization_id = $2
         RETURNING id`,
        [formFormatId, organizationId]
      );

      if (result.rows.length === 0) {
        return errorResponse(res, 'Form format not found', 404);
      }

      logger.info(`Form format deleted: ${formFormatId} for organization ${organizationId}`);
      return success(res, { id: formFormatId }, 'Form format deleted successfully');
    } catch (error) {
      logger.error('Error deleting form format:', error);
      return errorResponse(res, 'Failed to delete form format', 500);
    }
  });

  /**
   * @swagger
   * /api/user-organizations:
   *   get:
   *     summary: Get organizations user has access to
   *     description: Get list of organizations the current user manages or has access to
   *     tags: [Form Builder]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Organizations retrieved successfully
   */
  router.get('/user-organizations', authenticate, async (req, res) => {
    try {
      const userId = req.user.id;

      const result = await pool.query(
        `SELECT DISTINCT o.id, o.name, uo.role
         FROM organizations o
         INNER JOIN user_organizations uo ON o.id = uo.organization_id
         WHERE uo.user_id = $1
         ORDER BY o.name`,
        [userId]
      );

      return success(res, result.rows);
    } catch (error) {
      logger.error('Error fetching user organizations:', error);
      return errorResponse(res, 'Failed to fetch organizations', 500);
    }
  });

  /**
   * @swagger
   * /api/translations/keys:
   *   get:
   *     summary: Get translations by keys
   *     description: Get translations for specific keys
   *     tags: [Form Builder]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: keys
   *         required: true
   *         schema:
   *           type: string
   *         description: Comma-separated list of translation keys
   *     responses:
   *       200:
   *         description: Translations retrieved successfully
   */
  router.get('/translations/keys', authenticate, async (req, res) => {
    try {
      const { keys } = req.query;

      if (!keys) {
        return errorResponse(res, 'keys parameter is required', 400);
      }

      const keyArray = keys.split(',').map(k => k.trim());

      const result = await pool.query(
        `SELECT t.key, t.value, l.code as language_code
         FROM translations t
         LEFT JOIN languages l ON t.language_id = l.id
         WHERE t.key = ANY($1)
         ORDER BY t.key, l.code`,
        [keyArray]
      );

      // Group by key
      const translations = {};
      result.rows.forEach(row => {
        if (!translations[row.key]) {
          translations[row.key] = {};
        }
        translations[row.key][row.language_code || 'en'] = row.value;
      });

      return success(res, translations);
    } catch (error) {
      logger.error('Error fetching translations:', error);
      return errorResponse(res, 'Failed to fetch translations', 500);
    }
  });

  /**
   * @swagger
   * /api/translations:
   *   post:
   *     summary: Add translations
   *     description: Add new translations (admin only)
   *     tags: [Form Builder]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - key
   *               - translations
   *             properties:
   *               key:
   *                 type: string
   *               translations:
   *                 type: object
   *                 properties:
   *                   en:
   *                     type: string
   *                   fr:
   *                     type: string
   *     responses:
   *       201:
   *         description: Translations added successfully
   */
  router.post('/translations', authenticate, authorize('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
      const { key, translations } = req.body;

      if (!key || !translations) {
        return errorResponse(res, 'key and translations are required', 400);
      }

      await client.query('BEGIN');

      // Get language IDs
      const languages = await client.query('SELECT id, code FROM languages WHERE code IN ($1, $2)', ['en', 'fr']);
      const languageMap = {};
      languages.rows.forEach(lang => {
        languageMap[lang.code] = lang.id;
      });

      const results = [];

      // Insert translations for each language
      for (const [langCode, value] of Object.entries(translations)) {
        if (value && languageMap[langCode]) {
          // Check if translation already exists
          const existing = await client.query(
            'SELECT id FROM translations WHERE key = $1 AND language_id = $2',
            [key, languageMap[langCode]]
          );

          if (existing.rows.length > 0) {
            // Update existing
            const result = await client.query(
              `UPDATE translations
               SET value = $1
               WHERE key = $2 AND language_id = $3
               RETURNING *`,
              [value, key, languageMap[langCode]]
            );
            results.push(result.rows[0]);
          } else {
            // Insert new
            const result = await client.query(
              `INSERT INTO translations (key, value, language_id, created_at)
               VALUES ($1, $2, $3, NOW())
               RETURNING *`,
              [key, value, languageMap[langCode]]
            );
            results.push(result.rows[0]);
          }
        }
      }

      await client.query('COMMIT');
      logger.info(`Translations added/updated for key: ${key}`);
      return success(res, results, 'Translations saved successfully', 201);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error saving translations:', error);
      return errorResponse(res, 'Failed to save translations', 500);
    } finally {
      client.release();
    }
  });

  /**
   * @swagger
   * /api/form-formats/{sourceOrgId}/{formType}/copy:
   *   post:
   *     summary: Copy form format from another organization
   *     description: Copy a form format from another organization (admin only)
   *     tags: [Form Builder]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: sourceOrgId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: formType
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       201:
   *         description: Form format copied successfully
   *       404:
   *         description: Source form format not found
   */
  router.post('/form-formats/:sourceOrgId/:formType/copy', authenticate, authorize('admin'), async (req, res) => {
    try {
      const organizationId = req.user.organizationId;
      const sourceOrgId = parseInt(req.params.sourceOrgId, 10);
      const formType = req.params.formType;
      const userId = req.user.id;

      // Verify user has access to source organization
      const accessCheck = await pool.query(
        `SELECT 1 FROM user_organizations
         WHERE user_id = $1 AND organization_id = $2`,
        [userId, sourceOrgId]
      );

      if (accessCheck.rows.length === 0) {
        return errorResponse(res, 'Access denied to source organization', 403);
      }

      // Get source form format
      const sourceFormat = await pool.query(
        `SELECT form_structure, display_type
         FROM organization_form_formats
         WHERE organization_id = $1 AND form_type = $2`,
        [sourceOrgId, formType]
      );

      if (sourceFormat.rows.length === 0) {
        return errorResponse(res, 'Source form format not found', 404);
      }

      // Check if form type already exists in target organization
      const existingCheck = await pool.query(
        `SELECT id FROM organization_form_formats
         WHERE organization_id = $1 AND form_type = $2`,
        [organizationId, formType]
      );

      let result;
      if (existingCheck.rows.length > 0) {
        // Update existing
        result = await pool.query(
          `UPDATE organization_form_formats
           SET form_structure = $1, display_type = $2, updated_at = NOW()
           WHERE organization_id = $3 AND form_type = $4
           RETURNING id, form_type, form_structure, display_type, created_at, updated_at`,
          [sourceFormat.rows[0].form_structure, sourceFormat.rows[0].display_type, organizationId, formType]
        );
      } else {
        // Insert new
        result = await pool.query(
          `INSERT INTO organization_form_formats
           (organization_id, form_type, form_structure, display_type, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           RETURNING id, form_type, form_structure, display_type, created_at, updated_at`,
          [organizationId, formType, sourceFormat.rows[0].form_structure, sourceFormat.rows[0].display_type]
        );
      }

      logger.info(`Form format copied: ${formType} from org ${sourceOrgId} to org ${organizationId}`);
      return success(res, result.rows[0], 'Form format copied successfully', 201);
    } catch (error) {
      logger.error('Error copying form format:', error);
      return errorResponse(res, 'Failed to copy form format', 500);
    }
  });

  return router;
};
