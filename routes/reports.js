/**
 * Reports Routes
 *
 * Handles various report generation including health, attendance, documents, etc.
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/reports
 */

const express = require('express');
const router = express.Router();

// Import utilities
const { verifyJWT, getCurrentOrganizationId, verifyOrganizationMembership } = require('../utils/api-helpers');

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with report routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/mailing-list:
   *   get:
   *     summary: Get mailing list
   *     description: Retrieve email contacts for all guardians
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Mailing list retrieved successfully
   *       401:
   *         description: Unauthorized
   */
  router.get('/mailing-list', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const result = await pool.query(
        `SELECT DISTINCT pg.courriel as email, pg.nom, pg.prenom, p.first_name as participant_first_name, p.last_name as participant_last_name
         FROM parents_guardians pg
         JOIN participants p ON pg.participant_id = p.id
         JOIN participant_organizations po ON p.id = po.participant_id
         WHERE po.organization_id = $1 AND pg.courriel IS NOT NULL AND pg.courriel != ''
         ORDER BY pg.nom, pg.prenom`,
        [organizationId]
      );

      res.json({
        success: true,
        contacts: result.rows
      });
    } catch (error) {
      logger.error('Error fetching mailing list:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/health-report:
   *   get:
   *     summary: Get health report
   *     description: Retrieve health information for all participants
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: group_id
   *         schema:
   *           type: integer
   *         description: Filter by group ID
   *     responses:
   *       200:
   *         description: Health report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/health-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization with admin or animation role
      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool, ['admin', 'animation', 'leader']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const groupId = req.query.group_id;

      // Get all participants with their health form submissions
      let query = `
        SELECT p.id, p.first_name, p.last_name, p.date_naissance,
               g.name as group_name,
               fs.submission_data as health_data
        FROM participants p
        JOIN participant_organizations po ON p.id = po.participant_id
        LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
        LEFT JOIN groups g ON pg.group_id = g.id
        LEFT JOIN form_submissions fs ON p.id = fs.participant_id
          AND fs.organization_id = $1
          AND fs.form_type = 'fiche_sante'
        WHERE po.organization_id = $1
      `;

      const params = [organizationId];

      if (groupId) {
        query += ` AND pg.group_id = $2`;
        params.push(groupId);
      }

      query += ` ORDER BY g.name, p.last_name, p.first_name`;

      const result = await pool.query(query, params);

      // Process health data to extract key fields
      const healthReport = result.rows.map(row => {
        const healthData = row.health_data || {};
        return {
          id: row.id,
          first_name: row.first_name,
          last_name: row.last_name,
          date_naissance: row.date_naissance,
          group_name: row.group_name,
          allergies: healthData.allergies || healthData.allergie || null,
          allergies_details: healthData.allergies_details || healthData.allergie_details || null,
          medications: healthData.medicaments || healthData.medications || null,
          epipen: healthData.epipen || healthData.auto_injecteur || false,
          medecin_famille: healthData.medecin_famille || null,
          nom_medecin: healthData.nom_medecin || null,
          telephone_medecin: healthData.telephone_medecin || null,
          carte_assurance_maladie: healthData.carte_assurance_maladie || null,
          has_health_form: !!row.health_data
        };
      });

      res.json({ success: true, data: healthReport });
    } catch (error) {
      logger.error('Error fetching health report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/attendance-report:
   *   get:
   *     summary: Get attendance report
   *     description: Retrieve attendance report with optional date range and group filter
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: start_date
   *         schema:
   *           type: string
   *           format: date
   *       - in: query
   *         name: end_date
   *         schema:
   *           type: string
   *           format: date
   *       - in: query
   *         name: group_id
   *         schema:
   *           type: integer
   *       - in: query
   *         name: format
   *         schema:
   *           type: string
   *           enum: [json, csv]
   *     responses:
   *       200:
   *         description: Attendance report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/attendance-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization with admin or animation role
      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool, ['admin', 'animation', 'leader']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      const { start_date, end_date, group_id, format } = req.query;

      let query = `
        SELECT p.id, p.first_name, p.last_name,
               g.name as group_name,
               a.date, a.status
        FROM participants p
        JOIN participant_organizations po ON p.id = po.participant_id
        LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
        LEFT JOIN groups g ON pg.group_id = g.id
        LEFT JOIN attendance a ON p.id = a.participant_id AND a.organization_id = $1
        WHERE po.organization_id = $1
      `;

      const params = [organizationId];
      let paramIndex = 2;

      if (start_date) {
        query += ` AND a.date >= $${paramIndex}`;
        params.push(start_date);
        paramIndex++;
      }

      if (end_date) {
        query += ` AND a.date <= $${paramIndex}`;
        params.push(end_date);
        paramIndex++;
      }

      if (group_id) {
        query += ` AND pg.group_id = $${paramIndex}`;
        params.push(group_id);
        paramIndex++;
      }

      query += ` ORDER BY p.last_name, p.first_name, a.date`;

      const result = await pool.query(query, params);

      // Group by participant
      const participantMap = new Map();
      for (const row of result.rows) {
        const key = row.id;
        if (!participantMap.has(key)) {
          participantMap.set(key, {
            id: row.id,
            first_name: row.first_name,
            last_name: row.last_name,
            group_name: row.group_name,
            attendance: [],
            summary: { present: 0, absent: 0, late: 0, excused: 0 }
          });
        }
        if (row.date) {
          const participant = participantMap.get(key);
          participant.attendance.push({ date: row.date, status: row.status });
          if (participant.summary[row.status] !== undefined) {
            participant.summary[row.status]++;
          }
        }
      }

      const attendanceReport = Array.from(participantMap.values());

      // If CSV format requested
      if (format === 'csv') {
        let csv = 'First Name,Last Name,Group,Present,Absent,Late,Excused\n';
        for (const p of attendanceReport) {
          csv += `"${p.first_name}","${p.last_name}","${p.group_name || ''}",${p.summary.present},${p.summary.absent},${p.summary.late},${p.summary.excused}\n`;
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="attendance_report.csv"');
        return res.send(csv);
      }

      res.json({ success: true, data: attendanceReport });
    } catch (error) {
      logger.error('Error fetching attendance report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/missing-documents-report:
   *   get:
   *     summary: Get missing documents report
   *     description: Retrieve list of participants with missing required documents
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Missing documents report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/missing-documents-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization with admin or animation role
      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool, ['admin', 'animation', 'leader']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      // Get required form types from organization settings
      const settingsResult = await pool.query(
        `SELECT setting_value FROM organization_settings
         WHERE organization_id = $1 AND setting_key = 'required_forms'`,
        [organizationId]
      );

      // Default required forms if not configured
      let requiredForms = ['fiche_sante', 'acceptation_risque', 'formulaire_inscription'];
      if (settingsResult.rows.length > 0) {
        try {
          requiredForms = JSON.parse(settingsResult.rows[0].setting_value);
        } catch (e) {
          // Keep defaults
        }
      }

      // Get all participants and their submitted forms
      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name,
                g.name as group_name,
                ARRAY_AGG(DISTINCT fs.form_type) FILTER (WHERE fs.form_type IS NOT NULL) as submitted_forms
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
         WHERE po.organization_id = $1
         GROUP BY p.id, p.first_name, p.last_name, g.name
         ORDER BY g.name, p.last_name, p.first_name`,
        [organizationId]
      );

      // Calculate missing forms for each participant
      const missingDocsReport = result.rows.map(row => {
        const submittedForms = row.submitted_forms || [];
        const missingForms = requiredForms.filter(form => !submittedForms.includes(form));

        return {
          id: row.id,
          first_name: row.first_name,
          last_name: row.last_name,
          group_name: row.group_name,
          submitted_forms: submittedForms,
          missing_forms: missingForms,
          is_complete: missingForms.length === 0
        };
      });

      res.json({
        success: true,
        data: missingDocsReport,
        required_forms: requiredForms
      });
    } catch (error) {
      logger.error('Error fetching missing documents report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/health-contact-report:
   *   get:
   *     summary: Get health contact report
   *     description: Retrieve emergency contacts and doctor information
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Health contact report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/health-contact-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                fs.submission_data->>'emergency_contact_name' as emergency_contact_name,
                fs.submission_data->>'emergency_contact_phone' as emergency_contact_phone,
                fs.submission_data->>'doctor_name' as doctor_name,
                fs.submission_data->>'doctor_phone' as doctor_phone
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
         WHERE po.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching health contact report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/allergies-report:
   *   get:
   *     summary: Get allergies report
   *     description: Retrieve list of participants with allergies
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Allergies report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/allergies-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name,
                fs.submission_data->>'allergies' as allergies,
                fs.submission_data->>'allergies_details' as allergies_details
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
         WHERE po.organization_id = $1
           AND (fs.submission_data->>'allergies' = 'true' OR fs.submission_data->>'allergies_details' IS NOT NULL)
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching allergies report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/medication-report:
   *   get:
   *     summary: Get medication report
   *     description: Retrieve list of participants with medications
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Medication report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/medication-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name,
                fs.submission_data->>'medication' as medication,
                fs.submission_data->>'medication_details' as medication_details
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
         WHERE po.organization_id = $1
           AND (fs.submission_data->>'medication' = 'true' OR fs.submission_data->>'medication_details' IS NOT NULL)
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching medication report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/vaccine-report:
   *   get:
   *     summary: Get vaccine report
   *     description: Retrieve vaccination information for participants
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Vaccine report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/vaccine-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name,
                fs.submission_data->>'vaccinations' as vaccinations,
                fs.submission_data->>'vaccination_date' as vaccination_date
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
         WHERE po.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching vaccine report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/leave-alone-report:
   *   get:
   *     summary: Get permission to leave alone report
   *     description: Retrieve information about participants allowed to leave alone
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Leave alone report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/leave-alone-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name,
                fs.submission_data->>'can_leave_alone' as can_leave_alone
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'guardian_form'
         WHERE po.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching leave alone report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/media-authorization-report:
   *   get:
   *     summary: Get media authorization report
   *     description: Retrieve media authorization status for participants
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Media authorization report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/media-authorization-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name,
                fs.submission_data->>'media_authorization' as media_authorization
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'guardian_form'
         WHERE po.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching media authorization report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/honors-report:
   *   get:
   *     summary: Get honors report
   *     description: Retrieve summary of honors awarded
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Honors report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/honors-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT h.honor_name, h.category, COUNT(*) as count,
                array_agg(p.first_name || ' ' || p.last_name) as recipients
         FROM honors h
         JOIN participants p ON h.participant_id = p.id
         JOIN participant_organizations po ON p.id = po.participant_id
         WHERE po.organization_id = $1
         GROUP BY h.honor_name, h.category
         ORDER BY h.category, h.honor_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching honors report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/points-report:
   *   get:
   *     summary: Get points report
   *     description: Retrieve points summary for all participants
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Points report retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/points-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                COALESCE(SUM(pts.value), 0) as total_points,
                COUNT(DISTINCT h.id) as honors_count
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN points pts ON p.id = pts.participant_id AND pts.organization_id = $1
         LEFT JOIN honors h ON p.id = h.participant_id
         WHERE po.organization_id = $1
         GROUP BY p.id, p.first_name, p.last_name, g.name
         ORDER BY total_points DESC, p.first_name, p.last_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error fetching points report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
