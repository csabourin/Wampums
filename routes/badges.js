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
const { authenticate, getOrganizationId, requireOrganizationRole } = require('../middleware/auth');

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
    `SELECT id, name, template_key, translation_key, section, level_count, levels
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
  router.get('/badge-progress', authenticate, async (req, res) => {
    try {
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
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.participant_id = $1 AND bp.organization_id = $2
         ORDER BY bp.date_obtention DESC`,
        [participantId, organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching badge progress:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.get('/pending-badges', authenticate, requireOrganizationRole(['admin', 'leader']), async (req, res) => {
    try {
      const organizationId = req.organizationId; // Set by requireOrganizationRole middleware

      const result = await pool.query(
        `SELECT bp.*, 
                p.first_name, 
                p.last_name,
                bt.name AS badge_name,
                bt.translation_key,
                bt.section AS badge_section,
                bt.level_count,
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN participants p ON bp.participant_id = p.id
         JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.organization_id = $1 AND bp.status = 'pending'
         ORDER BY bp.created_at DESC`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching pending badges:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.post('/save-badge-progress', authenticate, requireOrganizationRole(), async (req, res) => {
    try {
      const organizationId = req.organizationId; // Set by requireOrganizationRole middleware
      const {
        participant_id,
        badge_template_id,
        objectif,
        description,
        fierte,
        raison,
        date_obtention
      } = req.body;
      const requestedLevel = parseInt(req.body.level ?? req.body.etoiles, 10) || null;

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

        const result = await client.query(
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
    } catch (error) {
      logger.error('Error saving badge progress:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.post('/approve-badge', authenticate, requireOrganizationRole(['admin', 'leader']), async (req, res) => {
    try {
      const userId = req.user.id;
      const organizationId = req.organizationId;
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
    } catch (error) {
      logger.error('Error approving badge:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.post('/reject-badge', authenticate, requireOrganizationRole(['admin', 'leader']), async (req, res) => {
    try {
      const userId = req.user.id;
      const organizationId = req.organizationId;
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
    } catch (error) {
      logger.error('Error rejecting badge:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.get('/badge-summary', authenticate, requireOrganizationRole(), async (req, res) => {
    try {
      const organizationId = req.organizationId;

      const result = await pool.query(
        `SELECT bp.*,
                p.first_name,
                p.last_name,
                bt.name AS badge_name,
                bt.template_key,
                bt.translation_key,
                bt.section AS badge_section,
                bt.level_count,
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN participants p ON bp.participant_id = p.id
         JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.organization_id = $1
         ORDER BY bp.date_obtention DESC`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching badge summary:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.get('/badge-history', authenticate, requireOrganizationRole(), async (req, res) => {
    try {
      const organizationId = req.organizationId;
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
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.participant_id = $1 AND bp.organization_id = $2 AND bp.status = 'approved'
         ORDER BY bp.date_obtention DESC`,
        [participantId, organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching badge history:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.get('/current-stars', authenticate, requireOrganizationRole(), async (req, res) => {
    try {
      const organizationId = req.organizationId;
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
            `SELECT id, name, template_key, translation_key, section, level_count, levels
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
    } catch (error) {
      logger.error('Error fetching current stars:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.get('/badge-system-settings', authenticate, requireOrganizationRole(), async (req, res) => {
    try {
      const organizationId = req.organizationId;

      const [settingsResult, templateResult] = await Promise.all([
        pool.query(
          `SELECT setting_value FROM organization_settings
           WHERE organization_id = $1 AND setting_key = 'badge_system'`,
          [organizationId]
        ),
        pool.query(
          `SELECT id, name, template_key, translation_key, section, level_count, levels, created_at, updated_at
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
    } catch (error) {
      logger.error('Error fetching badge system settings:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

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
  router.put('/badge-progress/:id', authenticate, requireOrganizationRole(['admin', 'leader', 'animation']), async (req, res) => {
    try {
      const userId = req.user.id; // Set by authenticate middleware
      const organizationId = req.organizationId; // Set by requireOrganizationRole middleware
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
    } catch (error) {
      logger.error('Error updating badge progress:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
