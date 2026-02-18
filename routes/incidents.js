/**
 * Incident Report Routes
 *
 * Full CRUD for incident/accident reports with escalation email support.
 * Uses the formBuilder system (organization_form_formats + form_submissions)
 * for the form template, and incident_reports table for metadata/workflow.
 *
 * Endpoints:
 *   GET    /v1/incidents                             - List incident reports
 *   GET    /v1/incidents/prefill/participant/:id      - Prefill from participant data
 *   GET    /v1/incidents/prefill/user/:id             - Prefill from user data
 *   GET    /v1/incidents/prefill/activity/:id         - Prefill from activity data
 *   GET    /v1/incidents/escalation-contacts          - List escalation contacts
 *   POST   /v1/incidents/escalation-contacts          - Add escalation contact
 *   PATCH  /v1/incidents/escalation-contacts/:id      - Update escalation contact
 *   DELETE /v1/incidents/escalation-contacts/:id      - Remove escalation contact
 *   GET    /v1/incidents/:id                          - Get single incident report
 *   POST   /v1/incidents                              - Create draft incident report
 *   PATCH  /v1/incidents/:id                          - Update draft incident report
 *   DELETE /v1/incidents/:id                          - Delete draft incident report
 *   POST   /v1/incidents/:id/submit                   - Submit and trigger escalation
 */

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { sendEmail } = require('../utils/index');
const { escapeHtml } = require('../utils/api-helpers');

// ============================================================
// Email helpers
// ============================================================

/**
 * Build escalation email content from incident form data
 * @param {Object} formData - The form submission data JSONB
 * @param {Object} submitter - The user who submitted { full_name, email }
 * @param {string} orgName - Organization name (optional)
 * @returns {{ subject: string, text: string, html: string }}
 */
function buildIncidentEscalationEmail(formData, submitter, orgName) {
  const victimName = `${formData.victim_first_name || ''} ${formData.victim_last_name || ''}`.trim() || 'Unknown';
  const date = formData.incident_date || 'N/A';
  const time = formData.incident_time || '';
  const location = formData.activity_location || 'N/A';
  const exactLocation = formData.exact_incident_location || '';
  const description = formData.incident_description || 'N/A';
  const activityNature = formData.activity_nature || 'N/A';
  const injuryNature = formData.injury_nature || '';
  const bodyRegions = formData.body_regions || '';
  const firstAid = formData.first_aid_nature || '';
  const submitterName = submitter.full_name || submitter.email || 'Unknown';

  const subject = `[INCIDENT REPORT] ${victimName} - ${date}`;

  const text = [
    'INCIDENT / ACCIDENT REPORT',
    '==========================',
    '',
    `Victim: ${victimName}`,
    `Date: ${date} ${time}`,
    `Activity: ${activityNature}`,
    `Location: ${location}${exactLocation ? ' - ' + exactLocation : ''}`,
    '',
    `Description: ${description}`,
    '',
    injuryNature ? `Injury Type: ${injuryNature}` : '',
    bodyRegions ? `Body Regions: ${bodyRegions}` : '',
    firstAid ? `First Aid: ${firstAid}` : '',
    '',
    `Submitted by: ${submitterName}`,
    orgName ? `Organization: ${orgName}` : '',
    '',
    'This is an automated notification. Please review the full report in Wampums.'
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #d9534f; color: white; padding: 16px 24px;">
        <h2 style="margin: 0;">Incident / Accident Report</h2>
        ${orgName ? `<p style="margin: 4px 0 0; opacity: 0.9; font-size: 14px;">${escapeHtml(orgName)}</p>` : ''}
      </div>
      <div style="padding: 24px;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 8px; font-weight: bold; width: 160px; color: #555;">Victim</td>
            <td style="padding: 10px 8px;">${escapeHtml(victimName)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 8px; font-weight: bold; color: #555;">Date / Time</td>
            <td style="padding: 10px 8px;">${escapeHtml(date)}${time ? ' at ' + escapeHtml(time) : ''}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 8px; font-weight: bold; color: #555;">Activity</td>
            <td style="padding: 10px 8px;">${escapeHtml(activityNature)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 8px; font-weight: bold; color: #555;">Location</td>
            <td style="padding: 10px 8px;">${escapeHtml(location)}${exactLocation ? ' &mdash; ' + escapeHtml(exactLocation) : ''}</td>
          </tr>
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 8px; font-weight: bold; color: #555; vertical-align: top;">Description</td>
            <td style="padding: 10px 8px; white-space: pre-wrap;">${escapeHtml(description)}</td>
          </tr>
          ${injuryNature ? `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 8px; font-weight: bold; color: #555;">Injury Type</td>
            <td style="padding: 10px 8px;">${escapeHtml(injuryNature)}</td>
          </tr>` : ''}
          ${bodyRegions ? `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 8px; font-weight: bold; color: #555;">Body Regions</td>
            <td style="padding: 10px 8px;">${escapeHtml(bodyRegions)}</td>
          </tr>` : ''}
          ${firstAid ? `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 8px; font-weight: bold; color: #555;">First Aid</td>
            <td style="padding: 10px 8px; white-space: pre-wrap;">${escapeHtml(firstAid)}</td>
          </tr>` : ''}
        </table>
        <p style="color: #888; font-size: 13px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 12px;">
          Submitted by <strong>${escapeHtml(submitterName)}</strong><br/>
          <em>This is an automated notification. Please review the full report in Wampums.</em>
        </p>
      </div>
    </div>`;

  return { subject, text, html };
}

/**
 * Process pending incident escalation emails from the queue
 * Called both on submit (immediate attempt) and periodically (retry)
 * @param {Object} pool - Database pool
 * @param {Object} logger - Logger instance
 * @param {number|null} organizationId - Scope to specific org (optional)
 * @param {number|null} incidentId - Scope to specific incident (optional)
 */
async function processEmailQueue(pool, logger, organizationId = null, incidentId = null) {
  const whereClauses = [
    "status IN ('pending', 'failed')",
    'attempts < max_attempts'
  ];
  const params = [];

  if (organizationId) {
    params.push(organizationId);
    whereClauses.push(`organization_id = $${params.length}`);
  }
  if (incidentId) {
    params.push(incidentId);
    whereClauses.push(`incident_report_id = $${params.length}`);
  }

  const queued = await pool.query(
    `SELECT * FROM incident_email_queue
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY created_at ASC
     LIMIT 50`,
    params
  );

  for (const item of queued.rows) {
    try {
      await pool.query(
        `UPDATE incident_email_queue
         SET status = 'sending', last_attempt_at = NOW(), attempts = attempts + 1
         WHERE id = $1`,
        [item.id]
      );

      await sendEmail(item.recipient_email, item.subject, item.body_text, item.body_html);

      await pool.query(
        `UPDATE incident_email_queue SET status = 'sent', sent_at = NOW() WHERE id = $1`,
        [item.id]
      );

      if (logger) {
        logger.info(`Incident escalation email sent to ${item.recipient_email} for incident #${item.incident_report_id}`);
      }
    } catch (err) {
      if (logger) {
        logger.error(`Failed to send incident email ${item.id}:`, err.message);
      }
      await pool.query(
        `UPDATE incident_email_queue SET status = 'failed', error_message = $1 WHERE id = $2`,
        [err.message, item.id]
      );
    }
  }
}

// ============================================================
// Route factory
// ============================================================

module.exports = (pool, logger) => {

  // ----------------------------------------------------------
  // Prefill endpoints (mounted BEFORE /:id to avoid conflicts)
  // ----------------------------------------------------------

  /**
   * GET /prefill/participant/:participantId
   * Returns pre-fill data from participant + guardian + group
   */
  router.get('/prefill/participant/:participantId',
    authenticate,
    requirePermission('incidents.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const participantId = parseInt(req.params.participantId);

      if (isNaN(participantId)) {
        return error(res, 'Invalid participant ID', 400);
      }

      // Get participant with age calculation
      const participant = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_naissance))::INTEGER as age
         FROM participants p
         JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $2
         WHERE p.id = $1`,
        [participantId, organizationId]
      );

      if (participant.rows.length === 0) {
        return error(res, 'Participant not found', 404);
      }

      // Get primary guardian
      const guardian = await pool.query(
        `SELECT pg.nom, pg.prenom, pg.courriel,
                pg.telephone_residence, pg.telephone_travail, pg.telephone_cellulaire
         FROM parents_guardians pg
         JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
         WHERE pgu.participant_id = $1 AND pg.is_primary = TRUE
         LIMIT 1`,
        [participantId]
      );

      // Get group info (unit name, section/branch)
      const group = await pool.query(
        `SELECT g.name, g.section
         FROM groups g
         JOIN participant_groups pg ON g.id = pg.group_id
         WHERE pg.participant_id = $1 AND pg.organization_id = $2`,
        [participantId, organizationId]
      );

      const p = participant.rows[0];
      const g = guardian.rows[0] || {};
      const grp = group.rows[0] || {};

      const prefill = {
        victim_last_name: p.last_name || '',
        victim_first_name: p.first_name || '',
        victim_age: p.age != null ? p.age.toString() : '',
        guardian_name: g.prenom && g.nom ? `${g.prenom} ${g.nom}` : '',
        victim_phone_home: g.telephone_residence || g.telephone_cellulaire || '',
        victim_phone_work: g.telephone_travail || '',
        victim_email: g.courriel || '',
        unit_name: grp.name || '',
        unit_branch: grp.section || ''
      };

      return success(res, prefill);
    })
  );

  /**
   * GET /prefill/user/:userId
   * Returns pre-fill data from user record (for leader/parent victims)
   */
  router.get('/prefill/user/:userId',
    authenticate,
    requirePermission('incidents.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const userId = req.params.userId; // UUID string

      const user = await pool.query(
        `SELECT u.id, u.full_name, u.email
         FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         WHERE u.id = $1 AND uo.organization_id = $2`,
        [userId, organizationId]
      );

      if (user.rows.length === 0) {
        return error(res, 'User not found', 404);
      }

      const u = user.rows[0];
      const nameParts = (u.full_name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const prefill = {
        victim_first_name: firstName,
        victim_last_name: lastName,
        victim_email: u.email || ''
      };

      return success(res, prefill);
    })
  );

  /**
   * GET /prefill/activity/:activityId
   * Returns pre-fill data from activity record
   */
  router.get('/prefill/activity/:activityId',
    authenticate,
    requirePermission('incidents.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const activityId = parseInt(req.params.activityId);

      if (isNaN(activityId)) {
        return error(res, 'Invalid activity ID', 400);
      }

      const activity = await pool.query(
        `SELECT id, name, activity_date, activity_start_time,
                meeting_location_going, description
         FROM activities
         WHERE id = $1 AND organization_id = $2 AND is_active = TRUE`,
        [activityId, organizationId]
      );

      if (activity.rows.length === 0) {
        return error(res, 'Activity not found', 404);
      }

      const a = activity.rows[0];
      const timeStr = a.activity_start_time
        ? a.activity_start_time.toString().substring(0, 5)
        : '';

      const prefill = {
        incident_date: a.activity_date ? a.activity_date.toISOString().split('T')[0] : '',
        incident_time: timeStr,
        activity_nature: a.name || '',
        activity_location: a.meeting_location_going || ''
      };

      return success(res, prefill);
    })
  );

  // ----------------------------------------------------------
  // Escalation contacts CRUD
  // ----------------------------------------------------------

  /**
   * GET /escalation-contacts
   * List escalation contacts for the organization
   */
  router.get('/escalation-contacts',
    authenticate,
    requirePermission('incidents.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT id, email, name, role_description, is_active, created_at
         FROM incident_escalation_contacts
         WHERE organization_id = $1
         ORDER BY name ASC, email ASC`,
        [organizationId]
      );

      return success(res, result.rows);
    })
  );

  /**
   * POST /escalation-contacts
   * Add an escalation contact
   */
  router.post('/escalation-contacts',
    authenticate,
    blockDemoRoles,
    requirePermission('incidents.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { email, name, role_description } = req.body;

      if (!email || !email.includes('@')) {
        return error(res, 'Valid email is required', 400);
      }

      const result = await pool.query(
        `INSERT INTO incident_escalation_contacts
         (organization_id, email, name, role_description)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, role_description, is_active, created_at`,
        [organizationId, email.trim(), name?.trim() || null, role_description?.trim() || null]
      );

      return success(res, result.rows[0], 'Escalation contact added', 201);
    })
  );

  /**
   * PATCH /escalation-contacts/:id
   * Update an escalation contact
   */
  router.patch('/escalation-contacts/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('incidents.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const contactId = parseInt(req.params.id);
      const { email, name, role_description, is_active } = req.body;

      if (isNaN(contactId)) {
        return error(res, 'Invalid contact ID', 400);
      }

      const result = await pool.query(
        `UPDATE incident_escalation_contacts
         SET email = COALESCE($1, email),
             name = COALESCE($2, name),
             role_description = COALESCE($3, role_description),
             is_active = COALESCE($4, is_active),
             updated_at = NOW()
         WHERE id = $5 AND organization_id = $6
         RETURNING id, email, name, role_description, is_active`,
        [email?.trim(), name?.trim(), role_description?.trim(), is_active, contactId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Escalation contact not found', 404);
      }

      return success(res, result.rows[0], 'Escalation contact updated');
    })
  );

  /**
   * DELETE /escalation-contacts/:id
   * Remove an escalation contact
   */
  router.delete('/escalation-contacts/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('incidents.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const contactId = parseInt(req.params.id);

      if (isNaN(contactId)) {
        return error(res, 'Invalid contact ID', 400);
      }

      const result = await pool.query(
        `DELETE FROM incident_escalation_contacts
         WHERE id = $1 AND organization_id = $2
         RETURNING id`,
        [contactId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Escalation contact not found', 404);
      }

      return success(res, null, 'Escalation contact removed');
    })
  );

  // ----------------------------------------------------------
  // Incident report CRUD
  // ----------------------------------------------------------

  /**
   * GET /
   * List incident reports for the organization
   */
  router.get('/',
    authenticate,
    requirePermission('incidents.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { status } = req.query;

      let query = `
        SELECT ir.id, ir.status, ir.victim_type, ir.victim_name,
               ir.incident_date, ir.incident_time, ir.incident_location,
               ir.activity_id, ir.escalation_sent_at,
               ir.created_at, ir.submitted_at,
               ir.created_by, ir.submitted_by,
               fs.submission_data,
               p.first_name AS victim_first_name, p.last_name AS victim_last_name,
               u_victim.full_name AS victim_user_name,
               u_author.full_name AS author_name,
               a.name AS activity_name
        FROM incident_reports ir
        LEFT JOIN form_submissions fs ON ir.form_submission_id = fs.id
        LEFT JOIN participants p ON ir.victim_participant_id = p.id
        LEFT JOIN users u_victim ON ir.victim_user_id = u_victim.id
        LEFT JOIN users u_author ON ir.created_by = u_author.id
        LEFT JOIN activities a ON ir.activity_id = a.id
        WHERE ir.organization_id = $1`;

      const params = [organizationId];

      if (status && ['draft', 'submitted'].includes(status)) {
        params.push(status);
        query += ` AND ir.status = $${params.length}`;
      }

      query += ' ORDER BY ir.incident_date DESC NULLS LAST, ir.created_at DESC';

      const result = await pool.query(query, params);

      return success(res, result.rows);
    })
  );

  /**
   * GET /:id
   * Get a single incident report with full form data
   */
  router.get('/:id',
    authenticate,
    requirePermission('incidents.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const incidentId = parseInt(req.params.id);

      if (isNaN(incidentId)) {
        return error(res, 'Invalid incident ID', 400);
      }

      const result = await pool.query(
        `SELECT ir.*,
                fs.submission_data, fs.form_type, fs.form_version_id,
                p.first_name AS victim_first_name, p.last_name AS victim_last_name,
                u_victim.full_name AS victim_user_name,
                u_author.full_name AS author_name,
                a.name AS activity_name
         FROM incident_reports ir
         LEFT JOIN form_submissions fs ON ir.form_submission_id = fs.id
         LEFT JOIN participants p ON ir.victim_participant_id = p.id
         LEFT JOIN users u_victim ON ir.victim_user_id = u_victim.id
         LEFT JOIN users u_author ON ir.created_by = u_author.id
         LEFT JOIN activities a ON ir.activity_id = a.id
         WHERE ir.id = $1 AND ir.organization_id = $2`,
        [incidentId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Incident report not found', 404);
      }

      return success(res, result.rows[0]);
    })
  );

  /**
   * POST /
   * Create a new draft incident report
   * Creates both form_submissions and incident_reports records in a transaction
   */
  router.post('/',
    authenticate,
    blockDemoRoles,
    requirePermission('incidents.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const userId = req.user.id;
      const {
        victim_type,
        victim_participant_id,
        victim_user_id,
        victim_name,
        activity_id,
        form_data
      } = req.body;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Create form_submission record
        const formSubmission = await client.query(
          `INSERT INTO form_submissions
           (organization_id, participant_id, form_type, submission_data, user_id, status)
           VALUES ($1, $2, 'incident_report', $3, $4, 'draft')
           RETURNING id`,
          [
            organizationId,
            victim_type === 'participant' && victim_participant_id ? victim_participant_id : null,
            JSON.stringify(form_data || {}),
            userId
          ]
        );

        // 2. Extract denormalized fields
        const incidentDate = form_data?.incident_date || null;
        const incidentTime = form_data?.incident_time || null;
        const incidentLocation = form_data?.activity_location || null;

        // 3. Create incident_reports record
        const incident = await client.query(
          `INSERT INTO incident_reports
           (organization_id, form_submission_id, status, victim_type,
            victim_participant_id, victim_user_id, victim_name,
            activity_id, incident_date, incident_time, incident_location,
            created_by)
           VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            organizationId,
            formSubmission.rows[0].id,
            victim_type || 'other',
            victim_type === 'participant' && victim_participant_id ? victim_participant_id : null,
            ['leader', 'parent'].includes(victim_type) && victim_user_id ? victim_user_id : null,
            victim_name || null,
            activity_id || null,
            incidentDate || null,
            incidentTime || null,
            incidentLocation || null,
            userId
          ]
        );

        await client.query('COMMIT');
        return success(res, incident.rows[0], 'Incident report created', 201);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  /**
   * PATCH /:id
   * Update a draft incident report
   */
  router.patch('/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('incidents.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const incidentId = parseInt(req.params.id);

      if (isNaN(incidentId)) {
        return error(res, 'Invalid incident ID', 400);
      }

      const {
        victim_type,
        victim_participant_id,
        victim_user_id,
        victim_name,
        activity_id,
        form_data
      } = req.body;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Verify ownership, draft status, and get form_submission_id
        const existing = await client.query(
          `SELECT ir.id, ir.form_submission_id, ir.status
           FROM incident_reports ir
           WHERE ir.id = $1 AND ir.organization_id = $2`,
          [incidentId, organizationId]
        );

        if (existing.rows.length === 0) {
          await client.query('ROLLBACK');
          return error(res, 'Incident report not found', 404);
        }

        if (existing.rows[0].status !== 'draft') {
          await client.query('ROLLBACK');
          return error(res, 'Cannot edit a submitted report', 409);
        }

        // Update form_submissions if form_data provided
        if (form_data && existing.rows[0].form_submission_id) {
          await client.query(
            `UPDATE form_submissions
             SET submission_data = $1, updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(form_data), existing.rows[0].form_submission_id]
          );
        }

        // Extract denormalized fields
        const incidentDate = form_data?.incident_date || null;
        const incidentTime = form_data?.incident_time || null;
        const incidentLocation = form_data?.activity_location || null;

        // Update incident_reports metadata
        const updated = await client.query(
          `UPDATE incident_reports
           SET victim_type = COALESCE($1, victim_type),
               victim_participant_id = $2,
               victim_user_id = $3,
               victim_name = COALESCE($4, victim_name),
               activity_id = $5,
               incident_date = COALESCE($6, incident_date),
               incident_time = COALESCE($7, incident_time),
               incident_location = COALESCE($8, incident_location),
               updated_at = NOW()
           WHERE id = $9 AND organization_id = $10
           RETURNING *`,
          [
            victim_type,
            victim_type === 'participant' && victim_participant_id ? victim_participant_id : null,
            ['leader', 'parent'].includes(victim_type) && victim_user_id ? victim_user_id : null,
            victim_name,
            activity_id || null,
            incidentDate,
            incidentTime,
            incidentLocation,
            incidentId,
            organizationId
          ]
        );

        await client.query('COMMIT');
        return success(res, updated.rows[0], 'Incident report updated');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  /**
   * DELETE /:id
   * Delete a draft incident report (cannot delete submitted reports)
   */
  router.delete('/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('incidents.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const incidentId = parseInt(req.params.id);

      if (isNaN(incidentId)) {
        return error(res, 'Invalid incident ID', 400);
      }

      // Check status first
      const existing = await pool.query(
        `SELECT id, status, form_submission_id FROM incident_reports
         WHERE id = $1 AND organization_id = $2`,
        [incidentId, organizationId]
      );

      if (existing.rows.length === 0) {
        return error(res, 'Incident report not found', 404);
      }

      if (existing.rows[0].status !== 'draft') {
        return error(res, 'Cannot delete a submitted report', 409);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Delete incident_reports first (FK cascade will not handle form_submissions)
        await client.query(
          'DELETE FROM incident_reports WHERE id = $1 AND organization_id = $2',
          [incidentId, organizationId]
        );

        // Delete associated form_submission
        if (existing.rows[0].form_submission_id) {
          await client.query(
            'DELETE FROM form_submissions WHERE id = $1',
            [existing.rows[0].form_submission_id]
          );
        }

        await client.query('COMMIT');
        return success(res, null, 'Incident report deleted');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  /**
   * POST /:id/submit
   * Submit a draft report — transitions to 'submitted' and triggers escalation emails
   */
  router.post('/:id/submit',
    authenticate,
    blockDemoRoles,
    requirePermission('incidents.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const incidentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(incidentId)) {
        return error(res, 'Invalid incident ID', 400);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Verify ownership and draft status
        const existing = await client.query(
          `SELECT ir.*, fs.submission_data
           FROM incident_reports ir
           LEFT JOIN form_submissions fs ON ir.form_submission_id = fs.id
           WHERE ir.id = $1 AND ir.organization_id = $2`,
          [incidentId, organizationId]
        );

        if (existing.rows.length === 0) {
          await client.query('ROLLBACK');
          return error(res, 'Incident report not found', 404);
        }

        if (existing.rows[0].status !== 'draft') {
          await client.query('ROLLBACK');
          return error(res, 'Report already submitted', 409);
        }

        const now = new Date();
        const formData = existing.rows[0].submission_data || {};

        // 2. Update incident_reports status
        await client.query(
          `UPDATE incident_reports
           SET status = 'submitted', submitted_at = $1, submitted_by = $2, updated_at = $1
           WHERE id = $3 AND organization_id = $4`,
          [now, userId, incidentId, organizationId]
        );

        // 3. Update form_submissions status
        if (existing.rows[0].form_submission_id) {
          await client.query(
            `UPDATE form_submissions
             SET status = 'submitted', submitted_at = $1, updated_at = $1
             WHERE id = $2`,
            [now, existing.rows[0].form_submission_id]
          );
        }

        // 4. Queue escalation emails
        const contacts = await client.query(
          `SELECT email, name FROM incident_escalation_contacts
           WHERE organization_id = $1 AND is_active = TRUE`,
          [organizationId]
        );

        let escalationSentTo = [];

        if (contacts.rows.length > 0) {
          // Get org name for email
          const org = await client.query(
            'SELECT name FROM organizations WHERE id = $1',
            [organizationId]
          );
          const orgName = org.rows[0]?.name || '';

          // Get submitter info
          const submitter = await client.query(
            'SELECT full_name, email FROM users WHERE id = $1',
            [userId]
          );
          const submitterInfo = submitter.rows[0] || { full_name: 'Unknown', email: '' };

          const emailContent = buildIncidentEscalationEmail(formData, submitterInfo, orgName);

          for (const contact of contacts.rows) {
            await client.query(
              `INSERT INTO incident_email_queue
               (organization_id, incident_report_id, recipient_email, recipient_name,
                subject, body_text, body_html)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                organizationId, incidentId,
                contact.email, contact.name,
                emailContent.subject, emailContent.text, emailContent.html
              ]
            );
          }

          escalationSentTo = contacts.rows.map(c => c.email);

          // Record who will receive escalation
          await client.query(
            `UPDATE incident_reports SET escalation_sent_to = $1, escalation_sent_at = $2
             WHERE id = $3`,
            [escalationSentTo, now, incidentId]
          );
        }

        await client.query('COMMIT');

        // 5. Attempt immediate email send (non-blocking, outside transaction)
        if (escalationSentTo.length > 0) {
          processEmailQueue(pool, logger, organizationId, incidentId).catch(err => {
            if (logger) {
              logger.error('Immediate email send failed (queued for retry):', err.message);
            }
          });
        }

        return success(res, {
          id: incidentId,
          status: 'submitted',
          escalation_sent_to: escalationSentTo
        }, 'Incident report submitted');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  return router;
};

// Export processEmailQueue for use in api.js background interval
module.exports.processEmailQueue = processEmailQueue;
