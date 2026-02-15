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
const meetingSectionDefaults = require('../config/meeting_sections.json');
const bcrypt = require('bcryptjs');

// Import auth middleware
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/response');
const { requireJWTSecret, signJWTToken } = require('../utils/jwt-config');

// Import utilities
const { getCurrentOrganizationId, verifyJWT, verifyOrganizationMembership, handleOrganizationResolutionError } = require('../utils/api-helpers');
const { ensureProgramSectionsSeeded, getProgramSections } = require('../utils/programSections');

// Validate JWT secret at startup
requireJWTSecret();

const PUBLIC_ORGANIZATION_SETTING_KEYS = [
  'organization_info',
  'program_sections',
  'meeting_sections',
  'branding',
  'equipment_categories'
];

// PERFORMANCE OPTIMIZATION: In-memory cache for organization settings
// Settings rarely change, so caching them significantly improves response time
const orgSettingsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

/**
 * Load and parse organization settings from the database, ensuring program sections are hydrated.
 * PERFORMANCE OPTIMIZATION: Now includes in-memory caching with 5-minute TTL
 *
 * @param {Object} pool - PostgreSQL connection pool
 * @param {number} organizationId - Organization identifier
 * @param {boolean} skipCache - If true, bypass cache and fetch fresh data
 * @returns {Promise<Object>} Parsed organization settings object
 */
async function loadOrganizationSettings(pool, organizationId, skipCache = false) {
  // Check cache first
  const cacheKey = `org_${organizationId}`;
  if (!skipCache && orgSettingsCache.has(cacheKey)) {
    const cached = orgSettingsCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.settings;
    }
    // Cache expired, remove it
    orgSettingsCache.delete(cacheKey);
  }

  const result = await pool.query(
    `SELECT setting_key, setting_value
     FROM organization_settings
     WHERE organization_id = $1`,
    [organizationId]
  );

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

  const [localGroupMemberships, allLocalGroups] = await Promise.all([
    pool.query(
      `SELECT lg.id, lg.name, lg.slug
       FROM local_groups lg
       INNER JOIN organization_local_groups olg
         ON olg.local_group_id = lg.id
       WHERE olg.organization_id = $1
       ORDER BY lg.name`,
      [organizationId]
    ),
    pool.query(
      `SELECT id, name, slug
       FROM local_groups
       ORDER BY name`
    )
  ]);

  settings.local_groups = {
    memberships: localGroupMemberships.rows,
    available: allLocalGroups.rows
  };

  // Cache the result
  orgSettingsCache.set(cacheKey, {
    settings,
    timestamp: Date.now()
  });

  return settings;
}

/**
 * Filter organization settings to a public-safe subset for unauthenticated requests.
 *
 * @param {Object} settings - Full organization settings payload
 * @returns {Object} Whitelisted public settings
 */
function buildPublicOrganizationSettings(settings = {}) {
  const publicSettings = {};

  PUBLIC_ORGANIZATION_SETTING_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      publicSettings[key] = settings[key];
    }
  });

  return publicSettings;
}

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with organization routes
 */
module.exports = (pool, logger) => {
  router.get('/status', asyncHandler(async (req, res) => {
    try {
      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const result = await pool.query(
        'SELECT id, name, domain, created_at FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Organization not found' });
      }

      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      throw error;
    }
  }));

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
  router.get('/jwt', asyncHandler(async (req, res) => {
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
    const token = signJWTToken(
      { organizationId },
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      organizationId
    });
  }));

  /**
   * @swagger
   * /api/organizations/info:
   *   get:
   *     summary: Get organization info
   *     description: Retrieve basic organization information (public)
   *     tags: [Organizations]
   *     responses:
   *       200:
   *         description: Organization info retrieved
   */
  router.get('/info', asyncHandler(async (req, res) => {
    try {
      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Fetch organization default language
      const orgResult = await pool.query(
        'SELECT default_language FROM organizations WHERE id = $1',
        [organizationId]
      );

      const defaultLanguage = orgResult.rows[0]?.default_language || 'fr';

      res.json({
        success: true,
        organizationId: organizationId,
        defaultLanguage: defaultLanguage
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      throw error;
    }
  }));

  /**
   * @swagger
   * /api/organizations/get_organization_id:
   *   get:
   *     summary: Get organization ID
   *     description: Resolve organization ID from request context (domain, header, etc.)
   *     tags: [Organizations]
   *     responses:
   *       200:
   *         description: Organization ID retrieved
   */
  router.get('/get_organization_id', asyncHandler(async (req, res) => {
    try {
      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      res.json({
        success: true,
        organization_id: organizationId
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      throw error;
    }
  }));

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
  // Public-safe organization settings (no authentication, limited data)
  router.get('/settings', asyncHandler(async (req, res, next) => {
    if (!req.baseUrl?.startsWith('/public')) {
      return next();
    }

    try {
      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const settings = await loadOrganizationSettings(pool, organizationId);

      return res.json({
        success: true,
        data: buildPublicOrganizationSettings(settings)
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }

      logger.error('Error fetching public organization settings:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching organization settings'
      });
    }
  }));

  router.get('/settings', authenticate, requirePermission('org.view'), asyncHandler(async (req, res) => {
    try {
      const organizationId = await getOrganizationId(req, pool);
      const settings = await loadOrganizationSettings(pool, organizationId);

      return res.json({
        success: true,
        data: settings
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }

      logger.error('Error fetching organization settings:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching organization settings'
      });
    }
  }));

  router.put('/settings', authenticate, requirePermission('organization.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { setting_key, setting_value } = req.body || {};

    if (!setting_key) {
      return res.status(400).json({ success: false, message: 'setting_key is required' });
    }

    await pool.query(
      `UPDATE organization_settings
       SET setting_value = $1, updated_at = NOW()
       WHERE organization_id = $2 AND setting_key = $3`,
      [JSON.stringify(setting_value), organizationId, setting_key]
    );

    orgSettingsCache.delete(`org_${organizationId}`);

    return res.json({
      success: true,
      message: 'Organization setting updated'
    });
  }));

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
  router.patch('/settings/email-language', authenticate, blockDemoRoles, requirePermission('org.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
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

    // Update or insert organization default email language setting
    await pool.query(
      `INSERT INTO organization_settings (organization_id, setting_key, setting_value, created_at, updated_at)
         VALUES ($1, 'default_email_language', $2, NOW(), NOW())
         ON CONFLICT (organization_id, setting_key)
         DO UPDATE SET setting_value = $2, updated_at = NOW()`,
      [organizationId, JSON.stringify(language)]
    );

    logger.info(`Organization ${organizationId} default email language updated to ${language} by user ${req.user.id}`);

    res.json({
      success: true,
      message: 'Organization default email language updated successfully',
      data: { language }
    });
  }));

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
  router.post('/', authenticate, blockDemoRoles, requirePermission('org.create'), asyncHandler(async (req, res) => {
    const client = await pool.connect();

    const { name, ...otherData } = req.body;
    const userId = req.user.id;

    if (!name) {
      client.release();
      return res.status(400).json({ success: false, message: 'Organization name is required' });
    }

    try {
      await client.query('BEGIN');

      // Resolve district role ID so the creator is assigned the correct permission-backed role
      const districtRoleResult = await client.query(
        `SELECT id FROM roles WHERE role_name = 'district' LIMIT 1`
      );
      if (districtRoleResult.rows.length === 0) {
        throw new Error('District role not found; cannot assign organization owner role');
      }
      const districtRoleId = districtRoleResult.rows[0].id;

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

      // Link current user to the new organization with district-level permissions
      await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, role_ids, created_at)
         VALUES ($1, $2, jsonb_build_array($3), NOW())`,
        [userId, newOrganizationId, districtRoleId]
      );

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Organization created successfully',
        organization_id: newOrganizationId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  /**
   * @swagger
   * /api/v1/organizations/register:
   *   post:
   *     summary: Register user to organization
   *     description: Register the current user to an organization using a registration password
   *     tags: [Organizations]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [registration_password]
   *             properties:
   *               registration_password:
   *                 type: string
   *               role:
   *                 type: string
   *                 default: parent
   *               link_children:
   *                 type: array
   *                 items:
   *                   type: integer
   *     responses:
   *       200:
   *         description: Successfully registered
   *       403:
   *         description: Invalid registration password
   */
  router.post('/register', authenticate, blockDemoRoles, requirePermission('org.register'), asyncHandler(async (req, res) => {
    const { registration_password, role, link_children } = req.body;
    const organizationId = await getOrganizationId(req, pool);

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

      // Get role ID from roles table
      const roleName = role || 'parent';
      const roleResult = await client.query(
        `SELECT id FROM roles WHERE role_name = $1`,
        [roleName]
      );
      if (roleResult.rows.length === 0) {
        throw new Error(`Role '${roleName}' not found in roles table`);
      }
      const roleId = roleResult.rows[0].id;

      // Add user to organization
      await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, role_ids)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, organization_id) DO NOTHING`,
        [req.user.id, organizationId, JSON.stringify([roleId])]
      );

      // Link children if provided
      if (link_children && Array.isArray(link_children)) {
        for (const participantId of link_children) {
          await client.query(
            `INSERT INTO user_participants (user_id, participant_id)
               VALUES ($1, $2)
               ON CONFLICT (user_id, participant_id) DO NOTHING`,
            [req.user.id, participantId]
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
  }));

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
  router.post('/switch', authenticate, asyncHandler(async (req, res) => {
    const organizationId = Number.parseInt(req.body?.organization_id, 10);

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    // Verify user belongs to this organization
    const membershipCheck = await pool.query(
      'SELECT role FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [req.user.id, organizationId]
    );

    if (membershipCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this organization'
      });
    }

    const rolesResult = await pool.query(
      `SELECT r.id as role_id, r.role_name
       FROM user_organizations uo
       CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
       JOIN roles r ON r.id = role_id_text::integer
       WHERE uo.user_id = $1 AND uo.organization_id = $2`,
      [req.user.id, organizationId]
    );

    const permissionsResult = await pool.query(
      `SELECT DISTINCT p.permission_key
       FROM user_organizations uo
       CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
       JOIN role_permissions rp ON rp.role_id = role_id_text::integer
       JOIN permissions p ON p.id = rp.permission_id
       WHERE uo.user_id = $1 AND uo.organization_id = $2`,
      [req.user.id, organizationId]
    );

    const roleIds = rolesResult.rows.map((row) => row.role_id);
    const roleNames = rolesResult.rows.map((row) => row.role_name);
    const permissions = permissionsResult.rows.map((row) => row.permission_key);

    // Generate new JWT with updated organization
    const newToken = signJWTToken(
      {
        user_id: req.user.id,
        organizationId,
        organization_id: organizationId,
        role: membershipCheck.rows[0].role,
        roleIds,
        roleNames,
        permissions
      },
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token: newToken,
      data: { token: newToken },
      message: 'Organization switched successfully'
    });
  }));

  router.post('/create', asyncHandler(async (req, res) => {
    const { organization_name, admin_email, admin_password, admin_full_name } = req.body || {};

    if (!organization_name || typeof organization_name !== 'string' || organization_name.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'organization_name is required' });
    }

    const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,255}$/;
    if (!passwordPattern.test(admin_password || '')) {
      return res.status(400).json({ success: false, message: 'admin_password must be strong' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orgResult = await client.query(
        `INSERT INTO organizations (name, created_at)
         VALUES ($1, NOW())
         RETURNING id, name, created_at`,
        [organization_name.trim()]
      );

      const newOrg = orgResult.rows[0];
      if (!newOrg) {
        throw new Error('Failed to create organization');
      }

      const userResult = await client.query(
        `INSERT INTO users (email, password, full_name, is_verified)
         VALUES ($1, $2, $3, true)
         RETURNING id, email`,
        [admin_email, await bcrypt.hash(admin_password, 10), admin_full_name]
      );

      if (!userResult.rows[0]) {
        throw new Error('Failed to create admin user');
      }

      await client.query('COMMIT');
      return res.status(201).json({ success: true, data: { organization_id: newOrg.id, user_id: userResult.rows[0].id } });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505' && error.constraint === 'users_email_key') {
        return res.status(400).json({ success: false, message: 'account_already_exists' });
      }
      throw error;
    } finally {
      client.release();
    }
  }));

  return router;
};
