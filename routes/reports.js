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
const { verifyJWT, getCurrentOrganizationId, verifyOrganizationMembership, handleOrganizationResolutionError } = require('../utils/api-helpers');

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

      // Ensure the user belongs to the organization with the proper role
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin', 'animation', 'leader']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      // Build email list by user role (admin/animation/etc.)
      const usersEmailsResult = await pool.query(
        `SELECT LOWER(u.email) AS email, uo.role
         FROM user_organizations uo
         JOIN users u ON u.id = uo.user_id
         WHERE uo.organization_id = $1
         AND u.email IS NOT NULL
         AND u.email != ''`,
        [organizationId]
      );

      const emailsByRole = usersEmailsResult.rows.reduce((acc, user) => {
        if (!acc[user.role]) {
          acc[user.role] = [];
        }
        acc[user.role].push(user.email);
        return acc;
      }, {});

      // Guardian emails linked to participants in the current organization
      const guardianEmailsResult = await pool.query(
        `WITH guardian_children AS (
           SELECT DISTINCT LOWER(pg.courriel) AS email,
                  p.first_name || ' ' || p.last_name AS participant_name
           FROM parents_guardians pg
           JOIN participant_guardians pg_rel ON pg_rel.guardian_id = pg.id
           JOIN participant_organizations po ON po.participant_id = pg_rel.participant_id
           JOIN participants p ON p.id = pg_rel.participant_id
           WHERE po.organization_id = $1
             AND pg.courriel IS NOT NULL
             AND pg.courriel <> ''
         )
         SELECT email,
                string_agg(participant_name, ', ' ORDER BY participant_name) AS participants
         FROM guardian_children
         GROUP BY email`,
        [organizationId]
      );

      emailsByRole.parent = guardianEmailsResult.rows.map((parent) => ({
        email: parent.email,
        participants: parent.participants,
      }));

      // Participant emails captured on their own forms
      const participantEmailsResult = await pool.query(
        `SELECT LOWER(fs.submission_data->>'courriel') AS courriel
         FROM form_submissions fs
         WHERE (fs.submission_data->>'courriel') IS NOT NULL
         AND (fs.submission_data->>'courriel') != ''
         AND fs.organization_id = $1`,
        [organizationId]
      );

      const participantEmails = participantEmailsResult.rows.map(row => row.courriel);
      const uniqueEmails = [
        ...new Set([
          ...Object.values(emailsByRole).flat().map(item => (typeof item === 'string' ? item : item.email)),
          ...participantEmails,
        ]),
      ];

      res.json({
        success: true,
        emails_by_role: emailsByRole,
        participant_emails: participantEmails,
        unique_emails: uniqueEmails,
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin', 'animation', 'leader']);
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

      // Process health data to extract key fields (using actual fiche_sante field names)
      const healthReport = result.rows.map(row => {
        const healthData = row.health_data || {};
        return {
          id: row.id,
          first_name: row.first_name,
          last_name: row.last_name,
          date_naissance: row.date_naissance,
          group_name: row.group_name,
          // Using actual field names from fiche_sante form
          has_allergies: healthData.has_allergies || null,
          allergies: healthData.allergie || null,
          epipen: healthData.epipen || false,
          has_medication: healthData.has_medication || null,
          medications: healthData.medicament || null,
          has_probleme_sante: healthData.has_probleme_sante || null,
          probleme_sante: healthData.probleme_sante || null,
          medecin_famille: healthData.medecin_famille || null,
          nom_medecin: healthData.nom_medecin || null,
          niveau_natation: healthData.niveau_natation || null,
          doit_porter_vfi: healthData.doit_porter_vfi || false,
          vaccins_a_jour: healthData.vaccins_a_jour || false,
          has_health_form: !!row.health_data
        };
      });

      res.json({ success: true, data: healthReport });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin', 'animation', 'leader']);
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin', 'animation', 'leader']);
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                fs.submission_data->>'has_allergies' as has_allergies,
                fs.submission_data->>'allergie' as allergies,
                fs.submission_data->>'epipen' as epipen
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante' AND fs.organization_id = $1
         WHERE po.organization_id = $1
           AND fs.submission_data->>'has_allergies' = 'yes'
         ORDER BY g.name, p.last_name, p.first_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                fs.submission_data->>'has_medication' as has_medication,
                fs.submission_data->>'medicament' as medication
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante' AND fs.organization_id = $1
         WHERE po.organization_id = $1
           AND fs.submission_data->>'has_medication' = 'yes'
         ORDER BY g.name, p.last_name, p.first_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                fs.submission_data->>'vaccins_a_jour' as vaccines_up_to_date
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante' AND fs.organization_id = $1
         WHERE po.organization_id = $1
         ORDER BY g.name, p.last_name, p.first_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                fs.submission_data->>'peut_partir_seul' as can_leave_alone
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'participant_registration' AND fs.organization_id = $1
         WHERE po.organization_id = $1
         ORDER BY g.name, p.last_name, p.first_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                fs.submission_data->>'consentement_photos_videos' as media_authorized
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'participant_registration' AND fs.organization_id = $1
         WHERE po.organization_id = $1
         ORDER BY g.name, p.last_name, p.first_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
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

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching points report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * GET /api/time-since-registration-report
   * Get time since registration report for all participants
   */
  router.get('/time-since-registration-report', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                po.inscription_date,
                CASE
                  WHEN po.inscription_date IS NOT NULL THEN
                    EXTRACT(YEAR FROM AGE(CURRENT_DATE, po.inscription_date))
                  ELSE NULL
                END as years_with_group,
                CASE
                  WHEN po.inscription_date IS NOT NULL THEN
                    EXTRACT(MONTH FROM AGE(CURRENT_DATE, po.inscription_date)) -
                    (EXTRACT(YEAR FROM AGE(CURRENT_DATE, po.inscription_date)) * 12)
                  ELSE NULL
                END as months_with_group
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1
         ORDER BY
           CASE WHEN po.inscription_date IS NOT NULL THEN 0 ELSE 1 END,
           po.inscription_date ASC NULLS LAST,
           p.first_name, p.last_name`,
        [organizationId]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching time since registration report:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/participant-progress:
   *   get:
   *     summary: Get participant progression timeline
   *     description: Retrieve attendance, honors, badge stars, and points timeline for a participant
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: participant_id
   *         schema:
   *           type: integer
   *         description: Participant ID to fetch detailed progress for
   *     responses:
   *       200:
   *         description: Participant progress retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/participant-progress', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      const participantsResult = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, g.name as group_name
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );

      const participantId = req.query.participant_id ? Number(req.query.participant_id) : null;
      if (!participantId) {
        return res.json({ success: true, data: { participants: participantsResult.rows } });
      }

      const participantSummary = participantsResult.rows.find((p) => p.id === participantId);
      if (!participantSummary) {
        return res.status(404).json({ success: false, message: 'Participant not found in organization' });
      }

      const attendanceResult = await pool.query(
        `SELECT date::text as date, status
         FROM attendance
         WHERE participant_id = $1 AND organization_id = $2
         ORDER BY date ASC`,
        [participantId, organizationId]
      );

      const honorsResult = await pool.query(
        `SELECT date::text as date, reason
         FROM honors
         WHERE participant_id = $1 AND organization_id = $2
         ORDER BY date ASC`,
        [participantId, organizationId]
      );

      const badgeResult = await pool.query(
        `SELECT territoire_chasse, etoiles, date_obtention::text as date
         FROM badge_progress
         WHERE participant_id = $1 AND organization_id = $2 AND status = 'approved'
         ORDER BY date_obtention ASC`,
        [participantId, organizationId]
      );

      const pointsResult = await pool.query(
        `SELECT created_at::date as date, value
         FROM points
         WHERE participant_id = $1 AND organization_id = $2
         ORDER BY created_at ASC`,
        [participantId, organizationId]
      );

      let cumulative = 0;
      const pointEvents = pointsResult.rows.map((row) => {
        const value = Number(row.value) || 0;
        cumulative += value;
        return { date: row.date, value, cumulative };
      });

      const attendanceCounts = attendanceResult.rows.reduce(
        (acc, row) => {
          acc[row.status] = (acc[row.status] || 0) + 1;
          return acc;
        },
        {}
      );

      res.json({
        success: true,
        data: {
          participants: participantsResult.rows,
          progress: {
            participant: participantSummary,
            attendance: attendanceResult.rows,
            honors: honorsResult.rows,
            badges: badgeResult.rows,
            pointEvents,
            totals: {
              points: cumulative,
              honors: honorsResult.rowCount,
              badges: badgeResult.rowCount,
              attendance: attendanceCounts
            }
          }
        }
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching participant progress:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * @swagger
   * /api/parent-contact-list:
   *   get:
   *     summary: Get parent contact list
   *     description: Retrieve parent/guardian contact information for all participants
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Parent contact list retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/parent-contact-list', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      // Get all participants with their guardians
      const result = await pool.query(
        `SELECT
          p.id as participant_id,
          p.first_name,
          p.last_name,
          g.name as group_name,
          pg_table.id as guardian_id,
          pg_table.nom,
          pg_table.prenom,
          pg_table.courriel,
          pg_table.telephone_residence,
          pg_table.telephone_travail,
          pg_table.telephone_cellulaire,
          pg_table.is_emergency_contact,
          pg_table.is_primary,
          part_guard.lien
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN participant_guardians part_guard ON p.id = part_guard.participant_id
         LEFT JOIN parents_guardians pg_table ON part_guard.guardian_id = pg_table.id
         WHERE po.organization_id = $1
         ORDER BY p.last_name, p.first_name, pg_table.is_primary DESC, pg_table.is_emergency_contact DESC`,
        [organizationId]
      );

      res.json({
        success: true,
        contacts: result.rows
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching parent contact list:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
