/**
 * Badge Routes
 *
 * Handles badge system management, progress tracking, approvals, and reporting
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/badges
 */

const express = require('express');
const router = express.Router();

// Import utilities
const { getPointSystemRules } = require('../utils/api-helpers');
const { authenticate, getOrganizationId, requirePermission, blockDemoRoles } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/response');

const DEFAULT_LEVELS = [
  { level: 1, label_key: 'badge_level_1' },
  { level: 2, label_key: 'badge_level_2' },
  { level: 3, label_key: 'badge_level_3' }
];

const normalizeLevels = (levels, fallbackCount = DEFAULT_LEVELS.length) => {
  if (Array.isArray(levels) && levels.length > 0) {
    return levels;
  }
  return DEFAULT_LEVELS.slice(0, fallbackCount);
};

const getLevelCount = (levels, levelCount) => {
  if (Array.isArray(levels) && levels.length > 0) {
    return levels.length;
  }
  return levelCount || DEFAULT_LEVELS.length;
};

async function fetchTemplate(client, templateId, organizationId) {
  if (!templateId) return null;
  const templateResult = await client.query(
    `SELECT id, name, template_key, translation_key, section, level_count, levels, image
     FROM badge_templates
     WHERE id = $1 AND organization_id = $2`,
    [templateId, organizationId]
  );
  return templateResult.rows[0] || null;
}

async function getParticipantSection(client, participantId, organizationId) {
  const sectionResult = await client.query(
    `SELECT COALESCE(g.section, 'general') AS section
     FROM participant_groups pg
     JOIN groups g ON pg.group_id = g.id
     WHERE pg.participant_id = $1 AND pg.organization_id = $2
     LIMIT 1`,
    [participantId, organizationId]
  );

  return sectionResult.rows[0]?.section || 'general';
}

function determineNextLevel(existingLevels, templateLevelCount, requestedLevel) {
  const usedLevels = new Set(
    existingLevels
      .map((row) => parseInt(row.etoiles || row.level || row, 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  if (requestedLevel) {
    if (requestedLevel < 1 || requestedLevel > templateLevelCount) {
      throw new Error('Invalid level for this badge template');
    }
    if (usedLevels.has(requestedLevel)) {
      throw new Error('Level already recorded for this badge');
    }
    return requestedLevel;
  }

  for (let level = 1; level <= templateLevelCount; level += 1) {
    if (!usedLevels.has(level)) {
      return level;
    }
  }
  return null;
}

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with badge routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/badge-progress:
   *   get:
   *     summary: Get badge progress for a participant
   *     description: Retrieve all badge progress records for a specific participant
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Participant ID
   *     responses:
   *       200:
   *         description: Badge progress retrieved successfully
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   */
  router.get('/badge-progress', authenticate, requirePermission('badges.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const participantId = req.query.participant_id;

      if (!participantId) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const result = await pool.query(
        `SELECT bp.*,
                bt.name AS badge_name,
                bt.template_key,
                bt.translation_key,
                bt.section AS badge_section,
                bt.level_count,
                bt.image,
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.participant_id = $1 AND bp.organization_id = $2
         ORDER BY bp.date_obtention DESC`,
        [participantId, organizationId]
      );

      res.json({ success: true, data: result.rows });
  }));

  /**
   * @swagger
   * /api/pending-badges:
   *   get:
   *     summary: Get pending badges for approval
   *     description: Retrieve all badges awaiting approval (requires admin or leader role)
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Pending badges retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/pending-badges', authenticate, requirePermission('badges.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT bp.*,
                p.first_name,
                p.last_name,
                bt.name AS badge_name,
                bt.translation_key,
                bt.section AS badge_section,
                bt.level_count,
                bt.image,
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN participants p ON bp.participant_id = p.id
         JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.organization_id = $1 AND bp.status = 'pending'
         ORDER BY bp.created_at DESC`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
  }));

  /**
   * @swagger
   * /api/save-badge-progress:
   *   post:
   *     summary: Save badge progress (submit for approval)
   *     description: Submit a new badge progress entry for admin approval
   *     tags: [Badges]
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
   *               - badge_template_id
   *             properties:
   *               participant_id:
   *                 type: integer
   *               badge_template_id:
   *                 type: integer
   *               objectif:
   *                 type: string
   *               description:
   *                 type: string
   *               fierte:
   *                 type: boolean
   *               raison:
   *                 type: string
   *               date_obtention:
   *                 type: string
   *                 format: date
   *               etoiles:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Badge progress submitted successfully
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   */
  router.post('/save-badge-progress', authenticate, blockDemoRoles, requirePermission('badges.manage'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const {
        participant_id,
        badge_template_id,
        objectif,
        description,
        fierte,
        raison,
        date_obtention,
        star_type
      } = req.body;
      const requestedLevel = parseInt(req.body.level ?? req.body.etoiles, 10) || null;
      const validStarType = ['proie', 'battue'].includes(star_type) ? star_type : 'proie';

      if (!participant_id || !badge_template_id) {
        return res.status(400).json({ success: false, message: 'Participant ID and badge_template_id are required' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const participantOrg = await client.query(
          `SELECT 1 FROM participant_organizations WHERE participant_id = $1 AND organization_id = $2`,
          [participant_id, organizationId]
        );
        if (participantOrg.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Participant not found in organization' });
        }

        const template = await fetchTemplate(client, parseInt(badge_template_id, 10), organizationId);
        if (!template) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Badge template not found' });
        }

        const participantSection = await getParticipantSection(client, participant_id, organizationId);
        if (
          template.section &&
          participantSection &&
          template.section !== 'general' &&
          template.section !== participantSection
        ) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Badge template section does not match participant section'
          });
        }

        const templateLevels = normalizeLevels(template.levels, template.level_count);
        const templateLevelCount = getLevelCount(templateLevels, template.level_count);
        const existingLevelsResult = await client.query(
          `SELECT etoiles FROM badge_progress
           WHERE participant_id = $1 AND badge_template_id = $2 AND organization_id = $3`,
          [participant_id, template.id, organizationId]
        );

        let nextLevel;
        try {
          nextLevel = determineNextLevel(existingLevelsResult.rows, templateLevelCount, requestedLevel);
        } catch (validationError) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: validationError.message });
        }

        if (!nextLevel) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'All levels for this badge have already been recorded'
          });
        }

        // Check if star_type column exists
        const columnCheck = await client.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'badge_progress' AND column_name = 'star_type'`
        );
        const hasStarType = columnCheck.rows.length > 0;

        let result;
        if (hasStarType) {
          result = await client.query(
            `INSERT INTO badge_progress
             (participant_id, organization_id, badge_template_id, territoire_chasse, section, objectif, description, fierte, raison, date_obtention, etoiles, status, star_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)
             RETURNING *`,
            [
              participant_id,
              organizationId,
              template.id,
              template.name,
              template.section || participantSection || 'general',
              objectif,
              description,
              fierte || false,
              raison,
              date_obtention,
              nextLevel,
              validStarType
            ]
          );
        } else {
          // Fallback without star_type column
          result = await client.query(
            `INSERT INTO badge_progress
             (participant_id, organization_id, badge_template_id, territoire_chasse, section, objectif, description, fierte, raison, date_obtention, etoiles, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
             RETURNING *`,
            [
              participant_id,
              organizationId,
              template.id,
              template.name,
              template.section || participantSection || 'general',
              objectif,
              description,
              fierte || false,
              raison,
              date_obtention,
              nextLevel
            ]
          );
        }

        await client.query('COMMIT');
        const inserted = {
          ...result.rows[0],
          badge_name: template.name,
          translation_key: template.translation_key,
          badge_section: template.section,
          level_count: templateLevelCount,
          template_levels: templateLevels
        };
        res.json({ success: true, data: inserted, message: 'Badge progress submitted for approval' });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
  }));

  /**
   * @swagger
   * /api/approve-badge:
   *   post:
   *     summary: Approve badge
   *     description: Approve a badge and award points (requires admin or leader role)
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - badge_id
   *             properties:
   *               badge_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Badge approved successfully
   *       400:
   *         description: Badge ID is required
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   *       404:
   *         description: Badge not found
   */
  router.post('/approve-badge', authenticate, blockDemoRoles, requirePermission('badges.approve'), asyncHandler(async (req, res) => {
      const userId = req.user.id;
      const organizationId = await getOrganizationId(req, pool);
      const { badge_id } = req.body;

      if (!badge_id) {
        return res.status(400).json({ success: false, message: 'Badge ID is required' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get the badge details
        const badgeResult = await client.query(
          `SELECT * FROM badge_progress WHERE id = $1 AND organization_id = $2`,
          [badge_id, organizationId]
        );

        if (badgeResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Badge not found' });
        }

        const badge = badgeResult.rows[0];

        // Update badge status to approved
        await client.query(
          `UPDATE badge_progress
           SET status = 'approved', approval_date = NOW()
           WHERE id = $1`,
          [badge_id]
        );

        // Get point system rules for badge earn points
        const pointRules = await getPointSystemRules(client, organizationId);
        const badgeEarnPoints = pointRules.badges?.earn || 5;

        // Get participant's group for proper point tracking
        const groupResult = await client.query(
          `SELECT group_id FROM participant_groups
           WHERE participant_id = $1 AND organization_id = $2`,
          [badge.participant_id, organizationId]
        );
        const groupId = groupResult.rows.length > 0 ? groupResult.rows[0].group_id : null;

        // Award points for earning the badge
        await client.query(
          `INSERT INTO points (participant_id, group_id, organization_id, value, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [badge.participant_id, groupId, organizationId, badgeEarnPoints]
        );

        await client.query('COMMIT');
        console.log(`[badge] Badge ${badge_id} approved for participant ${badge.participant_id}, points: +${badgeEarnPoints}`);
        res.json({ success: true, message: 'Badge approved', points: badgeEarnPoints });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
  }));

  /**
   * @swagger
   * /api/reject-badge:
   *   post:
   *     summary: Reject badge
   *     description: Reject a badge submission (requires admin or leader role)
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - badge_id
   *             properties:
   *               badge_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Badge rejected successfully
   *       400:
   *         description: Badge ID is required
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   *       404:
   *         description: Badge not found
   */
  router.post('/reject-badge', authenticate, blockDemoRoles, requirePermission('badges.approve'), asyncHandler(async (req, res) => {
      const userId = req.user.id;
      const organizationId = await getOrganizationId(req, pool);
      const { badge_id } = req.body;

      if (!badge_id) {
        return res.status(400).json({ success: false, message: 'Badge ID is required' });
      }

      const result = await pool.query(
        `UPDATE badge_progress
         SET status = 'rejected', approval_date = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [badge_id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Badge not found' });
      }

      console.log(`[badge] Badge ${badge_id} rejected`);
      res.json({ success: true, message: 'Badge rejected' });
  }));

  /**
   * @swagger
   * /api/badge-summary:
   *   get:
   *     summary: Get badge summary
   *     description: Retrieve all badges for organization with participant details
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Badge summary retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/badge-summary', authenticate, requirePermission('badges.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT bp.*,
                p.first_name,
                p.last_name,
                bt.name AS badge_name,
                bt.template_key,
                bt.translation_key,
                bt.section AS badge_section,
                bt.level_count,
                bt.image,
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN participants p ON bp.participant_id = p.id
         JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.organization_id = $1
         ORDER BY bp.date_obtention DESC`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
  }));

  /**
   * @swagger
   * /api/badge-history:
   *   get:
   *     summary: Get badge history for a participant
   *     description: Retrieve approved badge history for a specific participant
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Participant ID
   *     responses:
   *       200:
   *         description: Badge history retrieved successfully
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   */
  router.get('/badge-history', authenticate, requirePermission('badges.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const participantId = req.query.participant_id;

      if (!participantId) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const result = await pool.query(
        `SELECT bp.*,
                bt.name AS badge_name,
                bt.translation_key,
                bt.section AS badge_section,
                bt.level_count,
                bt.image,
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.participant_id = $1 AND bp.organization_id = $2 AND bp.status = 'approved'
         ORDER BY bp.date_obtention DESC`,
        [participantId, organizationId]
      );

      res.json({ success: true, data: result.rows });
  }));

  /**
   * @swagger
   * /api/current-stars:
   *   get:
   *     summary: Get current stars for a participant
   *     description: Calculate total approved stars for a specific participant
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Participant ID
   *     responses:
   *       200:
   *         description: Total stars retrieved successfully
   *       400:
   *         description: Participant ID is required
   *       401:
   *         description: Unauthorized
   */
  router.get('/current-stars', authenticate, requirePermission('badges.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const participantId = req.query.participant_id;
      const templateId = req.query.badge_template_id ? parseInt(req.query.badge_template_id, 10) : null;
      const territoireName = req.query.territoire;

      if (!participantId) {
        return res.status(400).json({ success: false, message: 'Participant ID is required' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        let template = null;

        if (templateId) {
          template = await fetchTemplate(client, templateId, organizationId);
        } else if (territoireName) {
          const templateResult = await client.query(
            `SELECT id, name, template_key, translation_key, section, level_count, levels, image
             FROM badge_templates
             WHERE organization_id = $1 AND (name = $2 OR template_key = lower(regexp_replace($2, '[^a-z0-9]+', '_', 'g')))
             LIMIT 1`,
            [organizationId, territoireName]
          );
          template = templateResult.rows[0] || null;
        }

        if (!template) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Badge template not found' });
        }

        const countsResult = await client.query(
          `SELECT 
             COUNT(*) FILTER (WHERE status = 'approved') AS approved_levels,
             COUNT(*) FILTER (WHERE status = 'pending') AS pending_levels
           FROM badge_progress
           WHERE participant_id = $1 AND organization_id = $2 AND badge_template_id = $3`,
          [participantId, organizationId, template.id]
        );

        const approvedLevels = parseInt(countsResult.rows[0]?.approved_levels, 10) || 0;
        const pendingLevels = parseInt(countsResult.rows[0]?.pending_levels, 10) || 0;
        const templateLevelCount = getLevelCount(normalizeLevels(template.levels, template.level_count), template.level_count);

        await client.query('COMMIT');
        res.json({
          success: true,
          data: {
            current_stars: approvedLevels,
            has_pending: pendingLevels > 0,
            max_level: templateLevelCount,
            badge_template_id: template.id,
            section: template.section
          }
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
   * /api/badge-system-settings:
   *   get:
   *     summary: Get badge system settings
   *     description: Retrieve badge system configuration including territoires and structure
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Badge system settings retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/badge-system-settings', authenticate, requirePermission('badges.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const [settingsResult, templateResult] = await Promise.all([
        pool.query(
          `SELECT setting_value FROM organization_settings
           WHERE organization_id = $1 AND setting_key = 'badge_system'`,
          [organizationId]
        ),
        pool.query(
          `SELECT id, name, template_key, translation_key, section, level_count, levels, image, created_at, updated_at
           FROM badge_templates
           WHERE organization_id = $1
           ORDER BY section, name`,
          [organizationId]
        )
      ]);

      const templates = templateResult.rows.map((template) => {
        const normalizedLevels = normalizeLevels(template.levels, template.level_count);
        return {
          ...template,
          levels: normalizedLevels,
          level_count: getLevelCount(normalizedLevels, template.level_count)
        };
      });

      let dataPayload = { templates };

      if (settingsResult.rows.length > 0) {
        try {
          const badgeSystem = JSON.parse(settingsResult.rows[0].setting_value);
          dataPayload = { ...badgeSystem, templates };
        } catch (e) {
          dataPayload = { settings: settingsResult.rows[0].setting_value, templates };
        }
      }

      res.json({
        success: true,
        data: dataPayload,
        message: templates.length === 0 ? 'No badge system settings found' : undefined
      });
  }));

  /**
   * @swagger
   * /api/badge-progress/{id}:
   *   put:
   *     summary: Update badge progress status
   *     description: Update badge status with reviewer comments (requires admin or leader role)
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Badge progress ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - status
   *             properties:
   *               status:
   *                 type: string
   *                 enum: [approved, rejected, pending]
   *               reviewer_comments:
   *                 type: string
   *     responses:
   *       200:
   *         description: Badge status updated successfully
   *       400:
   *         description: Missing required fields or invalid status
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Badge progress not found
   */
  router.put('/badge-progress/:id', authenticate, blockDemoRoles, requirePermission('badges.manage'), asyncHandler(async (req, res) => {
      const userId = req.user.id; // Set by authenticate middleware
      const organizationId = await getOrganizationId(req, pool);
      const badgeId = parseInt(req.params.id);
      const {
        status,
        reviewer_comments,
        etoiles,
        objectif,
        description,
        date_obtention,
        territoire_chasse,
        fierte,
        raison
      } = req.body;

      if (!badgeId) {
        return res.status(400).json({ success: false, message: 'Badge ID is required' });
      }

      if (
        status === undefined &&
        reviewer_comments === undefined &&
        etoiles === undefined &&
        objectif === undefined &&
        description === undefined &&
        date_obtention === undefined &&
        territoire_chasse === undefined &&
        fierte === undefined &&
        raison === undefined
      ) {
        return res.status(400).json({ success: false, message: 'No update fields provided' });
      }

      if (status && !['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status value' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const existingResult = await client.query(
          `SELECT bp.*, bt.level_count, COALESCE(bt.levels, '[]'::jsonb) AS template_levels
           FROM badge_progress bp
           JOIN badge_templates bt ON bp.badge_template_id = bt.id
           WHERE bp.id = $1 AND bp.organization_id = $2`,
          [badgeId, organizationId]
        );

        if (existingResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Badge progress not found' });
        }

        const existingBadge = existingResult.rows[0];
        const templateLevels = normalizeLevels(existingBadge.template_levels, existingBadge.level_count);
        const templateLevelCount = getLevelCount(templateLevels, existingBadge.level_count);

        const updateFields = [];
        const values = [];
        let valueIndex = 1;
        let targetLevel = null;

        if (status) {
          updateFields.push(`status = $${valueIndex++}`);
          values.push(status);

          if (status === 'approved') {
            updateFields.push('approval_date = NOW()');
          } else {
            updateFields.push('approval_date = NULL');
          }
        }

        if (reviewer_comments !== undefined) {
          updateFields.push(`reviewer_comments = $${valueIndex++}`);
          values.push(reviewer_comments || null);
        }

        if (etoiles !== undefined) {
          targetLevel = parseInt(etoiles, 10) || 0;
          if (targetLevel < 1 || targetLevel > templateLevelCount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Invalid level for this badge' });
          }

          const conflictCheck = await client.query(
            `SELECT 1 FROM badge_progress
             WHERE participant_id = $1 AND badge_template_id = $2 AND etoiles = $3 AND id <> $4 AND organization_id = $5`,
            [existingBadge.participant_id, existingBadge.badge_template_id, targetLevel, badgeId, organizationId]
          );

          if (conflictCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, message: 'Level already exists for this badge' });
          }

          updateFields.push(`etoiles = $${valueIndex++}`);
          values.push(targetLevel);
        }

        if (objectif !== undefined) {
          updateFields.push(`objectif = $${valueIndex++}`);
          values.push(objectif || null);
        }

        if (description !== undefined) {
          updateFields.push(`description = $${valueIndex++}`);
          values.push(description || null);
        }

        if (date_obtention !== undefined) {
          updateFields.push(`date_obtention = $${valueIndex++}`);
          values.push(date_obtention || null);
        }

        if (territoire_chasse !== undefined) {
          updateFields.push(`territoire_chasse = $${valueIndex++}`);
          values.push(territoire_chasse || null);
        }

        if (fierte !== undefined) {
          updateFields.push(`fierte = $${valueIndex++}`);
          values.push(!!fierte);
        }

        if (raison !== undefined) {
          updateFields.push(`raison = $${valueIndex++}`);
          values.push(raison || null);
        }

        const updateResult = await client.query(
          `UPDATE badge_progress
           SET ${updateFields.join(', ')}
           WHERE id = $${valueIndex++} AND organization_id = $${valueIndex}
           RETURNING *`,
          [...values, badgeId, organizationId]
        );

        const badge = updateResult.rows[0];

        // If approved, award points
        if (status === 'approved') {
          const pointRules = await getPointSystemRules(client, organizationId);
          const badgeEarnPoints = pointRules.badges?.earn || 5;

          // Get participant's group for proper point tracking
          const groupResult = await client.query(
            `SELECT group_id FROM participant_groups
             WHERE participant_id = $1 AND organization_id = $2`,
            [badge.participant_id, organizationId]
          );
          const groupId = groupResult.rows.length > 0 ? groupResult.rows[0].group_id : null;

          // Award points for earning the badge
          await client.query(
            `INSERT INTO points (participant_id, group_id, organization_id, value, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [badge.participant_id, groupId, organizationId, badgeEarnPoints]
          );
        }

        await client.query('COMMIT');
        const message = status ? `Badge ${status} successfully` : 'Badge updated';
        res.json({
          success: true,
          data: badge,
          message
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
   * /api/badges-awaiting-delivery:
   *   get:
   *     summary: Get badges awaiting physical delivery
   *     description: Retrieve all approved badges that have not been physically delivered
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Badges awaiting delivery retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/badges-awaiting-delivery', authenticate, requirePermission('badges.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      // Check if delivered_at column exists
      let hasDeliveredAt = false;
      try {
        const columnCheck = await pool.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'badge_progress' AND column_name = 'delivered_at'`
        );
        hasDeliveredAt = columnCheck.rows.length > 0;
      } catch (err) {
        console.log('[badges-awaiting-delivery] Could not check for delivered_at column:', err.message);
      }

      if (!hasDeliveredAt) {
        // If column doesn't exist, return empty array (migration needs to be run)
        return res.json({ success: true, data: [], message: 'Delivery tracking not enabled. Run migrations.' });
      }

      const result = await pool.query(
        `SELECT bp.id,
                bp.participant_id,
                bp.badge_template_id,
                bp.territoire_chasse,
                bp.objectif,
                bp.description,
                bp.fierte,
                bp.raison,
                bp.date_obtention,
                bp.etoiles,
                bp.status,
                bp.approval_date,
                bp.section,
                bp.organization_id,
                bp.delivered_at,
                bp.star_type,
                p.first_name,
                p.last_name,
                p.totem,
                bt.name AS badge_name,
                bt.template_key,
                bt.translation_key,
                bt.section AS badge_section,
                bt.level_count,
                bt.image,
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN participants p ON bp.participant_id = p.id
         LEFT JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.organization_id = $1
           AND bp.status = 'approved'
           AND bp.delivered_at IS NULL
         ORDER BY bp.approval_date ASC`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
  }));

  /**
   * @swagger
   * /api/mark-badge-delivered:
   *   post:
   *     summary: Mark badge as physically delivered
   *     description: Mark a badge as having been physically given to the participant
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - badge_id
   *             properties:
   *               badge_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Badge marked as delivered successfully
   *       400:
   *         description: Badge ID is required
   *       404:
   *         description: Badge not found
   */
  router.post('/mark-badge-delivered', authenticate, blockDemoRoles, requirePermission('badges.approve'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { badge_id } = req.body;

      if (!badge_id) {
        return res.status(400).json({ success: false, message: 'Badge ID is required' });
      }

      // Check if delivered_at column exists
      const columnCheck = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'badge_progress' AND column_name = 'delivered_at'`
      );

      if (columnCheck.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Delivery tracking not enabled. Run migrations.' });
      }

      const result = await pool.query(
        `UPDATE badge_progress
         SET delivered_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status = 'approved'
         RETURNING *`,
        [badge_id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Badge not found or not approved' });
      }

      console.log(`[badge] Badge ${badge_id} marked as delivered`);
      res.json({ success: true, data: result.rows[0], message: 'Badge marked as delivered' });
  }));

  /**
   * @swagger
   * /api/mark-badges-delivered-bulk:
   *   post:
   *     summary: Mark multiple badges as delivered
   *     description: Bulk mark multiple badges as physically delivered
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - badge_ids
   *             properties:
   *               badge_ids:
   *                 type: array
   *                 items:
   *                   type: integer
   *     responses:
   *       200:
   *         description: Badges marked as delivered successfully
   *       400:
   *         description: Badge IDs array is required
   */
  router.post('/mark-badges-delivered-bulk', authenticate, blockDemoRoles, requirePermission('badges.approve'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { badge_ids } = req.body;

      if (!Array.isArray(badge_ids) || badge_ids.length === 0) {
        return res.status(400).json({ success: false, message: 'Badge IDs array is required' });
      }

      // Check if delivered_at column exists
      const columnCheck = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'badge_progress' AND column_name = 'delivered_at'`
      );

      if (columnCheck.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Delivery tracking not enabled. Run migrations.' });
      }

      const result = await pool.query(
        `UPDATE badge_progress
         SET delivered_at = NOW()
         WHERE id = ANY($1) AND organization_id = $2 AND status = 'approved' AND delivered_at IS NULL
         RETURNING id`,
        [badge_ids, organizationId]
      );

      console.log(`[badge] Bulk delivered ${result.rowCount} badges`);
      res.json({
        success: true,
        message: `${result.rowCount} badge(s) marked as delivered`,
        count: result.rowCount
      });
  }));

  /**
   * @swagger
   * /api/badge-tracker-summary:
   *   get:
   *     summary: Get comprehensive badge tracker summary
   *     description: Retrieve badge data with delivery status, grouped by participant
   *     tags: [Badges]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Badge tracker summary retrieved successfully
   */
  router.get('/badge-tracker-summary', authenticate, requirePermission('badges.view'), asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      // Check if new columns exist (migration may not have been run yet)
      let hasNewColumns = false;
      try {
        const columnCheck = await pool.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'badge_progress' AND column_name = 'delivered_at'`
        );
        hasNewColumns = columnCheck.rows.length > 0;
      } catch (err) {
        console.log('[badge-tracker-summary] Could not check for new columns:', err.message);
      }

      // Get all badge progress with participant and template info
      // Use LEFT JOIN for badge_templates since some badges may not have a template (legacy data)
      let badgesQuery;
      if (hasNewColumns) {
        badgesQuery = `SELECT bp.id,
                bp.participant_id,
                bp.badge_template_id,
                bp.territoire_chasse,
                bp.objectif,
                bp.description,
                bp.fierte,
                bp.raison,
                bp.date_obtention,
                bp.etoiles,
                bp.status,
                bp.approval_date,
                bp.section,
                bp.organization_id,
                bp.delivered_at,
                bp.star_type,
                p.first_name,
                p.last_name,
                p.totem,
                bt.name AS badge_name,
                bt.template_key,
                bt.translation_key,
                bt.section AS badge_section,
                bt.level_count,
                bt.image,
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN participants p ON bp.participant_id = p.id
         LEFT JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.organization_id = $1
         ORDER BY p.first_name, p.last_name, COALESCE(bt.name, bp.territoire_chasse), bp.etoiles`;
      } else {
        // Fallback query without new columns
        badgesQuery = `SELECT bp.id,
                bp.participant_id,
                bp.badge_template_id,
                bp.territoire_chasse,
                bp.objectif,
                bp.description,
                bp.fierte,
                bp.raison,
                bp.date_obtention,
                bp.etoiles,
                bp.status,
                bp.approval_date,
                bp.section,
                bp.organization_id,
                NULL::timestamp AS delivered_at,
                'proie'::text AS star_type,
                p.first_name,
                p.last_name,
                p.totem,
                bt.name AS badge_name,
                bt.template_key,
                bt.translation_key,
                bt.section AS badge_section,
                bt.level_count,
                bt.image,
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN participants p ON bp.participant_id = p.id
         LEFT JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.organization_id = $1
         ORDER BY p.first_name, p.last_name, COALESCE(bt.name, bp.territoire_chasse), bp.etoiles`;
      }

      const badgesResult = await pool.query(badgesQuery, [organizationId]);

      // Get templates for the organization
      const templatesResult = await pool.query(
        `SELECT id, name, template_key, translation_key, section, level_count, levels, image
         FROM badge_templates
         WHERE organization_id = $1
         ORDER BY section, name`,
        [organizationId]
      );

      // Get participants with their groups
      const participantsResult = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.totem,
                g.id AS group_id, g.name AS group_name, g.section
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );

      // Calculate stats
      const allBadges = badgesResult.rows;
      const stats = {
        totalParticipants: participantsResult.rows.length,
        totalApproved: allBadges.filter(b => b.status === 'approved').length,
        pendingApproval: allBadges.filter(b => b.status === 'pending').length,
        awaitingDelivery: allBadges.filter(b => b.status === 'approved' && !b.delivered_at).length,
        totalDelivered: allBadges.filter(b => b.delivered_at).length
      };

      res.json({
        success: true,
        data: {
          badges: allBadges,
          templates: templatesResult.rows,
          participants: participantsResult.rows,
          stats
        }
      });
  }));

  return router;
};
