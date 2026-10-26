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

// Import auth middleware
const { check, validationResult } = require('express-validator');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { asyncHandler, success, forbidden, error: errorResponse } = require('../middleware/response');
const { validateIdBody, validateIdParam, checkValidation, normalizeEmailValue } = require('../middleware/validation');
const { requireJWTSecret, signJWTToken } = require('../utils/jwt-config');
const {
  validateUnitVocabulary,
  validateDashboardConfiguration,
  validateParentDashboardConfiguration,
  getProgramSectionForProfile,
  getProfileForProgramSection,
  buildVocabularyForProfile,
  CUSTOM_PROFILE
} = require('../utils/unitCustomization');

// Import utilities
const { getCurrentOrganizationId, handleOrganizationResolutionError } = require('../utils/api-helpers');
const {
  ALL_INTERFACE_LANGUAGES,
  INTERFACE_LANGUAGES_SETTING_KEY,
  validateInterfaceLanguages,
} = require('../utils/interfaceLanguages');
const {
  DEFAULT_PROGRAM_SECTIONS,
  ensureProgramSectionsSeeded,
  getProgramSections
} = require('../utils/programSections');
const { readUnitSubdomain } = require('../utils/unitSubdomains');
const { installDefaultFormFormats } = require('../services/defaultFormFormats');
const { checkRolesGrantable } = require('../services/roleAssignment');
const { resolveUnitRoleId } = require('../services/roleVisibility');
const { createInvitation, resolveInvitationLanguage } = require('../services/parentInvitations');
const { deliverParentInvitation } = require('../services/familyDelivery');
const { installDefaultStarterActivities } = require('../services/activityLibraryStarter');
const {
  EMAIL_SENDER_SETTING_KEY,
  getDefaultSenderEmail,
  getUnitSenderDomains,
  validateEmailSenderSettings
} = require('../services/emailSender');

// Settings that have their own validated endpoint and must not be written
// through the generic PUT /settings.
const PARENT_DASHBOARD_SETTING_KEY = 'parent_dashboard_configuration';
// Settings with a validated endpoint of their own; the generic PUT must not
// bypass that validation.
const DEDICATED_SETTING_KEYS = new Set([
  EMAIL_SENDER_SETTING_KEY,
  PARENT_DASHBOARD_SETTING_KEY,
  INTERFACE_LANGUAGES_SETTING_KEY,
]);
const HTTP_BAD_REQUEST = 400;
const HTTP_CREATED = 201;
const HTTP_CONFLICT = 409;
const HTTP_NOT_FOUND = 404;
const MAX_EMAIL_LENGTH = 255;

/** The branches a unit may be created for: castors, louveteaux, éclaireurs… */
const PROGRAM_SECTION_KEYS = new Set(DEFAULT_PROGRAM_SECTIONS.map((section) => section.key));
/** The built-in role a new unit's administrator is invited into (or the unit role replacing it). */
const UNIT_ADMIN_ROLE = 'unitadmin';

/** The address of the person who will administer a unit being created. */
const validateLeaderEmail = check('leader_email')
  .trim()
  .isEmail()
  .withMessage('leader_email_invalid')
  .bail()
  .isLength({ max: MAX_EMAIL_LENGTH })
  .withMessage('leader_email_invalid');

/**
 * Whether a domain row is a pattern (`*.example.dev`) rather than an address.
 *
 * @param {string} domain - organization_domains.domain
 * @returns {boolean}
 */
function isWildcardDomain(domain) {
  return String(domain).includes('*');
}

/**
 * An organization_domains row as the API returns it.
 *
 * @param {{id: number, domain: string, is_primary: boolean, created_at: Date}} row - Database row
 * @returns {Object} The address, and whether it may be emailed or removed
 */
function describeDomain(row) {
  return {
    id: row.id,
    domain: row.domain,
    is_primary: row.is_primary === true,
    // A pattern such as *.example.dev routes requests but is no address to send anyone to.
    is_wildcard: isWildcardDomain(row.domain),
    created_at: row.created_at,
  };
}

/**
 * Whether a unit already answers at this hostname.
 *
 * @param {{query: Function}} db - Pool or client
 * @param {string} hostname - Full hostname, e.g. `meute-ada.wampums.app`
 * @returns {Promise<boolean>}
 */
async function isDomainTaken(db, hostname) {
  const result = await db.query(
    'SELECT 1 FROM organization_domains WHERE lower(domain) = lower($1) LIMIT 1',
    [hostname]
  );
  return result.rows.length > 0;
}

// Validate JWT secret at startup
requireJWTSecret();

const PUBLIC_ORGANIZATION_SETTING_KEYS = [
  'organization_info',
  'unit_vocabulary',
  'program_sections',
  'meeting_sections',
  'branding',
  'equipment_categories',
  // The login page and parents offer the unit's languages before any
  // permission is known.
  INTERFACE_LANGUAGES_SETTING_KEY,
  // Parents may not hold org.view, so the buttons their dashboard hides must
  // reach them through the public settings. It only lists button keys.
  PARENT_DASHBOARD_SETTING_KEY,
  // A demo unit's sign-in page offers the parent and leader views instead of a password.
  'demo_sign_in'
];

// PERFORMANCE OPTIMIZATION: In-memory cache for organization settings
// Settings rarely change, so caching them significantly improves response time
const orgSettingsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

const ORGANIZATION_INFO_LIMITS = Object.freeze({
  shortText: 255,
  location: 500,
  logoUrl: 2048,
  minimumMeetingDuration: 15,
  maximumMeetingDuration: 720
});
const VALID_MEETING_DAYS = new Set([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Normalize and validate fields editable from the unit settings page.
 * Unknown properties are deliberately excluded so callers cannot overwrite
 * internal organization settings, while the database merge preserves existing
 * legacy/custom properties.
 *
 * @param {Object} input - Submitted organization information
 * @returns {{value: Object, errors: Array<{field: string, msg: string}>}}
 */
function validateOrganizationInfo(input) {
  const value = {};
  const errors = [];
  const textFields = [
    ['name', ORGANIZATION_INFO_LIMITS.shortText],
    ['unit', ORGANIZATION_INFO_LIMITS.shortText],
    ['district', ORGANIZATION_INFO_LIMITS.shortText],
    ['endroit', ORGANIZATION_INFO_LIMITS.location],
    ['animateur_responsable', ORGANIZATION_INFO_LIMITS.shortText],
    ['logo', ORGANIZATION_INFO_LIMITS.logoUrl]
  ];

  for (const [field, maximumLength] of textFields) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {continue;}

    if (typeof input[field] !== 'string') {
      errors.push({ field, msg: 'Must be a string' });
      continue;
    }

    const normalized = input[field].trim();
    if (normalized.length > maximumLength) {
      errors.push({ field, msg: `Must be ${maximumLength} characters or fewer` });
      continue;
    }
    value[field] = normalized;
  }

  if (!value.name) {
    errors.push({ field: 'name', msg: 'Organization name is required' });
  }

  if (Object.prototype.hasOwnProperty.call(input, 'meeting_day')) {
    if (typeof input.meeting_day !== 'string' || !VALID_MEETING_DAYS.has(input.meeting_day)) {
      errors.push({ field: 'meeting_day', msg: 'Invalid meeting day' });
    } else {
      value.meeting_day = input.meeting_day;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'meeting_time')) {
    if (typeof input.meeting_time !== 'string' || !TIME_PATTERN.test(input.meeting_time)) {
      errors.push({ field: 'meeting_time', msg: 'Meeting time must use HH:MM format' });
    } else {
      value.meeting_time = input.meeting_time;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'meeting_duration')) {
    const duration = Number(input.meeting_duration);
    if (
      !Number.isInteger(duration)
      || duration < ORGANIZATION_INFO_LIMITS.minimumMeetingDuration
      || duration > ORGANIZATION_INFO_LIMITS.maximumMeetingDuration
    ) {
      errors.push({
        field: 'meeting_duration',
        msg: `Meeting duration must be between ${ORGANIZATION_INFO_LIMITS.minimumMeetingDuration} and ${ORGANIZATION_INFO_LIMITS.maximumMeetingDuration} minutes`
      });
    } else {
      value.meeting_duration = duration;
    }
  }

  if (value.logo && !/^(?:https?:\/\/|\/(?!\/))/i.test(value.logo)) {
    errors.push({ field: 'logo', msg: 'Logo must be an HTTP(S) URL or an absolute site path' });
  }

  return { value, errors };
}

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

  const [organizationContext, localGroupMemberships, allLocalGroups] = await Promise.all([
    pool.query(
      `SELECT program_section
       FROM organizations
       WHERE id = $1`,
      [organizationId]
    ),
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

  settings.program_section = organizationContext.rows[0]?.program_section || 'general';

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
      // policy-allow manual-auth: public route resolving the unit from domain/header
      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      // `domain` lives on organization_domains, not organizations — selecting it
      // directly threw "column domain does not exist" and returned 500 on every call.
      const result = await pool.query(
        `SELECT id, name,
                (SELECT od.domain FROM organization_domains od
                  WHERE od.organization_id = organizations.id
                  ORDER BY od.id LIMIT 1) AS domain,
                created_at
           FROM organizations WHERE id = $1`,
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
   *     description: Generate a JWT containing only the organization ID of the unit the request
   *       comes from (domain, or a validated x-organization-id header). No user information.
   *     tags: [Organizations]
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
    // The unit comes from where the request was sent, never from a parameter:
    // a query field would let anyone mint a token naming any unit.
    let organizationId;
    try {
      // policy-allow manual-auth: public route resolving the unit from domain/header
      organizationId = await getCurrentOrganizationId(req, pool, logger);
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      throw error;
    }

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
      // policy-allow manual-auth: public route resolving the unit from domain/header
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
  const sendOrganizationId = asyncHandler(async (req, res) => {
    try {
      // policy-allow manual-auth: public route resolving the unit from domain/header
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
  });
  router.get('/get_organization_id', sendOrganizationId);

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
  const sendPublicSettings = asyncHandler(async (req, res) => {
    try {
      // policy-allow manual-auth: public route resolving the unit from domain/header
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
  });
  router.get('/settings/public', sendPublicSettings);

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

  /**
   * Update the identity and recurring-meeting defaults shown on Unit Settings.
   * Existing organization_info properties that are not editable on that page
   * are retained, including organization-specific extensions.
   */
  router.patch('/settings/organization-info', authenticate, blockDemoRoles, requirePermission('org.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
    const validation = validateOrganizationInfo(input);

    if (validation.errors.length > 0) {
      return errorResponse(res, 'Invalid organization settings', 400, validation.errors);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const organizationResult = await client.query(
        `UPDATE organizations
         SET name = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [organizationId, validation.value.name]
      );

      if (organizationResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return errorResponse(res, 'Organization not found', 404);
      }

      const infoResult = await client.query(
        `INSERT INTO organization_settings
           (organization_id, setting_key, setting_value, created_at, updated_at)
         VALUES ($1, 'organization_info', $2::jsonb, NOW(), NOW())
         ON CONFLICT (organization_id, setting_key)
         DO UPDATE SET
           setting_value = COALESCE(organization_settings.setting_value, '{}'::jsonb) || EXCLUDED.setting_value,
           updated_at = NOW()
         RETURNING setting_value`,
        [organizationId, JSON.stringify(validation.value)]
      );

      if (validation.value.meeting_duration !== undefined) {
        await client.query(
          `INSERT INTO organization_settings
             (organization_id, setting_key, setting_value, created_at, updated_at)
           VALUES ($1, 'meeting_length', $2::jsonb, NOW(), NOW())
           ON CONFLICT (organization_id, setting_key)
           DO UPDATE SET
             setting_value = COALESCE(organization_settings.setting_value, '{}'::jsonb) || EXCLUDED.setting_value,
             updated_at = NOW()`,
          [organizationId, JSON.stringify({ duration_minutes: validation.value.meeting_duration })]
        );
      }

      await client.query('COMMIT');
      orgSettingsCache.delete(`org_${organizationId}`);

      return success(
        res,
        { organization_info: infoResult.rows[0].setting_value },
        'Organization information updated'
      );
    } catch (updateError) {
      await client.query('ROLLBACK');
      throw updateError;
    } finally {
      client.release();
    }
  }));

  /** Update the program preset and locale-specific vocabulary for one organization. */
  router.patch('/settings/vocabulary', authenticate, blockDemoRoles, requirePermission('org.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const validation = validateUnitVocabulary(req.body);

    if (validation.errors.length > 0) {
      return errorResponse(res, 'Invalid unit vocabulary', 400, validation.errors);
    }

    const programSection = getProgramSectionForProfile(validation.value.profile);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureProgramSectionsSeeded(client, organizationId);

      // A unit whose branch was never chosen ('general') takes it from its
      // vocabulary, as before the branch had a setting of its own. A chosen
      // branch is changed only through PATCH /settings/branch.
      const organizationResult = await client.query(
        `UPDATE organizations
         SET program_section = CASE WHEN program_section = 'general' AND $2::text IS NOT NULL
                                    THEN $2::text ELSE program_section END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING program_section`,
        [organizationId, programSection]
      );
      if (organizationResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return errorResponse(res, 'Organization not found', 404);
      }

      await client.query(
        `INSERT INTO organization_settings
           (organization_id, setting_key, setting_value, created_at, updated_at)
         VALUES ($1, 'unit_vocabulary', $2::jsonb, NOW(), NOW())
         ON CONFLICT (organization_id, setting_key)
         DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
        [organizationId, JSON.stringify(validation.value)]
      );

      await client.query('COMMIT');
      orgSettingsCache.delete(`org_${organizationId}`);
      return success(
        res,
        { unit_vocabulary: validation.value, program_section: organizationResult.rows[0].program_section },
        'Unit vocabulary updated'
      );
    } catch (updateError) {
      await client.query('ROLLBACK');
      throw updateError;
    } finally {
      client.release();
    }
  }));

  /**
   * Change the unit's branch. Its vocabulary follows, unless the unit wrote
   * its own terms (profile `custom`), which are kept. The starter activities
   * already copied stay; the new branch's are offered by the planner's import.
   */
  router.patch('/settings/branch', authenticate, blockDemoRoles, requirePermission('org.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const programSection = PROGRAM_SECTION_KEYS.has(req.body?.program_section) ? req.body.program_section : null;
    if (!programSection) {
      return errorResponse(res, 'Invalid branch', HTTP_BAD_REQUEST, [{ field: 'program_section', msg: 'program_section_required' }]);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureProgramSectionsSeeded(client, organizationId);
      const updated = await client.query(
        `UPDATE organizations SET program_section = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [organizationId, programSection]
      );
      if (updated.rows.length === 0) {
        await client.query('ROLLBACK');
        return errorResponse(res, 'Organization not found', HTTP_NOT_FOUND);
      }

      const stored = await client.query(
        `SELECT setting_value FROM organization_settings
         WHERE organization_id = $1 AND setting_key = 'unit_vocabulary'
         FOR UPDATE`,
        [organizationId]
      );
      let vocabulary = stored.rows[0]?.setting_value || null;
      if (vocabulary?.profile !== CUSTOM_PROFILE) {
        vocabulary = buildVocabularyForProfile(getProfileForProgramSection(programSection));
        await client.query(
          `INSERT INTO organization_settings
             (organization_id, setting_key, setting_value, created_at, updated_at)
           VALUES ($1, 'unit_vocabulary', $2::jsonb, NOW(), NOW())
           ON CONFLICT (organization_id, setting_key)
           DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
          [organizationId, JSON.stringify(vocabulary)]
        );
      }

      await client.query('COMMIT');
      orgSettingsCache.delete(`org_${organizationId}`);
      return success(res, { program_section: programSection, unit_vocabulary: vocabulary }, 'Unit branch updated');
    } catch (updateError) {
      await client.query('ROLLBACK');
      throw updateError;
    } finally {
      client.release();
    }
  }));

  /**
   * The addresses the unit answers at. Every member who may read the unit's
   * settings sees them; changing them is a district administrator's task.
   */
  router.get('/domains', authenticate, requirePermission('org.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const result = await pool.query(
      `SELECT id, domain, is_primary, created_at FROM organization_domains
       WHERE organization_id = $1
       ORDER BY is_primary DESC, created_at ASC, id ASC`,
      [organizationId]
    );
    return success(res, result.rows.map(describeDomain));
  }));

  /** Add an address under wampums.app; the unit keeps answering at the others. */
  router.post('/domains', authenticate, blockDemoRoles, requirePermission('org.create'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { hostname, problem } = readUnitSubdomain(req.body?.subdomain);
    if (problem) {
      return errorResponse(res, 'Invalid address', HTTP_BAD_REQUEST, [{ field: 'subdomain', msg: problem }]);
    }
    const makePrimary = req.body?.make_primary === true;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (makePrimary) {
        await client.query(
          'UPDATE organization_domains SET is_primary = FALSE, updated_at = NOW() WHERE organization_id = $1 AND is_primary',
          [organizationId]
        );
      }
      const inserted = await client.query(
        `INSERT INTO organization_domains (organization_id, domain, is_primary)
         VALUES ($1, $2, $3)
         ON CONFLICT ((lower(domain))) DO NOTHING
         RETURNING id, domain, is_primary, created_at`,
        [organizationId, hostname, makePrimary]
      );
      if (inserted.rows.length === 0) {
        await client.query('ROLLBACK');
        return errorResponse(res, 'subdomain_taken', HTTP_CONFLICT, [{ field: 'subdomain', msg: 'subdomain_taken' }]);
      }
      await client.query('COMMIT');
      return success(res, describeDomain(inserted.rows[0]), 'Address added', HTTP_CREATED);
    } catch (addError) {
      await client.query('ROLLBACK');
      throw addError;
    } finally {
      client.release();
    }
  }));

  /** Make an address the one emailed links are built from. */
  router.put('/domains/:domainId/primary', authenticate, blockDemoRoles, requirePermission('org.create'),
    validateIdParam('domainId'), checkValidation, asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const domainId = Number(req.params.domainId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const target = await client.query(
          'SELECT id, domain FROM organization_domains WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [domainId, organizationId]
        );
        if (target.rows.length === 0) {
          await client.query('ROLLBACK');
          return errorResponse(res, 'Address not found', HTTP_NOT_FOUND);
        }
        if (isWildcardDomain(target.rows[0].domain)) {
          await client.query('ROLLBACK');
          return errorResponse(res, 'domain_wildcard_not_primary', HTTP_BAD_REQUEST);
        }
        await client.query(
          'UPDATE organization_domains SET is_primary = FALSE, updated_at = NOW() WHERE organization_id = $1 AND is_primary AND id <> $2',
          [organizationId, domainId]
        );
        const updated = await client.query(
          `UPDATE organization_domains SET is_primary = TRUE, updated_at = NOW()
           WHERE id = $1 AND organization_id = $2
           RETURNING id, domain, is_primary, created_at`,
          [domainId, organizationId]
        );
        await client.query('COMMIT');
        return success(res, describeDomain(updated.rows[0]), 'Primary address changed');
      } catch (primaryError) {
        await client.query('ROLLBACK');
        throw primaryError;
      } finally {
        client.release();
      }
    }));

  /**
   * Stop answering at an address. The primary address is kept until another
   * is made primary, and a unit always keeps one exact address.
   */
  router.delete('/domains/:domainId', authenticate, blockDemoRoles, requirePermission('org.create'),
    validateIdParam('domainId'), checkValidation, asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const domainId = Number(req.params.domainId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Locks the unit's addresses, so two removals cannot leave it with none.
        const addresses = await client.query(
          'SELECT id, domain, is_primary FROM organization_domains WHERE organization_id = $1 ORDER BY id FOR UPDATE',
          [organizationId]
        );
        const target = addresses.rows.find((row) => Number(row.id) === domainId);
        if (!target) {
          await client.query('ROLLBACK');
          return errorResponse(res, 'Address not found', HTTP_NOT_FOUND);
        }
        if (target.is_primary) {
          await client.query('ROLLBACK');
          return errorResponse(res, 'domain_is_primary', HTTP_CONFLICT);
        }
        const exactLeft = addresses.rows
          .filter((row) => Number(row.id) !== domainId && !isWildcardDomain(row.domain));
        if (!isWildcardDomain(target.domain) && exactLeft.length === 0) {
          await client.query('ROLLBACK');
          return errorResponse(res, 'domain_last_address', HTTP_CONFLICT);
        }
        await client.query(
          'DELETE FROM organization_domains WHERE id = $1 AND organization_id = $2',
          [domainId, organizationId]
        );
        await client.query('COMMIT');
        return success(res, null, 'Address removed');
      } catch (removeError) {
        await client.query('ROLLBACK');
        throw removeError;
      } finally {
        client.release();
      }
    }));

  /** Update organization-wide dashboard tile visibility. */
  router.patch('/settings/dashboard', authenticate, blockDemoRoles, requirePermission('org.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const validation = validateDashboardConfiguration(req.body);

    if (validation.errors.length > 0) {
      return errorResponse(res, 'Invalid dashboard configuration', 400, validation.errors);
    }

    await pool.query(
      `INSERT INTO organization_settings
         (organization_id, setting_key, setting_value, created_at, updated_at)
       VALUES ($1, 'dashboard_configuration', $2::jsonb, NOW(), NOW())
       ON CONFLICT (organization_id, setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
      [organizationId, JSON.stringify(validation.value)]
    );

    orgSettingsCache.delete(`org_${organizationId}`);
    return success(
      res,
      { dashboard_configuration: validation.value },
      'Dashboard configuration updated'
    );
  }));

  /**
   * Choose the unit's optional interface languages and their fallback.
   * French and English are always offered and need no setting.
   */
  router.patch('/settings/languages', authenticate, blockDemoRoles, requirePermission('org.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const validation = validateInterfaceLanguages(req.body);

    if (validation.errors.length > 0) {
      return errorResponse(res, 'Invalid interface languages', HTTP_BAD_REQUEST, validation.errors);
    }

    await pool.query(
      `INSERT INTO organization_settings
         (organization_id, setting_key, setting_value, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (organization_id, setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
      [organizationId, INTERFACE_LANGUAGES_SETTING_KEY, JSON.stringify(validation.value)]
    );

    orgSettingsCache.delete(`org_${organizationId}`);
    return success(
      res,
      { [INTERFACE_LANGUAGES_SETTING_KEY]: validation.value },
      'Interface languages updated'
    );
  }));

  /** Update which optional buttons the parent dashboard shows. */
  router.patch('/settings/parent-dashboard', authenticate, blockDemoRoles, requirePermission('org.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const validation = validateParentDashboardConfiguration(req.body);

    if (validation.errors.length > 0) {
      return errorResponse(res, 'Invalid parent dashboard configuration', HTTP_BAD_REQUEST, validation.errors);
    }

    await pool.query(
      `INSERT INTO organization_settings
         (organization_id, setting_key, setting_value, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (organization_id, setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
      [organizationId, PARENT_DASHBOARD_SETTING_KEY, JSON.stringify(validation.value)]
    );

    orgSettingsCache.delete(`org_${organizationId}`);
    return success(
      res,
      { parent_dashboard_configuration: validation.value },
      'Parent dashboard configuration updated'
    );
  }));

  router.put('/settings', authenticate, blockDemoRoles, requirePermission('organization.manage'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { setting_key, setting_value } = req.body || {};

    if (!setting_key) {
      return res.status(400).json({ success: false, message: 'setting_key is required' });
    }

    if (DEDICATED_SETTING_KEYS.has(req.body.setting_key)) {
      return errorResponse(res, 'This setting must be updated through its dedicated endpoint', HTTP_BAD_REQUEST);
    }

    await pool.query(
      `INSERT INTO organization_settings (organization_id, setting_key, setting_value, created_at, updated_at)
       VALUES ($2, $3, $1, NOW(), NOW())
       ON CONFLICT (organization_id, setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
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

    const supportedLanguages = ALL_INTERFACE_LANGUAGES;

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
   * Current email sender identity, plus the From domains this unit may use.
   * `default_sender` is what From shows when no unit address is set.
   */
  router.get('/settings/email-sender', authenticate, requirePermission('org.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const [stored, allowedFromDomains] = await Promise.all([
      pool.query(
        `SELECT setting_value FROM organization_settings
         WHERE organization_id = $1 AND setting_key = $2`,
        [organizationId, EMAIL_SENDER_SETTING_KEY]
      ),
      getUnitSenderDomains(pool, organizationId)
    ]);
    const current = stored.rows[0]?.setting_value || {};

    return success(res, {
      email_sender: {
        from_name: current.from_name || '',
        from_email: current.from_email || '',
        reply_to: current.reply_to || ''
      },
      allowed_from_domains: allowedFromDomains,
      default_sender: getDefaultSenderEmail(allowedFromDomains)
    });
  }));

  /**
   * Set how the unit's email presents itself: display name, Reply-To, and a
   * From address on one of the unit's authenticated domains.
   */
  router.patch('/settings/email-sender', authenticate, blockDemoRoles, requirePermission('org.edit'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const [allowedFromDomains, stored] = await Promise.all([
      getUnitSenderDomains(pool, organizationId),
      pool.query(
        `SELECT setting_value FROM organization_settings
         WHERE organization_id = $1 AND setting_key = $2`,
        [organizationId, EMAIL_SENDER_SETTING_KEY]
      )
    ]);
    // PATCH: a field the request leaves out keeps its stored value.
    const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const validation = validateEmailSenderSettings(
      { ...(stored.rows[0]?.setting_value || {}), ...input },
      allowedFromDomains
    );

    if (validation.errors.length > 0) {
      return errorResponse(res, 'Invalid email sender settings', HTTP_BAD_REQUEST, validation.errors);
    }

    await pool.query(
      `INSERT INTO organization_settings
         (organization_id, setting_key, setting_value, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (organization_id, setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
      [organizationId, EMAIL_SENDER_SETTING_KEY, JSON.stringify(validation.value)]
    );

    orgSettingsCache.delete(`org_${organizationId}`);
    logger.info(`Organization ${organizationId} email sender updated by user ${req.user.id}`);

    return success(
      res,
      {
        email_sender: validation.value,
        allowed_from_domains: allowedFromDomains,
        default_sender: getDefaultSenderEmail(allowedFromDomains)
      },
      'Email sender updated'
    );
  }));

  /**
   * @swagger
   * /api/organizations:
   *   post:
   *     summary: Create new organization
   *     description: >
   *       Create a unit at its subdomain, for its branch, make the creator a
   *       district member of it, and invite its unit administrator by email.
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
   *               - subdomain
   *               - program_section
   *               - leader_email
   *             properties:
   *               name:
   *                 type: string
   *               subdomain:
   *                 type: string
   *                 description: Label before .wampums.app (config/unit_subdomains.json)
   *               program_section:
   *                 type: string
   *                 enum: [general, beavers, cubs, scouts, pioneers, rovers]
   *               leader_email:
   *                 type: string
   *                 format: email
   *               language:
   *                 type: string
   *                 description: Language of the invitation email
   *     responses:
   *       201:
   *         description: Organization created; data.leader_invitation says whether the email went
   *       400:
   *         description: A field is missing or invalid (errors names it)
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: The caller cannot grant the unit administrator role
   *       409:
   *         description: subdomain_taken
   */
  router.post('/', authenticate, blockDemoRoles, requirePermission('org.create'), validateLeaderEmail, asyncHandler(async (req, res) => {
    const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
    // The same rules as Unit Settings: only known fields, a logo that is a URL.
    const validation = validateOrganizationInfo(input);
    const { hostname, problem: subdomainProblem } = readUnitSubdomain(input.subdomain);
    const programSection = PROGRAM_SECTION_KEYS.has(input.program_section) ? input.program_section : null;
    const errors = [
      ...validation.errors,
      ...(subdomainProblem ? [{ field: 'subdomain', msg: subdomainProblem }] : []),
      ...(programSection ? [] : [{ field: 'program_section', msg: 'program_section_required' }]),
      ...validationResult(req).array().map((problem) => ({ field: problem.path, msg: problem.msg })),
    ];
    if (errors.length > 0) {
      return errorResponse(res, 'Invalid organization settings', 400, errors);
    }

    const orgInfo = validation.value;
    const { name } = orgInfo;
    const userId = req.user.id;
    const leaderEmail = normalizeEmailValue(input.leader_email);

    // Asked before any work; the unique index settles a race when the domain is written.
    if (await isDomainTaken(pool, hostname)) {
      return errorResponse(res, 'subdomain_taken', HTTP_CONFLICT, [{ field: 'subdomain', msg: 'subdomain_taken' }]);
    }

    const client = await pool.connect();
    let invitation = null;

    try {
      await client.query('BEGIN');

      // The creator gets the built-in district role, which holds every permission (migration 016).
      // This assigns a role; it decides no access.
      const districtRoleResult = await client.query(
        // policy-allow role-names: built-in roles may be looked up by name (CLAUDE.md §3)
        `SELECT id FROM roles WHERE role_name = 'district' AND organization_id IS NULL LIMIT 1`
      );
      if (districtRoleResult.rows.length === 0) {
        throw new Error('District role not found; cannot assign organization owner role');
      }
      const districtRoleId = districtRoleResult.rows[0].id;

      // The branch is set before anything is installed: the starter activities
      // and the unit's vocabulary follow it.
      const orgResult = await client.query(
        `INSERT INTO organizations (name, program_section, created_at)
         VALUES ($1, $2, NOW())
         RETURNING id, default_language`,
        [name, programSection]
      );

      const newOrganizationId = orgResult.rows[0].id;

      const domainResult = await client.query(
        `INSERT INTO organization_domains (organization_id, domain, is_primary)
         VALUES ($1, $2, TRUE)
         ON CONFLICT ((lower(domain))) DO NOTHING
         RETURNING id`,
        [newOrganizationId, hostname]
      );
      if (domainResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return errorResponse(res, 'subdomain_taken', HTTP_CONFLICT, [{ field: 'subdomain', msg: 'subdomain_taken' }]);
      }

      // Install versioned formats and their safe role policy from the
      // repository catalog. This works even when no template tenant exists.
      await installDefaultFormFormats(client, newOrganizationId);

      // Insert organization settings
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
      // The branch's vocabulary (tanières, patrouilles…), saved as the unit
      // settings would save it, so the unit never shows another branch's terms.
      await client.query(
        `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
         VALUES ($1, 'unit_vocabulary', $2)
         ON CONFLICT (organization_id, setting_key) DO NOTHING`,
        [newOrganizationId, JSON.stringify(buildVocabularyForProfile(getProfileForProgramSection(programSection)))]
      );

      await ensureProgramSectionsSeeded(client, newOrganizationId);

      // The default starter activities, in the unit's language, so a new
      // unit's planner and meeting preparation have a repertoire from day one.
      await installDefaultStarterActivities(client, newOrganizationId, userId);

      // Link current user to the new organization with district-level permissions.
      //
      // The role id is cast explicitly: `jsonb_build_array` takes "any", so
      // PostgreSQL has nothing to infer a parameter type from and rejects the
      // statement outright with "could not determine data type of parameter $3".
      await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, role_ids, created_at)
         VALUES ($1, $2, jsonb_build_array($3::int), NOW())`,
        [userId, newOrganizationId, districtRoleId]
      );

      // The unit's administrator is invited, never given an account: nothing
      // exists for them until they accept. Their role may be granted only by
      // someone holding all of its permissions (services/roleAssignment.js).
      const unitAdminRoleId = await resolveUnitRoleId(client, UNIT_ADMIN_ROLE, newOrganizationId);
      if (!unitAdminRoleId) {
        throw new Error('Unit administrator role not found; cannot invite the unit administrator');
      }
      const grantable = await checkRolesGrantable(client, [unitAdminRoleId], req.userPermissions || []);
      if (!grantable.allowed) {
        await client.query('ROLLBACK');
        return forbidden(res, 'You can only invite into roles whose permissions you hold', grantable.required, grantable.missing);
      }

      const creator = await client.query('SELECT lower(email) AS email FROM users WHERE id = $1', [userId]);
      // The creator is already a member, with every right: there is no one to invite.
      if (creator.rows[0]?.email !== leaderEmail) {
        const created = await createInvitation(client, {
          organizationId: newOrganizationId,
          email: leaderEmail,
          language: resolveInvitationLanguage(input.language, orgResult.rows[0].default_language),
          invitedBy: userId,
          roleIds: [unitAdminRoleId],
        });
        if (!created.ok) {
          throw new Error(`Unit administrator invitation refused in a new unit: ${created.reason}`);
        }
        invitation = created;
      }

      await client.query('COMMIT');

      // Sent once the unit exists. A failed send leaves the invitation pending,
      // to be resent from the new unit's invitations.
      const emailSent = invitation
        ? await deliverParentInvitation(pool, { invitation: invitation.invitation, token: invitation.token, logger })
        : false;

      return success(res, {
        organization_id: newOrganizationId,
        domain: hostname,
        leader_invitation: {
          email: leaderEmail,
          invited: Boolean(invitation),
          email_sent: emailSent,
        },
      }, 'Organization created successfully', HTTP_CREATED);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
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
  router.post('/switch', authenticate, validateIdBody('organization_id'), checkValidation, asyncHandler(async (req, res) => {
    // policy-allow client-org-id: the switch endpoint itself; membership is verified below
    const organizationId = Number(req.body?.organization_id);

    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    // Verify user is an active member of this organization
    const membershipCheck = await pool.query(
      `SELECT id FROM user_organizations WHERE user_id = $1 AND organization_id = $2 AND status = 'active'`,
      [req.user.id, organizationId]
    );

    if (membershipCheck.rows.length === 0) {
      return forbidden(res, 'You do not have access to this organization', [], [], { code: 'not_a_member' });
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

  // The two reads a signed-out client needs, at their pre-/api/v1 paths
  // (/public/settings, /public/get_organization_id) for mobile builds already
  // installed. Nothing else of this router is reachable outside /api/v1.
  const legacyPublicRouter = express.Router();
  legacyPublicRouter.get('/settings', sendPublicSettings);
  legacyPublicRouter.get('/get_organization_id', sendOrganizationId);
  router.legacyPublic = legacyPublicRouter;

  return router;
};
