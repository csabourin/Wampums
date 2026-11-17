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
const { HTTP_STATUS } = require('../utils/http-status');
const { TIME_HH_MM_LENGTH } = require('../utils/time-units');
const router = express.Router();
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const { sendEmail, getTranslationsByCode, getUserEmailLanguage } = require('../utils/index');
const { resolveOrganizationEmailSender } = require('../services/emailSender');
const { escapeHtml } = require('../utils/api-helpers');

// Incident escalation email queue
const EMAIL_QUEUE_BATCH_SIZE = 50;
const POSTGRES_INT_MAX = 2147483647;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A positive PostgreSQL integer id, or null when the value is not one. */
const asIntegerId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= POSTGRES_INT_MAX ? id : null;
};

/**
 * Check the youth, account and activity a report names. Each must be the
 * unit's own: the foreign keys only say the row exists, in any unit, and the
 * report then shows their names.
 *
 * @param {Object} db - Pool or client
 * @param {number} organizationId - The authenticated unit
 * @param {{participantId: *, userId: *, activityId: *}} references - Ids the report will store (null for none)
 * @returns {Promise<Array<{path: string, location: string, msg: string}>>} Field errors; empty when all fit
 */
async function checkIncidentReferences(db, organizationId, { participantId, userId, activityId }) {
  const errors = [];
  const refuse = (path) => errors.push({ path, location: 'body', msg: 'incident_reference_not_in_unit' });
  if (participantId !== null) {
    const id = asIntegerId(participantId);
    const found = id && await db.query(
      'SELECT 1 FROM participant_enrollments WHERE participant_id = $1 AND organization_id = $2 LIMIT 1',
      [id, organizationId]
    );
    if (!found?.rows.length) {refuse('victim_participant_id');}
  }
  if (userId !== null) {
    const found = typeof userId === 'string' && UUID_PATTERN.test(userId) && await db.query(
      'SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
      [userId, organizationId]
    );
    if (!found?.rows.length) {refuse('victim_user_id');}
  }
  if (activityId !== null) {
    const id = asIntegerId(activityId);
    const found = id && await db.query(
      'SELECT 1 FROM activities WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    if (!found?.rows.length) {refuse('activity_id');}
  }
  return errors;
}

/**
 * The ids a report stores, from its request: the youth only for a youth, the
 * account only for a leader or a parent.
 * @param {Object} body - Request body
 * @returns {{participantId: *, userId: *, activityId: *}} Ids, null for none
 */
function incidentReferences(body) {
  const { victim_type: victimType, victim_participant_id: participantId, victim_user_id: userId, activity_id: activityId } = body;
  return {
    participantId: victimType === 'participant' && participantId ? participantId : null,
    userId: ['leader', 'parent'].includes(victimType) && userId ? userId : null,
    activityId: activityId || null,
  };
}

/** Joins naming a report's youth, account and activity, each only when it is the report's unit's own. */
const INCIDENT_NAME_JOINS = `
        LEFT JOIN participants p ON ir.victim_participant_id = p.id
          AND EXISTS (SELECT 1 FROM participant_enrollments pe
                       WHERE pe.participant_id = p.id AND pe.organization_id = ir.organization_id)
        LEFT JOIN users u_victim ON ir.victim_user_id = u_victim.id
          AND EXISTS (SELECT 1 FROM user_organizations uo
                       WHERE uo.user_id = u_victim.id AND uo.organization_id = ir.organization_id)`;
const EMAIL_QUEUE_STALE_SENDING_MINUTES = 15;

// ============================================================
// Email helpers
// ============================================================

/**
 * The escalation email of a submitted incident report, in the recipient's
 * language (an optional language falls back to English key by key).
 * @param {Object} formData - The report's answers
 * @param {{full_name?: string, email?: string}} submitter - Who submitted it
 * @param {string} orgName - The unit's name
 * @param {string} [languageCode] - Recipient's language
 * @returns {{subject: string, text: string, html: string}} Email parts
 */
function buildIncidentEscalationEmail(formData, submitter, orgName, languageCode = 'fr') {
  const bundle = getTranslationsByCode(languageCode);
  const english = getTranslationsByCode('en');
  const t = (key) => bundle[key] || english[key] || key;
  const notGiven = t('incident_email_not_given');
  const victimName = `${formData.victim_first_name || ''} ${formData.victim_last_name || ''}`.trim() || t('incident_email_unknown');
  const date = formData.incident_date || notGiven;
  const time = formData.incident_time || '';
  const location = formData.activity_location || notGiven;
  const exactLocation = formData.exact_incident_location || '';
  const description = formData.incident_description || notGiven;
  const activityNature = formData.activity_nature || notGiven;
  const injuryNature = formData.injury_nature || '';
  const bodyRegions = formData.body_regions || '';
  const firstAid = formData.first_aid_nature || '';
  const submitterName = submitter.full_name || submitter.email || t('incident_email_unknown');
  const when = time ? `${date} ${time}` : date;

  const subject = t('incident_email_subject').replace('{victim}', victimName).replace('{date}', date);
  const rows = [
    ['incident_email_victim', victimName],
    ['incident_email_date_time', when],
    ['incident_email_activity', activityNature],
    ['incident_email_location', exactLocation ? `${location} — ${exactLocation}` : location],
    ['incident_email_description', description, true],
    ['incident_email_injury_type', injuryNature],
    ['incident_email_body_regions', bodyRegions],
    ['incident_email_first_aid', firstAid, true],
  ].filter(([, value]) => value);

  const text = [
    t('incident_email_title'),
    '',
    ...rows.map(([key, value]) => `${t(key)}: ${value}`),
    '',
    `${t('incident_email_submitted_by')}: ${submitterName}`,
    orgName ? `${t('incident_email_organization')}: ${orgName}` : '',
    '',
    t('incident_email_automated'),
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #d9534f; color: white; padding: 16px 24px;">
        <h2 style="margin: 0;">${escapeHtml(t('incident_email_title'))}</h2>
        ${orgName ? `<p style="margin: 4px 0 0; opacity: 0.9; font-size: 14px;">${escapeHtml(orgName)}</p>` : ''}
      </div>
      <div style="padding: 24px;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          ${rows.map(([key, value, long]) => `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px 8px; font-weight: bold; width: 160px; color: #555; vertical-align: top;">${escapeHtml(t(key))}</td>
            <td style="padding: 10px 8px;${long ? ' white-space: pre-wrap;' : ''}">${escapeHtml(value)}</td>
          </tr>`).join('')}
        </table>
        <p style="color: #888; font-size: 13px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 12px;">
          ${escapeHtml(t('incident_email_submitted_by'))} <strong>${escapeHtml(submitterName)}</strong><br/>
          <em>${escapeHtml(t('incident_email_automated'))}</em>
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
  // A row left in 'sending' by a process that died mid-send becomes retryable
  // once it has been stuck longer than any real send takes.
  const params = [EMAIL_QUEUE_STALE_SENDING_MINUTES];
  const whereClauses = [
    `(status IN ('pending', 'failed')
      OR (status = 'sending' AND last_attempt_at < NOW() - make_interval(mins => $1)))`,
    'attempts < max_attempts'
  ];

  if (organizationId) {
    params.push(organizationId);
    whereClauses.push(`organization_id = $${params.length}`);
  }
  if (incidentId) {
    params.push(incidentId);
    whereClauses.push(`incident_report_id = $${params.length}`);
  }

  // Claim the batch in one statement. The submit handler and the periodic
  // retry (on every instance) all call this; SKIP LOCKED plus the 'sending'
  // status guarantee each email is picked up by exactly one of them.
  params.push(EMAIL_QUEUE_BATCH_SIZE);
  const claimed = await pool.query(
    `UPDATE incident_email_queue
     SET status = 'sending', last_attempt_at = NOW(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM incident_email_queue
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY created_at ASC
       LIMIT $${params.length}
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    params
  );

  // A batch can span units; each email goes out under its own unit's identity.
  const unitIds = [...new Set(claimed.rows.map((item) => item.organization_id))];
  const senders = new Map(await Promise.all(
    unitIds.map(async (unitId) => [unitId, await resolveOrganizationEmailSender(pool, unitId)])
  ));

  for (const item of claimed.rows) {
    try {
      // sendEmail reports failure by returning false rather than throwing.
      // eslint-disable-next-line no-await-in-loop -- one send at a time keeps the provider's rate limit
      const sent = await sendEmail(
        item.recipient_email,
        item.subject,
        item.body_text,
        item.body_html,
        senders.get(item.organization_id)
      );
      if (!sent) {
        throw new Error('Email provider did not accept the message');
      }

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
    validateIdParam('participantId'), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const participantId = Number(req.params.participantId);

      // Get participant with age calculation
      const participant = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                EXTRACT(YEAR FROM age(unit_today($2), p.date_naissance))::INTEGER as age
         FROM participants p
         JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $2
         WHERE p.id = $1`,
        [participantId, organizationId]
      );

      if (participant.rows.length === 0) {
        return error(res, 'Participant not found', HTTP_STATUS.NOT_FOUND);
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
        victim_age: p.age === null || p.age === undefined ? '' : p.age.toString(),
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
        return error(res, 'User not found', HTTP_STATUS.NOT_FOUND);
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
    validateIdParam('activityId'), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const activityId = Number(req.params.activityId);

      const activity = await pool.query(
        `SELECT id, name, activity_date, activity_start_time,
                meeting_location_going, description
         FROM activities
         WHERE id = $1 AND organization_id = $2 AND is_active = TRUE`,
        [activityId, organizationId]
      );

      if (activity.rows.length === 0) {
        return error(res, 'Activity not found', HTTP_STATUS.NOT_FOUND);
      }

      const a = activity.rows[0];
      const timeStr = a.activity_start_time
        ? a.activity_start_time.toString().substring(0, TIME_HH_MM_LENGTH)
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
        return error(res, 'Valid email is required', HTTP_STATUS.BAD_REQUEST);
      }

      const result = await pool.query(
        `INSERT INTO incident_escalation_contacts
         (organization_id, email, name, role_description)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, role_description, is_active, created_at`,
        [organizationId, email.trim(), name?.trim() || null, role_description?.trim() || null]
      );

      return success(res, result.rows[0], 'Escalation contact added', HTTP_STATUS.CREATED);
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
    validateIdParam('id'), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const contactId = Number(req.params.id);
      const { email, name, role_description, is_active } = req.body;

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
        return error(res, 'Escalation contact not found', HTTP_STATUS.NOT_FOUND);
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
    validateIdParam('id'), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const contactId = Number(req.params.id);

      const result = await pool.query(
        `DELETE FROM incident_escalation_contacts
         WHERE id = $1 AND organization_id = $2
         RETURNING id`,
        [contactId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Escalation contact not found', HTTP_STATUS.NOT_FOUND);
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
        ${INCIDENT_NAME_JOINS}
        LEFT JOIN users u_author ON ir.created_by = u_author.id
        LEFT JOIN activities a ON ir.activity_id = a.id AND a.organization_id = ir.organization_id
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
    validateIdParam('id'), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const incidentId = Number(req.params.id);

      const result = await pool.query(
        `SELECT ir.*,
                fs.submission_data, fs.form_type, fs.form_version_id,
                p.first_name AS victim_first_name, p.last_name AS victim_last_name,
                u_victim.full_name AS victim_user_name,
                u_author.full_name AS author_name,
                a.name AS activity_name
         FROM incident_reports ir
         LEFT JOIN form_submissions fs ON ir.form_submission_id = fs.id
         ${INCIDENT_NAME_JOINS}
         LEFT JOIN users u_author ON ir.created_by = u_author.id
         LEFT JOIN activities a ON ir.activity_id = a.id AND a.organization_id = ir.organization_id
         WHERE ir.id = $1 AND ir.organization_id = $2`,
        [incidentId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Incident report not found', HTTP_STATUS.NOT_FOUND);
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

      const references = incidentReferences(req.body);
      const referenceErrors = await checkIncidentReferences(pool, organizationId, references);
      if (referenceErrors.length > 0) {
        return error(res, 'incident_reference_not_in_unit', HTTP_STATUS.BAD_REQUEST, referenceErrors);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Create form_submission record. It names no youth: the report does
        // (victim_participant_id). A youth may be in several reports, while a
        // youth has one submission of each form type (form_submissions_unique_constraint).
        const formSubmission = await client.query(
          `INSERT INTO form_submissions
           (organization_id, participant_id, form_type, submission_data, user_id, status)
           VALUES ($1, NULL, 'incident_report', $2, $3, 'draft')
           RETURNING id`,
          [
            organizationId,
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
        return success(res, incident.rows[0], 'Incident report created', HTTP_STATUS.CREATED);
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
    validateIdParam('id'), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const incidentId = Number(req.params.id);

      const {
        victim_type,
        victim_participant_id,
        victim_user_id,
        victim_name,
        activity_id,
        form_data
      } = req.body;

      const referenceErrors = await checkIncidentReferences(pool, organizationId, incidentReferences(req.body));
      if (referenceErrors.length > 0) {
        return error(res, 'incident_reference_not_in_unit', HTTP_STATUS.BAD_REQUEST, referenceErrors);
      }

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
          return error(res, 'Incident report not found', HTTP_STATUS.NOT_FOUND);
        }

        if (existing.rows[0].status !== 'draft') {
          await client.query('ROLLBACK');
          return error(res, 'Cannot edit a submitted report', HTTP_STATUS.CONFLICT);
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
    validateIdParam('id'), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const incidentId = Number(req.params.id);

      // Check status first
      const existing = await pool.query(
        `SELECT id, status, form_submission_id FROM incident_reports
         WHERE id = $1 AND organization_id = $2`,
        [incidentId, organizationId]
      );

      if (existing.rows.length === 0) {
        return error(res, 'Incident report not found', HTTP_STATUS.NOT_FOUND);
      }

      if (existing.rows[0].status !== 'draft') {
        return error(res, 'Cannot delete a submitted report', HTTP_STATUS.CONFLICT);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Delete incident_reports first (FK cascade will not handle form_submissions)
        // Still a draft at the moment of deleting: one submitted meanwhile stays.
        const deleted = await client.query(
          `DELETE FROM incident_reports WHERE id = $1 AND organization_id = $2 AND status = 'draft'
           RETURNING id`,
          [incidentId, organizationId]
        );
        if (deleted.rows.length === 0) {
          await client.query('ROLLBACK');
          return error(res, 'Cannot delete a submitted report', HTTP_STATUS.CONFLICT);
        }

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
    validateIdParam('id'), checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const incidentId = Number(req.params.id);
      const userId = req.user.id;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Verify ownership and draft status
        // Locked: a second submit at the same moment waits, then finds it submitted.
        const existing = await client.query(
          `SELECT ir.*, fs.submission_data
           FROM incident_reports ir
           LEFT JOIN form_submissions fs ON ir.form_submission_id = fs.id
           WHERE ir.id = $1 AND ir.organization_id = $2
           FOR UPDATE OF ir`,
          [incidentId, organizationId]
        );

        if (existing.rows.length === 0) {
          await client.query('ROLLBACK');
          return error(res, 'Incident report not found', HTTP_STATUS.NOT_FOUND);
        }

        if (existing.rows[0].status !== 'draft') {
          await client.query('ROLLBACK');
          return error(res, 'Report already submitted', HTTP_STATUS.CONFLICT);
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

          for (const contact of contacts.rows) {
            // eslint-disable-next-line no-await-in-loop -- each contact reads the report in their own language
            const languageCode = await getUserEmailLanguage(client, contact.email, organizationId);
            const emailContent = buildIncidentEscalationEmail(formData, submitterInfo, orgName, languageCode);
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
