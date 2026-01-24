/**
 * Meetings Routes
 *
 * Handles meeting/reunion preparations, guests, reminders, and activities
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/meetings
 */

const express = require('express');
const router = express.Router();
const { check } = require('express-validator');

// Import utilities
const { getCurrentOrganizationId, verifyJWT, handleOrganizationResolutionError } = require('../utils/api-helpers');
const { validateDate, validateDateOptional, checkValidation } = require('../middleware/validation');
const { getMeetingSectionConfig } = require('../utils/meeting-sections');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with meeting routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/reunion-preparation:
   *   get:
   *     summary: Get reunion preparation for a date
   *     description: Retrieve meeting preparation details for a specific date
   *     tags: [Meetings]
   *     parameters:
   *       - in: query
   *         name: date
   *         schema:
   *           type: string
   *           format: date
   *         description: Date of reunion (defaults to today)
   *     responses:
   *       200:
   *         description: Reunion preparation retrieved successfully
   */
  router.get('/reunion-preparation',
    validateDateOptional('date'),
    checkValidation,
    async (req, res) => {
    try {
      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const reunionDate = req.query.date || new Date().toISOString().split('T')[0];

      const [result, meetingSections] = await Promise.all([
        pool.query(
          `SELECT id, organization_id, date::text as date, youth_of_honor,
                  endroit, activities, notes, animateur_responsable
           FROM reunion_preparations
           WHERE organization_id = $1 AND date = $2`,
          [organizationId, reunionDate]
        ),
        getMeetingSectionConfig(pool, organizationId, logger)
      ]);

      if (result.rows.length > 0) {
        const preparation = result.rows[0];
        
        // Parse JSON fields - check if already parsed (JSONB columns return objects)
        try {
          // If youth_of_honor is a string, parse it; if already an object/array, use as-is
          if (typeof preparation.youth_of_honor === 'string') {
            preparation.youth_of_honor = JSON.parse(preparation.youth_of_honor || '[]');
          } else if (!Array.isArray(preparation.youth_of_honor)) {
            preparation.youth_of_honor = preparation.youth_of_honor ? [preparation.youth_of_honor] : [];
          }
          
          // If activities is a string, parse it; if already an object/array, use as-is
          if (typeof preparation.activities === 'string') {
            preparation.activities = JSON.parse(preparation.activities || '[]');
          } else if (!Array.isArray(preparation.activities)) {
            preparation.activities = [];
          }
        } catch (e) {
          logger.warn('Error parsing reunion preparation JSON fields:', e);
          preparation.youth_of_honor = preparation.youth_of_honor
            ? [preparation.youth_of_honor].flat()
            : [];
          preparation.activities = [];
        }
        res.json({
          success: true,
          preparation: preparation,
          meetingSections
        });
      } else {
        res.json({
          success: false,
          message: 'No reunion preparation found for this date',
          meetingSections
        });
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching reunion preparation:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching reunion preparation'
      });
    }
  });

  /**
   * @swagger
   * /api/save-reunion-preparation:
   *   post:
   *     summary: Save reunion preparation
   *     description: Create or update meeting preparation details
   *     tags: [Meetings]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - date
   *             properties:
   *               date:
   *                 type: string
   *                 format: date
   *               youth_of_honor:
   *                 type: array
   *               endroit:
   *                 type: string
   *               activities:
   *                 type: array
   *               notes:
   *                 type: string
   *               animateur_responsable:
   *                 type: string
   *     responses:
   *       200:
   *         description: Reunion preparation saved successfully
   *       401:
   *         description: Unauthorized
   */
  router.post('/save-reunion-preparation',
    validateDate('date'),
    check('endroit').optional().trim().isLength({ max: 500 }).withMessage('endroit must not exceed 500 characters'),
    check('notes').optional().trim().isLength({ max: 5000 }).withMessage('notes must not exceed 5000 characters'),
    check('animateur_responsable').optional().trim().isLength({ max: 200 }).withMessage('animateur_responsable must not exceed 200 characters'),
    check('duration_override').optional().isInt({ min: 15 }).withMessage('duration_override must be at least 15 minutes'),
    check('youth_of_honor').optional({ nullable: true }).custom(value =>
      Array.isArray(value) || typeof value === 'string'
    ).withMessage('youth_of_honor must be an array or string'),
    checkValidation,
    async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const { date, youth_of_honor, endroit, activities, notes, animateur_responsable, duration_override } = req.body;
      const meetingSections = await getMeetingSectionConfig(pool, organizationId, logger);
      let sectionKey = meetingSections.defaultSection;
      try {
        const orgInfoResult = await pool.query(
          `SELECT setting_value FROM organization_settings
           WHERE organization_id = $1 AND setting_key = 'organization_info'`,
          [organizationId]
        );
        if (orgInfoResult.rows[0]?.setting_value) {
          const orgInfo = JSON.parse(orgInfoResult.rows[0].setting_value);
          if (orgInfo?.meeting_section && meetingSections.sections?.[orgInfo.meeting_section]) {
            sectionKey = orgInfo.meeting_section;
          }
        }
      } catch (error) {
        logger.warn('Unable to resolve meeting section from organization_info', { error: error.message });
      }
      const honorConfig = meetingSections.sections?.[sectionKey]?.honorField || {};
      const parsedHonorValues = Array.isArray(youth_of_honor)
        ? youth_of_honor
        : typeof youth_of_honor === 'string' && youth_of_honor.trim()
          ? [youth_of_honor.trim()]
          : [];

      if (honorConfig.required && parsedHonorValues.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'meeting_section_honor_required'
        });
      }

      // Convert arrays/objects to appropriate formats
      const honorJson = JSON.stringify(parsedHonorValues);

      const activitiesJson = typeof activities === 'string'
        ? activities
        : JSON.stringify(activities);

      // Use UPSERT to handle both insert and update atomically
      // This prevents race conditions and duplicate key errors
      const result = await pool.query(
        `INSERT INTO reunion_preparations
         (organization_id, date, youth_of_honor, endroit, activities, notes, animateur_responsable, duration_override)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (organization_id, date)
         DO UPDATE SET
           youth_of_honor = EXCLUDED.youth_of_honor,
           endroit = EXCLUDED.endroit,
           activities = EXCLUDED.activities,
           notes = EXCLUDED.notes,
           animateur_responsable = EXCLUDED.animateur_responsable,
           duration_override = EXCLUDED.duration_override,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [organizationId, date, honorJson, endroit, activitiesJson, notes, animateur_responsable, duration_override || null]
      );
      const savedPreparation = result.rows[0];
      try {
        savedPreparation.youth_of_honor = JSON.parse(savedPreparation.youth_of_honor || '[]');
        savedPreparation.activities = JSON.parse(savedPreparation.activities || '[]');
      } catch (error) {
        logger.warn('Error parsing saved reunion preparation JSON fields:', error);
      }

      res.json({
        success: true,
        message: 'Reunion preparation saved successfully',
        preparation: savedPreparation
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error saving reunion preparation:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

  /**
   * @swagger
   * /api/reunion-dates:
   *   get:
   *     summary: Get all reunion dates
   *     description: Retrieve list of all dates with reunion preparations
   *     tags: [Meetings]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Reunion dates retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/reunion-dates', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT DISTINCT date::text as date FROM reunion_preparations WHERE organization_id = $1 ORDER BY date DESC`,
        [organizationId]
      );

      res.json({
        success: true,
        dates: result.rows.map(row => row.date)
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching reunion dates:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/next-meeting-info:
   *   get:
   *     summary: Get next meeting information
   *     description: Retrieve details of the next upcoming meeting
   *     tags: [Meetings]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Next meeting info retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/next-meeting-info', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const today = new Date().toISOString().split('T')[0];

      const result = await pool.query(
        `SELECT date::text as date, animateur_responsable, youth_of_honor, endroit, activities, notes
         FROM reunion_preparations
         WHERE organization_id = $1 AND date >= $2
         ORDER BY date ASC
         LIMIT 1`,
        [organizationId, today]
      );

      if (result.rows.length > 0) {
        const meeting = result.rows[0];
        try {
          meeting.youth_of_honor = JSON.parse(meeting.youth_of_honor || '[]');
          meeting.activities = JSON.parse(meeting.activities || '[]');
        } catch (e) {
          logger.warn('Error parsing next meeting JSON fields:', e);
          meeting.youth_of_honor = meeting.youth_of_honor ? [meeting.youth_of_honor].flat() : [];
          meeting.activities = [];
        }
        res.json({ success: true, meeting });
      } else {
        res.json({ success: true, meeting: null, message: 'No upcoming meetings found' });
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching next meeting info:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/guests-by-date:
   *   get:
   *     summary: Get guests for a specific date
   *     description: Retrieve list of guests attending on a specific date
   *     tags: [Meetings]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: date
   *         schema:
   *           type: string
   *           format: date
   *         description: Date to fetch guests (defaults to today)
   *     responses:
   *       200:
   *         description: Guests retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/guests-by-date', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const date = req.query.date || new Date().toISOString().split('T')[0];

      // Return empty array if guests table doesn't exist yet
      try {
        // Note: guests table doesn't have organization_id column per schema
        const result = await pool.query(
          `SELECT id, name, email, attendance_date::text as attendance_date FROM guests
           WHERE attendance_date = $1
           ORDER BY name`,
          [date]
        );
        return res.json({ success: true, guests: result.rows, message: 'Guests retrieved successfully' });
      } catch (err) {
        // If table or column doesn't exist, return empty array
        if (err.code === '42P01' || err.code === '42703') {
          return res.json({ success: true, guests: [], message: 'Guests retrieved successfully' });
        } else {
          throw err;
        }
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching guests:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/save-guest:
   *   post:
   *     summary: Save a guest
   *     description: Add a guest to a meeting/reunion
   *     tags: [Meetings]
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
   *               - attendance_date
   *             properties:
   *               name:
   *                 type: string
   *               email:
   *                 type: string
   *               attendance_date:
   *                 type: string
   *                 format: date
   *     responses:
   *       200:
   *         description: Guest saved successfully
   *       400:
   *         description: Name and date are required
   *       401:
   *         description: Unauthorized
   */
  router.post('/save-guest', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const { name, email, attendance_date } = req.body;

      if (!name || !attendance_date) {
        return res.status(400).json({ success: false, message: 'Name and date are required' });
      }

      // Try to create guests table if it doesn't exist
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS guests (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            attendance_date DATE NOT NULL,
            organization_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } catch (err) {
        // Ignore errors if table already exists
      }

      const result = await pool.query(
        `INSERT INTO guests (name, email, attendance_date, organization_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [name, email, attendance_date, organizationId]
      );

      res.json({ success: true, guest: { id: result.rows[0].id, name, email, attendance_date } });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error saving guest:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/get_reminder:
   *   get:
   *     summary: Get meeting reminder
   *     description: Retrieve the latest meeting reminder for the organization
   *     tags: [Meetings]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Reminder retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  // Handler function for getting reminder
  const getReminderHandler = async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT * FROM rappel_reunion
         WHERE organization_id = $1
         ORDER BY creation_time DESC LIMIT 1`,
        [organizationId]
      );

      if (result.rows.length > 0) {
        res.json({ success: true, reminder: result.rows[0] });
      } else {
        res.json({ success: true, reminder: null });
      }
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching reminder:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // Register both /get_reminder and /reminder endpoints (for backwards compatibility)
  router.get('/get_reminder', getReminderHandler);
  router.get('/reminder', getReminderHandler);

  /**
   * @swagger
   * /api/save_reminder:
   *   post:
   *     summary: Save meeting reminder
   *     description: Create or update meeting reminder
   *     tags: [Meetings]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reminder_date:
   *                 type: string
   *                 format: date-time
   *               is_recurring:
   *                 type: boolean
   *               reminder_text:
   *                 type: string
   *     responses:
   *       200:
   *         description: Reminder saved successfully
   *       401:
   *         description: Unauthorized
   */
  router.post('/save_reminder', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const { reminder_date, is_recurring, reminder_text } = req.body;

      await pool.query(
        `INSERT INTO rappel_reunion (organization_id, reminder_date, is_recurring, reminder_text)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id) DO UPDATE SET
         reminder_date = EXCLUDED.reminder_date,
         is_recurring = EXCLUDED.is_recurring,
         reminder_text = EXCLUDED.reminder_text`,
        [organizationId, reminder_date, is_recurring, reminder_text]
      );

      res.json({ success: true, message: 'Reminder saved successfully' });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error saving reminder:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/activites-rencontre:
   *   get:
   *     summary: Get all activity types for meetings
   *     description: Retrieve list of all available meeting activities
   *     tags: [Meetings]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Activities retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/activites-rencontre', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const meetingSections = await getMeetingSectionConfig(pool, organizationId, logger);
      const result = await pool.query(
        `SELECT * FROM activites_rencontre ORDER BY activity`
      );

      res.json({ success: true, data: result.rows, meetingSections });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching activites rencontre:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/activity-templates:
   *   get:
   *     summary: Get activity templates for meetings
   *     description: Retrieve organization-specific and default activity templates
   *     tags: [Meetings]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Activity templates retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/activity-templates', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT * FROM activites_rencontre
         WHERE organization_id = $1 OR organization_id = 0
         ORDER BY category, name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching activity templates:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
