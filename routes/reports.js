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

// Import auth middleware
const { authenticate, requirePermission, getOrganizationId, withScoutYear } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/response');

// Import utilities
const { verifyJWT, getCurrentOrganizationId, verifyOrganizationMembership, handleOrganizationResolutionError } = require('../utils/api-helpers');

/*
 * Reading a form submission "as of" a scout year.
 *
 * These reports scope the roster and the den to the selected year, but a form
 * submission is not a per-year row: the year transition deliberately keeps last
 * year's content and only asks for a re-read (§10), so a returning child has one
 * health form stamped with the year it was first filled in. Two consequences,
 * both of which these fragments exist to handle:
 *
 *   * joining on `fs.scout_year_id = <selected year>` would empty the report for
 *     every returning participant, since their form belongs to an earlier year;
 *   * joining without any year condition lets a closed year's report display a
 *     form filled in two seasons later, and lets a participant with submissions
 *     from several years appear once per submission.
 *
 * What a historical report should show is the submission that was in force
 * during the selected year: the most recent one that existed by then. Hence a
 * lateral picking a single row, ordered by the year it belongs to.
 *
 * The residual limit is stated plainly: a submission edited in a later season is
 * a mutable row, so its *content* is today's. Scoping fixes which record is
 * shown, not the absence of version history — see §9 of
 * devdocs/GESTION_ANNEE_SCOUTE.md.
 *
 * Both fragments expect `$1` = organization id and `$4` = the selected year's
 * start date, and attach to a query whose participant table is aliased `p`.
 */
const HEALTH_FORM_AS_OF_YEAR = `
  LEFT JOIN LATERAL (
    SELECT sub.submission_data
      FROM form_submissions sub
      LEFT JOIN scout_years sub_year ON sub_year.id = sub.scout_year_id
     WHERE sub.participant_id = p.id
       AND sub.organization_id = $1
       AND sub.form_type = 'fiche_sante'
       AND (sub_year.start_date IS NULL OR sub_year.start_date <= $4::date)
     ORDER BY sub_year.start_date DESC NULLS LAST, sub.updated_at DESC NULLS LAST, sub.id DESC
     LIMIT 1
  ) fs ON TRUE`;

const REGISTRATION_FORM_AS_OF_YEAR = `
  LEFT JOIN LATERAL (
    SELECT sub.submission_data
      FROM form_submissions sub
      LEFT JOIN scout_years sub_year ON sub_year.id = sub.scout_year_id
     WHERE sub.participant_id = p.id
       AND sub.organization_id = $1
       AND sub.form_type = 'participant_registration'
       AND (sub_year.start_date IS NULL OR sub_year.start_date <= $4::date)
     ORDER BY sub_year.start_date DESC NULLS LAST, sub.updated_at DESC NULLS LAST, sub.id DESC
     LIMIT 1
  ) fs ON TRUE`;

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
   * GET /api/v1/reports/mailing-list
   * Get mailing list
   */
  router.get('/mailing-list', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    // Build email list by user role (admin/animation/etc.)
    const usersEmailsResult = await pool.query(
      `SELECT LOWER(u.email) AS email, r.role_name as role
         FROM user_organizations uo
         JOIN users u ON u.id = uo.user_id
         CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
         LEFT JOIN roles r ON r.id = role_id_text::integer
         WHERE uo.organization_id = $1
         AND u.email IS NOT NULL
         AND u.email != ''`,
      [organizationId]
    );

    const emailsByRole = usersEmailsResult.rows.reduce((acc, user) => {
      if (!acc[user.role]) {
        acc[user.role] = [];
      }
      if (!acc[user.role].includes(user.email)) {
        acc[user.role].push(user.email);
      }
      return acc;
    }, {});

    // Guardian emails linked to participants in the current organization
    const guardianEmailsResult = await pool.query(
      `WITH guardian_children AS (
           SELECT DISTINCT LOWER(pg.courriel) AS email,
                  p.first_name || ' ' || p.last_name AS participant_name
           FROM parents_guardians pg
           JOIN participant_guardians pg_rel ON pg_rel.guardian_id = pg.id
           JOIN participant_enrollments po ON po.participant_id = pg_rel.participant_id
             AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
           JOIN participants p ON p.id = pg_rel.participant_id
           WHERE po.organization_id = $1
             AND pg.courriel IS NOT NULL
             AND pg.courriel <> ''
         )
         SELECT email,
                string_agg(participant_name, ', ' ORDER BY participant_name) AS participants
         FROM guardian_children
         GROUP BY email`,
      [organizationId, req.scoutYear.id, req.rosterStatuses]
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
  }));

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
  /**
   * GET /api/v1/reports/health
   * Get health report
   */
  router.get('/health', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const groupId = req.query.group_id;

    // Get all participants with their health form submissions
    let query = `
        SELECT p.id, p.first_name, p.last_name, p.date_naissance,
               g.name as group_name,
               fs.submission_data as health_data
        FROM participants p
        JOIN participant_enrollments po ON p.id = po.participant_id
          AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
        LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
        LEFT JOIN groups g ON pg.group_id = g.id
        ${HEALTH_FORM_AS_OF_YEAR}
        WHERE po.organization_id = $1
      `;

    const params = [organizationId, req.scoutYear.id, req.rosterStatuses, req.scoutYear.start_date];

    if (groupId) {
      query += ` AND pg.group_id = $5`;
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
  }));

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
  /**
   * GET /api/v1/reports/attendance
   * Get attendance report
   */
  router.get('/attendance', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const { start_date, end_date, group_id, format } = req.query;

    let query = `
        SELECT p.id, p.first_name, p.last_name,
               g.name as group_name,
               a.date, a.status
        FROM participants p
        JOIN participant_enrollments po ON p.id = po.participant_id
          AND po.scout_year_id = $2 AND po.status = ANY($5::text[])
        LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
        LEFT JOIN groups g ON pg.group_id = g.id
        LEFT JOIN attendance a ON p.id = a.participant_id AND a.organization_id = $1
          AND a.date BETWEEN $3::date AND $4::date
        WHERE po.organization_id = $1
      `;

    const params = [
      organizationId, req.scoutYear.id,
      req.scoutYear.start_date, req.scoutYear.end_date, req.rosterStatuses
    ];
    let paramIndex = 6;

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
  }));

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
  /**
   * GET /api/v1/reports/missing-documents
   * Get missing documents report
   */
  router.get('/missing-documents', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

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
        // setting_value is a jsonb column, already parsed by the pg driver.
        const raw = settingsResult.rows[0].setting_value;
        requiredForms = typeof raw === 'string' ? JSON.parse(raw) : raw;
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
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
         LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN (
           SELECT sub.participant_id, sub.organization_id, sub.form_type, sub_year.start_date
             FROM form_submissions sub
             LEFT JOIN scout_years sub_year ON sub_year.id = sub.scout_year_id
         ) fs ON fs.participant_id = p.id
              AND fs.organization_id = $1
              AND (fs.start_date IS NULL OR fs.start_date <= $4::date)
         WHERE po.organization_id = $1
         GROUP BY p.id, p.first_name, p.last_name, g.name
         ORDER BY g.name, p.last_name, p.first_name`,
      [organizationId, req.scoutYear.id, req.rosterStatuses, req.scoutYear.start_date]
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
  }));

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
  /**
   * GET /api/v1/reports/health-contacts
   * Get health contact report
   */
  router.get('/health-contacts', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                fs.submission_data->>'emergency_contact_name' as emergency_contact_name,
                fs.submission_data->>'emergency_contact_phone' as emergency_contact_phone,
                fs.submission_data->>'doctor_name' as doctor_name,
                fs.submission_data->>'doctor_phone' as doctor_phone
         FROM participants p
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
         ${HEALTH_FORM_AS_OF_YEAR}
         WHERE po.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
      [organizationId, req.scoutYear.id, req.rosterStatuses, req.scoutYear.start_date]
    );

    res.json({ success: true, data: result.rows });
  }));

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
  router.get('/allergies', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                fs.submission_data->>'has_allergies' as has_allergies,
                fs.submission_data->>'allergie' as allergies,
                fs.submission_data->>'epipen' as epipen
         FROM participants p
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
         LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
         LEFT JOIN groups g ON pg.group_id = g.id
         ${HEALTH_FORM_AS_OF_YEAR}
         WHERE po.organization_id = $1
           AND fs.submission_data->>'has_allergies' = 'yes'
         ORDER BY g.name, p.last_name, p.first_name`,
      [organizationId, req.scoutYear.id, req.rosterStatuses, req.scoutYear.start_date]
    );

    res.json({ success: true, data: result.rows });
  }));

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
  router.get('/medication', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                fs.submission_data->>'has_medication' as has_medication,
                fs.submission_data->>'medicament' as medication
         FROM participants p
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
         LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
         LEFT JOIN groups g ON pg.group_id = g.id
         ${HEALTH_FORM_AS_OF_YEAR}
         WHERE po.organization_id = $1
           AND fs.submission_data->>'has_medication' = 'yes'
         ORDER BY g.name, p.last_name, p.first_name`,
      [organizationId, req.scoutYear.id, req.rosterStatuses, req.scoutYear.start_date]
    );

    res.json({ success: true, data: result.rows });
  }));

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
  router.get('/vaccines', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                fs.submission_data->>'vaccins_a_jour' as vaccines_up_to_date
         FROM participants p
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
         LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
         LEFT JOIN groups g ON pg.group_id = g.id
         ${HEALTH_FORM_AS_OF_YEAR}
         WHERE po.organization_id = $1
         ORDER BY g.name, p.last_name, p.first_name`,
      [organizationId, req.scoutYear.id, req.rosterStatuses, req.scoutYear.start_date]
    );

    res.json({ success: true, data: result.rows });
  }));

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
  router.get('/leave-alone', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                fs.submission_data->>'peut_partir_seul' as can_leave_alone
         FROM participants p
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
         LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
         LEFT JOIN groups g ON pg.group_id = g.id
         ${REGISTRATION_FORM_AS_OF_YEAR}
         WHERE po.organization_id = $1
         ORDER BY g.name, p.last_name, p.first_name`,
      [organizationId, req.scoutYear.id, req.rosterStatuses, req.scoutYear.start_date]
    );

    res.json({ success: true, data: result.rows });
  }));

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
  router.get('/media-authorization', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                fs.submission_data->>'consentement_photos_videos' as media_authorized
         FROM participants p
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
         LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
         LEFT JOIN groups g ON pg.group_id = g.id
         ${REGISTRATION_FORM_AS_OF_YEAR}
         WHERE po.organization_id = $1
         ORDER BY g.name, p.last_name, p.first_name`,
      [organizationId, req.scoutYear.id, req.rosterStatuses, req.scoutYear.start_date]
    );

    res.json({ success: true, data: result.rows });
  }));

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
  router.get('/honors', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT h.honor_name, h.category, COUNT(*) as count,
                array_agg(p.first_name || ' ' || p.last_name) as recipients
         FROM honors h
         JOIN participants p ON h.participant_id = p.id
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($5::text[])
         WHERE po.organization_id = $1
           AND h.date BETWEEN $3::date AND $4::date
         GROUP BY h.honor_name, h.category
         ORDER BY h.category, h.honor_name`,
      [organizationId, req.scoutYear.id, req.scoutYear.start_date, req.scoutYear.end_date, req.rosterStatuses]
    );

    res.json({ success: true, data: result.rows });
  }));

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
  router.get('/points', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
                COALESCE(point_totals.total_points, 0) as total_points,
                COALESCE(honor_counts.honors_count, 0) as honors_count
         FROM participants p
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($5::text[])
         LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN (
           SELECT participant_id, SUM(value) AS total_points
           FROM points
           WHERE organization_id = $1 AND participant_id IS NOT NULL AND scout_year_id = $2
           GROUP BY participant_id
         ) point_totals ON point_totals.participant_id = p.id
         LEFT JOIN (
           SELECT participant_id, COUNT(DISTINCT id) AS honors_count
           FROM honors
           WHERE organization_id = $1 AND date BETWEEN $3::date AND $4::date
           GROUP BY participant_id
         ) honor_counts ON honor_counts.participant_id = p.id
         WHERE po.organization_id = $1
         GROUP BY p.id, p.first_name, p.last_name, g.name, point_totals.total_points, honor_counts.honors_count
         ORDER BY total_points DESC, p.first_name, p.last_name`,
      [organizationId, req.scoutYear.id, req.scoutYear.start_date, req.scoutYear.end_date, req.rosterStatuses]
    );

    res.json({ success: true, data: result.rows });
  }));

  /**
   * GET /api/time-since-registration-report
   * Get time since registration report for all participants
   */
  router.get('/time-since-registration', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

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
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
         LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1
         ORDER BY
           CASE WHEN po.inscription_date IS NOT NULL THEN 0 ELSE 1 END,
           po.inscription_date ASC NULLS LAST,
           p.first_name, p.last_name`,
      [organizationId, req.scoutYear.id, req.rosterStatuses]
    );

    res.json({ success: true, data: result.rows });
  }));

  /**
   * @swagger
   * /api/v1/reports/participant-progress:
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
  router.get('/participant-progress', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    // Check if user has parent role - parents are restricted even if they have other permissions
    const isParent = req.user.roleNames && (req.user.roleNames.includes('parent') || req.user.roleNames.includes('demoparent'));
    const isStaff = !isParent; // Staff = NOT a parent

    // Parents can only see their own children, staff can see all participants
    let participantsQuery, participantsParams;
    if (isStaff) {
      participantsQuery = `
          SELECT p.id, p.first_name, p.last_name, g.name as group_name
          FROM participants p
          JOIN participant_enrollments po ON p.id = po.participant_id
            AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
          LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
          LEFT JOIN groups g ON pg.group_id = g.id
          WHERE po.organization_id = $1
          ORDER BY p.first_name, p.last_name`;
      participantsParams = [organizationId, req.scoutYear.id, req.rosterStatuses];
    } else {
      participantsQuery = `
          SELECT p.id, p.first_name, p.last_name, g.name as group_name
          FROM participants p
          JOIN participant_enrollments po ON p.id = po.participant_id
            AND po.scout_year_id = $3 AND po.status = ANY($4::text[])
          JOIN user_participants up ON p.id = up.participant_id
          LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $3
          LEFT JOIN groups g ON pg.group_id = g.id
          WHERE po.organization_id = $1 AND up.user_id = $2
          ORDER BY p.first_name, p.last_name`;
      participantsParams = [organizationId, req.user.id, req.scoutYear.id, req.rosterStatuses];
    }

    const participantsResult = await pool.query(participantsQuery, participantsParams);

    const participantId = req.query.participant_id ? Number(req.query.participant_id) : null;
    if (!participantId) {
      return res.json({ success: true, data: { participants: participantsResult.rows, isStaff } });
    }

    const participantSummary = participantsResult.rows.find((p) => p.id === participantId);
    if (!participantSummary) {
      return res.status(404).json({ success: false, message: 'Participant not found in organization' });
    }

    const attendanceResult = await pool.query(
      `SELECT date::text as date, status
         FROM attendance
         WHERE participant_id = $1 AND organization_id = $2
           AND date BETWEEN $3::date AND $4::date
         ORDER BY date ASC`,
      [participantId, organizationId, req.scoutYear.start_date, req.scoutYear.end_date]
    );

    const honorsResult = await pool.query(
      `SELECT date::text as date, reason
         FROM honors
         WHERE participant_id = $1 AND organization_id = $2
           AND date BETWEEN $3::date AND $4::date
         ORDER BY date ASC`,
      [participantId, organizationId, req.scoutYear.start_date, req.scoutYear.end_date]
    );

    const badgeResult = await pool.query(
      `SELECT bp.etoiles,
                bp.date_obtention::text as date,
                bp.badge_template_id,
                bt.name AS badge_name,
                bt.translation_key,
                bt.section AS badge_section,
                bt.level_count,
                COALESCE(bt.levels, '[]'::jsonb) AS template_levels
         FROM badge_progress bp
         JOIN badge_templates bt ON bp.badge_template_id = bt.id
         WHERE bp.participant_id = $1 AND bp.organization_id = $2 AND bp.status = 'approved'
         ORDER BY bp.date_obtention ASC`,
      [participantId, organizationId]
    );

    const pointsResult = await pool.query(
      `SELECT created_at::date as date, value
         FROM points
         WHERE participant_id = $1 AND organization_id = $2 AND scout_year_id = $3
         ORDER BY created_at ASC`,
      [participantId, organizationId, req.scoutYear.id]
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
        isStaff,
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
  }));

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
  router.get('/parent-contact-list', authenticate, requirePermission('reports.view'), withScoutYear(pool), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

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
         JOIN participant_enrollments po ON p.id = po.participant_id
           AND po.scout_year_id = $2 AND po.status = ANY($3::text[])
         LEFT JOIN participant_group_assignments pg ON p.id = pg.participant_id AND pg.organization_id = $1 AND pg.scout_year_id = $2
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN participant_guardians part_guard ON p.id = part_guard.participant_id
         LEFT JOIN parents_guardians pg_table ON part_guard.guardian_id = pg_table.id
         WHERE po.organization_id = $1
         ORDER BY p.last_name, p.first_name, pg_table.is_primary DESC, pg_table.is_emergency_contact DESC`,
      [organizationId, req.scoutYear.id, req.rosterStatuses]
    );

    res.json({
      success: true,
      contacts: result.rows
    });
  }));

  return router;
};
