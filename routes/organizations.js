/**
 * Organization Routes
 *
 * Handles organization management, settings, registration, and JWT operations
 * All endpoints in this module are prefixed with /api or /public
 *
 * @module routes/organizations
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const meetingSectionDefaults = require('../config/meeting_sections.json');

// Import utilities
const { getCurrentOrganizationId, verifyJWT, verifyOrganizationMembership, handleOrganizationResolutionError } = require('../utils/api-helpers');
const { ensureProgramSectionsSeeded, getProgramSections } = require('../utils/programSections');

// Get JWT key from environment
const jwtKey = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET;

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with organization routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/organization-jwt:
   *   get:
   *     summary: Get organization JWT token
   *     description: Generate a JWT containing only organization ID (no user info)
   *     tags: [Organizations]
   *     parameters:
   *       - in: query
   *         name: organization_id
   *         schema:
   *           type: integer
   *         description: Optional organization ID (defaults to current org from request)
   *     responses:
   *       200:
   *         description: JWT generated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 token:
   *                   type: string
   *                 organizationId:
   *                   type: integer
   *       400:
   *         description: Organization ID required
   */
  router.get('/organization-jwt', async (req, res) => {
    try {
      const organizationId = req.query.organization_id
        ? parseInt(req.query.organization_id, 10)
        : await getCurrentOrganizationId(req, pool, logger);

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization ID is required'
        });
      }

      // Generate JWT with organization ID only (no user information)
      const token = jwt.sign(
        { organizationId },
        jwtKey,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        token,
        organizationId
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error generating organization JWT:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate JWT token'
      });
    }
  });

  /**
   * @swagger
   * /public/get_organization_id:
   *   get:
   *     summary: Get current organization ID
   *     description: Public endpoint to retrieve organization ID from request context
   *     tags: [Organizations]
   *     responses:
   *       200:
   *         description: Organization ID retrieved
   */
  router.get('/get_organization_id', async (req, res) => {
    try {
      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      res.json({
        success: true,
        organizationId: organizationId
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error getting organization ID:', error);
      res.status(500).json({
        success: false,
        message: 'Error getting organization ID'
      });
    }
  });

  /**
   * @swagger
   * /api/organization-settings:
   *   get:
   *     summary: Get organization settings
   *     description: Retrieve all settings for current organization
   *     tags: [Organizations]
   *     responses:
   *       200:
   *         description: Settings retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   additionalProperties: true
   */
  router.get('/organization-settings', async (req, res) => {
    try {
      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT setting_key, setting_value
         FROM organization_settings
         WHERE organization_id = $1`,
        [organizationId]
      );

      // Convert rows to key-value object
      const settings = {};
      result.rows.forEach(row => {
        try {
          settings[row.setting_key] = JSON.parse(row.setting_value);
        } catch {
          settings[row.setting_key] = row.setting_value;
        }
      });

      await ensureProgramSectionsSeeded(pool, organizationId);
      settings.program_sections = await getProgramSections(pool, organizationId);

      res.json({
        success: true,
        data: settings
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error getting organization settings:', error);
      res.status(500).json({
        success: false,
        message: 'Error getting organization settings'
      });
    }
  });

  /**
   * @swagger
   * /api/organization-settings/default-email-language:
   *   patch:
   *     summary: Update organization default email language
   *     description: Update the organization's default language for email communications
   *     tags: [Organizations]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - language
   *             properties:
   *               language:
   *                 type: string
   *                 enum: [en, fr, uk, it]
   *     responses:
   *       200:
   *         description: Organization default email language updated successfully
   *       400:
   *         description: Invalid language code
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden - Admin access required
   */
  router.patch('/organization-settings/default-email-language', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const { language } = req.body;

      // Supported languages
      const supportedLanguages = ['en', 'fr', 'uk', 'it'];

      // Validate language code
      if (!language) {
        return res.status(400).json({
          success: false,
          message: 'Language is required'
        });
      }

      if (!supportedLanguages.includes(language)) {
        return res.status(400).json({
          success: false,
          message: `Invalid language code. Supported languages: ${supportedLanguages.join(', ')}`
        });
      }

      // Verify user has admin role in this organization
      const roleCheck = await pool.query(
        `SELECT role FROM user_organizations
         WHERE user_id = $1 AND organization_id = $2`,
        [decoded.userId, organizationId]
      );

      if (roleCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'User not found in organization'
        });
      }

      const userRole = roleCheck.rows[0].role;
      if (userRole !== 'admin' && userRole !== 'director') {
        return res.status(403).json({
          success: false,
          message: 'Admin or director access required to update organization settings'
        });
      }

      // Update or insert organization default email language setting
      await pool.query(
        `INSERT INTO organization_settings (organization_id, setting_key, setting_value, created_at, updated_at)
         VALUES ($1, 'default_email_language', $2, NOW(), NOW())
         ON CONFLICT (organization_id, setting_key)
         DO UPDATE SET setting_value = $2, updated_at = NOW()`,
        [organizationId, JSON.stringify(language)]
      );

      logger.info(`Organization ${organizationId} default email language updated to ${language} by user ${decoded.userId}`);

      res.json({
        success: true,
        message: 'Organization default email language updated successfully',
        data: { language }
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error updating organization default email language:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating organization default email language'
      });
    }
  });

  /**
   * @swagger
   * /api/organizations:
   *   post:
   *     summary: Create new organization
   *     description: Create a new organization and assign current user as admin
   *     tags: [Organizations]
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
   *             properties:
   *               name:
   *                 type: string
   *     responses:
   *       201:
   *         description: Organization created successfully
   *       401:
   *         description: Unauthorized
   */
  router.post('/organizations', async (req, res) => {
    const client = await pool.connect();

    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.userId) {
        client.release();
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { name, ...otherData } = req.body;
      const userId = decoded.userId;

      if (!name) {
        client.release();
        return res.status(400).json({ success: false, message: 'Organization name is required' });
      }

      await client.query('BEGIN');

      // Create new organization
      const orgResult = await client.query(
        'INSERT INTO organizations (name, created_at) VALUES ($1, NOW()) RETURNING id',
        [name]
      );

      const newOrganizationId = orgResult.rows[0].id;

      // Copy organization form formats from template (organization_id = 0)
      await client.query(
        `INSERT INTO organization_form_formats (organization_id, form_type, form_structure, display_type)
         SELECT $1, form_type, form_structure, 'public'
         FROM organization_form_formats
         WHERE organization_id = 0`,
        [newOrganizationId]
      );

      // Insert organization settings
      const orgInfo = { name, ...otherData };
      await client.query(
        `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
         VALUES ($1, 'organization_info', $2)`,
        [newOrganizationId, JSON.stringify(orgInfo)]
      );
      await client.query(
        `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
         VALUES ($1, 'meeting_sections', $2)
         ON CONFLICT (organization_id, setting_key) DO NOTHING`,
        [newOrganizationId, JSON.stringify(meetingSectionDefaults)]
      );

      await ensureProgramSectionsSeeded(client, newOrganizationId);

      // Link current user to the new organization as admin
      await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, role, created_at)
         VALUES ($1, $2, 'admin', NOW())`,
        [userId, newOrganizationId]
      );

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Organization created successfully',
        organization_id: newOrganizationId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating organization:', error);
      res.status(500).json({ success: false, message: 'Error creating organization: ' + error.message });
    } finally {
      client.release();
    }
  });

  /**
   * @swagger
   * /api/register-for-organization:
   *   post:
   *     summary: Register existing user for an organization
   *     description: Allow existing user to join an organization using registration password
   *     tags: [Organizations]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - registration_password
   *             properties:
   *               registration_password:
   *                 type: string
   *               role:
   *                 type: string
   *                 enum: [parent, animation, admin]
   *               link_children:
   *                 type: array
   *                 items:
   *                   type: integer
   *     responses:
   *       200:
   *         description: Successfully registered for organization
   *       403:
   *         description: Invalid registration password
   */
  router.post('/register-for-organization', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { registration_password, role, link_children } = req.body;
      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Check registration password
      const passwordResult = await pool.query(
        `SELECT setting_value FROM organization_settings
         WHERE organization_id = $1 AND setting_key = 'registration_password'`,
        [organizationId]
      );

      if (passwordResult.rows.length === 0 || passwordResult.rows[0].setting_value !== registration_password) {
        return res.status(403).json({ success: false, message: 'Invalid registration password' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Add user to organization
        await client.query(
          `INSERT INTO user_organizations (user_id, organization_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, organization_id) DO NOTHING`,
          [decoded.user_id, organizationId, role || 'parent']
        );

        // Link children if provided
        if (link_children && Array.isArray(link_children)) {
          for (const participantId of link_children) {
            await client.query(
              `INSERT INTO user_participants (user_id, participant_id)
               VALUES ($1, $2)
               ON CONFLICT (user_id, participant_id) DO NOTHING`,
              [decoded.user_id, participantId]
            );
          }
        }

        await client.query('COMMIT');

        res.json({ success: true, message: 'Successfully registered for organization' });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error registering for organization:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/switch-organization:
   *   post:
   *     summary: Switch active organization for user
   *     description: Generate new JWT with different organization context
   *     tags: [Organizations]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - organization_id
   *             properties:
   *               organization_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Organization switched
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     token:
   *                       type: string
   *       403:
   *         description: User not a member of organization
   */
  router.post('/switch-organization', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { organization_id } = req.body;

      if (!organization_id) {
        return res.status(400).json({ success: false, message: 'Organization ID is required' });
      }

      // Verify user belongs to this organization
      const membershipCheck = await pool.query(
        `SELECT role FROM user_organizations
         WHERE user_id = $1 AND organization_id = $2`,
        [decoded.user_id, organization_id]
      );

      if (membershipCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this organization'
        });
      }

      // Generate new JWT with updated organization
      const newToken = jwt.sign(
        {
          user_id: decoded.user_id,
          organization_id: organization_id,
          role: membershipCheck.rows[0].role
        },
        jwtKey,
        { expiresIn: '24h' }
      );

      res.json({
        success: true,
        data: { token: newToken },
        message: 'Organization switched successfully'
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error switching organization:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
