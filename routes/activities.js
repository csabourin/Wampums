const { createHash } = require('node:crypto');
const express = require('express');
const router = express.Router();
const { authenticate, getOrganizationId, requirePermission, blockDemoRoles } = require('../middleware/auth');
const { toBool } = require('../utils');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const logger = require('../config/logger');
const {
  sendActivityUpdateNotifications,
  findActivityCancellationRecipients,
  sendActivityCancellationNotifications
} = require('../utils/carpool-notifications');
const { carpoolRosterRestriction } = require('../services/carpoolAccess');
const { mayReadInviteeList, readInvitation, saveInvitation } = require('../services/activityInvitations');
const { readRichTextField } = require('../utils/richText');
const { CampDateError, isTooLong, alignPlannedDate, planCamp, unplanCamp } = require('../services/campDates');
const { buildActivitiesCalendar, buildICalFilename } = require('../utils/activityCalendar');

module.exports = (pool) => {
  /** Creation retry metadata stays on the server. */
  const publicActivity = (activity) => {
    const result = { ...activity };
    delete result.creation_key;
    delete result.creation_fingerprint;
    return result;
  };
  const AUTHORIZATION_TEXT_MAX_LENGTH = 10000;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
  const HTTP_BAD_REQUEST = 400;
  const HTTP_CREATED = 201;
  const HTTP_CONFLICT = 409;
  const HOURS_PER_DAY = 24;
  const MINUTES_PER_HOUR = 60;
  const SECONDS_PER_MINUTE = 60;

  // Editable activity fields, grouped by how an update reads them
  const REQUIRED_TEXT_FIELDS = ['meeting_location_going'];
  const OPTIONAL_TEXT_FIELDS = ['description', 'authorization_text', 'meeting_location_return'];
  const DATE_FIELDS = ['activity_date', 'activity_start_date', 'activity_end_date'];
  const TIME_FIELDS = [
    'activity_start_time',
    'activity_end_time',
    'meeting_time_going',
    'departure_time_going',
    'meeting_time_return',
    'departure_time_return'
  ];
  const REQUIRED_FIELDS = [
    'name',
    'activity_date',
    'activity_start_date',
    'activity_start_time',
    'activity_end_date',
    'activity_end_time',
    'meeting_location_going',
    'meeting_time_going',
    'departure_time_going'
  ];

  /**
   * Get all activities for the organization
   * Accessible by: animation, admin, parent
   */
  router.get('/', authenticate, requirePermission('activities.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT
        a.*,
        u.full_name as created_by_name,
        ypm.id AS linked_year_plan_meeting_id,
        ypm.meeting_date::text AS linked_year_plan_meeting_date,
        ypm.year_plan_id AS linked_year_plan_id,
        ypm.meeting_kind AS linked_year_plan_meeting_kind,
        COUNT(DISTINCT co.id) as carpool_offer_count,
        COUNT(DISTINCT ca.participant_id) as assigned_participant_count,
        COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'pending') as pending_slip_count,
        COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'signed') as signed_slip_count,
        COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'declined') as declined_slip_count,
        (SELECT COUNT(*) FROM activity_invitees ai
          WHERE ai.activity_id = a.id AND ai.organization_id = a.organization_id) AS invited_count
       FROM activities a
       LEFT JOIN users u ON a.created_by = u.id
       LEFT JOIN year_plan_meetings ypm
              ON ypm.activity_id = a.id AND ypm.organization_id = a.organization_id
       LEFT JOIN carpool_offers co ON a.id = co.activity_id AND co.is_active = TRUE
       LEFT JOIN carpool_assignments ca ON co.id = ca.carpool_offer_id
       LEFT JOIN permission_slips ps ON a.id = ps.activity_id AND ps.status IN ('pending', 'signed', 'declined')
       WHERE a.organization_id = $1 AND a.is_active = TRUE
       GROUP BY a.id, u.full_name, ypm.id
       ORDER BY COALESCE(a.activity_start_date, a.activity_date) ASC, a.activity_start_time ASC, a.departure_time_going ASC`,
      [organizationId]
    );

    return success(res, result.rows.map(publicActivity));
  }));

  /**
   * Download active activities as iCalendar file.
   * Accessible by: animation, admin, parent
   */
  router.get('/calendar.ics', authenticate, requirePermission('activities.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const { body, organizationName } = await buildActivitiesCalendar(pool, organizationId);
    const calendarFilename = buildICalFilename(organizationName);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${calendarFilename}"; filename*=UTF-8''${encodeURIComponent(calendarFilename)}`);
    return res.status(200).send(body);
  }));

  /**
   * Get all participants for an activity (used by carpool dashboard)
   * Returns the invited participants with their carpool assignment status
   * Accessible by: animation, admin, parent
   */
  router.get('/:id/participants', authenticate, requirePermission('carpools.view'), validateIdParam('id'), checkValidation, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    // Verify activity exists and belongs to organization
    const activityCheck = await pool.query(
      'SELECT id FROM activities WHERE id = $1 AND organization_id = $2 AND is_active = TRUE',
      [id, organizationId]
    );

    if (activityCheck.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    // A family sees its own children, not the unit's roster and contacts.
    const onlyChildrenOf = await carpoolRosterRestriction(req, pool);
    const result = await pool.query(
      `SELECT
        p.id,
        p.first_name,
        p.last_name,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'user_id', up.user_id,
              'guardian_name', u.full_name,
              'guardian_email', u.email
            )
          ) FILTER (WHERE up.user_id IS NOT NULL),
          '[]'
        ) as guardians,
        CASE
          WHEN ca_going.participant_id IS NOT NULL THEN TRUE
          ELSE FALSE
        END as has_ride_going,
        CASE
          WHEN ca_return.participant_id IS NOT NULL THEN TRUE
          ELSE FALSE
        END as has_ride_return
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       -- user_participants has no unit: only guardians active in this unit.
       LEFT JOIN user_participants up ON p.id = up.participant_id
         AND EXISTS (SELECT 1 FROM user_organizations uo
                      WHERE uo.user_id = up.user_id AND uo.organization_id = $2 AND uo.status = 'active')
       LEFT JOIN users u ON up.user_id = u.id
       LEFT JOIN carpool_assignments ca_going ON p.id = ca_going.participant_id
         AND ca_going.trip_direction IN ('both', 'to_activity')
         AND ca_going.carpool_offer_id IN (
           SELECT co.id FROM carpool_offers co WHERE co.activity_id = $1 AND co.is_active = TRUE
         )
       LEFT JOIN carpool_assignments ca_return ON p.id = ca_return.participant_id
         AND ca_return.trip_direction IN ('both', 'from_activity')
         AND ca_return.carpool_offer_id IN (
           SELECT co.id FROM carpool_offers co WHERE co.activity_id = $1 AND co.is_active = TRUE
         )
       WHERE po.organization_id = $2
         AND ($3::uuid IS NULL OR p.id IN (SELECT participant_id FROM user_participants WHERE user_id = $3))
         -- Only the children the activity invites
         AND (EXISTS (SELECT 1 FROM activities ia WHERE ia.id = $1 AND ia.invites_everyone)
              OR p.id IN (SELECT participant_id FROM activity_invitees WHERE activity_id = $1))
       GROUP BY p.id, ca_going.participant_id, ca_return.participant_id
       ORDER BY p.last_name, p.first_name`,
      [id, organizationId, onlyChildrenOf]
    );

    return success(res, result.rows);
  }));

  /**
   * Get a specific activity by ID
   * Accessible by: animation, admin, parent
   */
  router.get('/:id', authenticate, requirePermission('activities.view'), validateIdParam('id'), checkValidation, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT
        a.*,
        u.full_name as created_by_name,
        u.email as created_by_email,
        CASE WHEN a.invites_everyone THEN NULL ELSE COALESCE(
          (SELECT array_agg(ai.participant_id ORDER BY ai.participant_id)
             FROM activity_invitees ai
            WHERE ai.activity_id = a.id AND ai.organization_id = a.organization_id),
          '{}'
        ) END AS invited_participant_ids
       FROM activities a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.id = $1 AND a.organization_id = $2 AND a.is_active = TRUE`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    // The list of invited children is for those who organize the activity
    const activity = publicActivity(result.rows[0]);
    if (!mayReadInviteeList(req)) {
      delete activity.invited_participant_ids;
    }

    return success(res, activity);
  }));

  /**
   * Turn an optional text field into the value stored: trimmed, or null when blank.
   * @param {*} value
   * @returns {string|null}
   */
  const optionalText = (value) => {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
  };

  /**
   * The description an activity write sends. A formatted description
   * (`description_html`) brings its own plain text; a plain one alone clears
   * any formatted version, so the two never disagree.
   * @param {Object} body - Request body
   * @returns {{description: string|null, description_html: string|null}}
   */
  const readDescription = (body) => {
    if (Object.prototype.hasOwnProperty.call(body, 'description_html')) {
      const rich = readRichTextField(body.description_html);
      return { description: rich.text, description_html: rich.html };
    }
    return { description: optionalText(body.description), description_html: null };
  };

  /**
   * Normalize a time to HH:MM:SS so values from forms and the database compare.
   * @param {*} value
   * @returns {string|null} Normalized time, or null when absent or malformed
   */
  const normalizeTime = (value) => {
    const match = String(value ?? '').trim().match(TIME_PATTERN);
    if (!match) {
      return null;
    }
    const [, hours, minutes, seconds = '00'] = match;
    if (Number(hours) >= HOURS_PER_DAY || Number(minutes) >= MINUTES_PER_HOUR
      || Number(seconds) >= SECONDS_PER_MINUTE) {
      return null;
    }
    return `${hours}:${minutes}:${seconds}`;
  };

  /**
   * Whether a value is a real calendar date written YYYY-MM-DD.
   * @param {*} value
   * @returns {boolean}
   */
  const isValidDate = (value) => {
    const text = String(value ?? '').trim();
    if (!DATE_PATTERN.test(text)) {
      return false;
    }
    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };

  /**
   * Check an activity's schedule is coherent.
   * @param {Object} activity - Activity with normalized dates and times
   * @returns {string|null} Error message, or null when the schedule is valid
   */
  const validateSchedule = (activity) => {
    if (activity.transport_required !== false && activity.meeting_time_going >= activity.departure_time_going) {
      return 'Departure time must be after meeting time';
    }
    if (activity.meeting_time_return && activity.departure_time_return
      && activity.meeting_time_return >= activity.departure_time_return) {
      return 'Return departure time must be after return meeting time';
    }
    const start = `${activity.activity_start_date}T${activity.activity_start_time}`;
    const end = `${activity.activity_end_date}T${activity.activity_end_time}`;
    if (end < start) {
      return 'Activity must end after it starts';
    }
    if (isTooLong(activity.activity_start_date, activity.activity_end_date)) {
      return 'activity_too_long';
    }
    if (activity.authorization_text && activity.authorization_text.length > AUTHORIZATION_TEXT_MAX_LENGTH) {
      return `Authorization text must be at most ${AUTHORIZATION_TEXT_MAX_LENGTH} characters`;
    }
    return null;
  };

  /**
   * Create a new activity
   * Accessible by: animation, admin only
   */
  router.post('/', authenticate, blockDemoRoles, requirePermission('activities.create'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.user.id;

    const creationKey = req.body.creation_key;
    if (creationKey !== undefined && (typeof creationKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(creationKey))) {
      return error(res, 'invalid_request', HTTP_BAD_REQUEST);
    }
    if (['transport_required', 'authorization_required', 'is_camp'].some((field) => req.body[field] !== undefined && typeof req.body[field] !== 'boolean')) {
      return error(res, 'invalid_request', HTTP_BAD_REQUEST);
    }
    // Debug logging to diagnose form submission issues
    logger.info('[Activity Creation] Request received', {
      organizationId,
      contentType: req.headers['content-type'],
      bodyKeys: Object.keys(req.body),
      bodyPreview: {
        name: req.body.name,
        activity_name: req.body.activity_name,
        activity_start_date: req.body.activity_start_date,
        meeting_time_going: req.body.meeting_time_going,
        departure_time_going: req.body.departure_time_going
      }
    });

    // Accept both 'activity_name' (new) and 'name' (legacy) field names
    const activityName = optionalText(req.body.activity_name || req.body.name);

    const {
      authorization_text,
      activity_date,
      activity_start_date,
      activity_start_time,
      activity_end_date,
      activity_end_time,
      meeting_location_going,
      meeting_time_going,
      departure_time_going,
      meeting_location_return,
      meeting_time_return,
      departure_time_return
    } = req.body;

    const normalizedActivityDate = activity_date || activity_start_date;
    const normalizedStartDate = activity_start_date || activity_date;
    // activity_start_time can fall back to meeting_time_going if not provided
    const normalizedStartTime = activity_start_time || meeting_time_going;
    const normalizedEndDate = activity_end_date || normalizedStartDate;
    // activity_end_time can fall back to departure times if not provided
    const normalizedEndTime = activity_end_time || departure_time_return || departure_time_going;

    // Validation with specific error messages
    const missingFields = [];
    if (!activityName) {missingFields.push('name');}
    if (!normalizedStartDate) {missingFields.push('activity_start_date (or activity_date as fallback)');}
    if (!normalizedEndDate) {missingFields.push('activity_end_date');}
    if (!optionalText(meeting_location_going)) {missingFields.push('meeting_location_going');}
    // Core carpool fields are always required
    if (!meeting_time_going) {missingFields.push('meeting_time_going');}
    if (!departure_time_going) {missingFields.push('departure_time_going');}
    // Normalized times depend on the above required fields as fallbacks
    if (!normalizedStartTime) {
      missingFields.push('activity_start_time (meeting_time_going can be used as fallback)');
    }
    if (!normalizedEndTime) {
      missingFields.push('activity_end_time (departure times can be used as fallback)');
    }

    if (missingFields.length > 0) {
      return error(res, `Missing required fields: ${missingFields.join(', ')}`, 400);
    }

    const invalidFields = [
      ...['activity_date', 'activity_start_date', 'activity_end_date', 'authorization_deadline_date']
        .filter((field) => optionalText(req.body[field]) !== null && !isValidDate(req.body[field])),
      ...TIME_FIELDS
        .filter((field) => optionalText(req.body[field]) !== null && normalizeTime(req.body[field]) === null)
    ];
    if (invalidFields.length > 0) {
      return error(res, `Invalid values: ${invalidFields.join(', ')}`, 400);
    }

    const activity = {
      name: activityName,
      transport_required: req.body.transport_required !== false,
      authorization_required: req.body.authorization_required === true,
      is_camp: req.body.is_camp === true,
      authorization_deadline_date: optionalText(req.body.authorization_deadline_date),
      ...readDescription(req.body),
      authorization_text: optionalText(authorization_text),
      activity_date: normalizedActivityDate,
      activity_start_date: normalizedStartDate,
      activity_start_time: normalizeTime(normalizedStartTime),
      activity_end_date: normalizedEndDate,
      activity_end_time: normalizeTime(normalizedEndTime),
      meeting_location_going: optionalText(meeting_location_going),
      meeting_time_going: normalizeTime(meeting_time_going),
      departure_time_going: normalizeTime(departure_time_going),
      meeting_location_return: optionalText(meeting_location_return),
      meeting_time_return: normalizeTime(meeting_time_return),
      departure_time_return: normalizeTime(departure_time_return)
    };

    const scheduleError = validateSchedule(activity);
    if (scheduleError) {
      return error(res, scheduleError, 400);
    }

    const invitation = readInvitation(req.body, { isCreate: true });
    if (invitation.problem) {
      return error(res, invitation.problem, HTTP_BAD_REQUEST);
    }

    // A camp joins the year plan in the same transaction, so it takes the transactional path.
    if (invitation.invitesEveryone && !creationKey && !activity.is_camp) {
      const created = await insertActivity(pool, activity, userId, organizationId);
      return success(res, publicActivity(created), 'Activity created successfully', HTTP_CREATED);
    }

    // An activity for some participants is saved with its list, or not at all
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fingerprint = createHash('sha256').update(JSON.stringify({ activity, invitation })).digest('hex');
      if (creationKey) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`activity:${organizationId}:${creationKey}`]);
        const previous = await client.query('SELECT * FROM activities WHERE organization_id = $1 AND creation_key = $2', [organizationId, creationKey]);
        if (previous.rows.length) {
          await client.query('ROLLBACK');
          return previous.rows[0].creation_fingerprint === fingerprint
            ? success(res, publicActivity(previous.rows[0]), 'Activity already created')
            : error(res, 'authorization_creation_changed', HTTP_CONFLICT);
        }
      }
      const created = await insertActivity(client, activity, userId, organizationId);
      const saved = await saveInvitation(client, {
        activityId: created.id,
        organizationId,
        invitesEveryone: invitation.invitesEveryone,
        participantIds: invitation.participantIds
      });
      if (saved.unknownParticipantIds.length > 0) {
        await client.query('ROLLBACK');
        return error(res, 'Some invited participants are not in this unit', HTTP_BAD_REQUEST,
          [{ field: 'invited_participant_ids', value: saved.unknownParticipantIds }]);
      }
      if (activity.is_camp) {
        await planCamp(client, organizationId, created.id);
      }
      if (creationKey) {
        await client.query('UPDATE activities SET creation_key = $1, creation_fingerprint = $2 WHERE id = $3 AND organization_id = $4', [creationKey, fingerprint, created.id, organizationId]);
      }
      await client.query('COMMIT');
      return success(res, {
        ...publicActivity(created),
        invites_everyone: invitation.invitesEveryone,
        invited_participant_ids: invitation.participantIds,
        invited_count: invitation.participantIds.length
      }, 'Activity created successfully', HTTP_CREATED);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }));

  /**
   * Insert a validated activity.
   * @param {Object} db - Pool or transaction client
   * @param {Object} activity - Normalized activity fields
   * @param {string} userId - Creator's UUID
   * @param {number} organizationId
   * @returns {Promise<Object>} The created row
   */
  async function insertActivity(db, activity, userId, organizationId) {
    const result = await db.query(
      `INSERT INTO activities (
        name, description, authorization_text, activity_date, activity_start_date, activity_start_time,
        activity_end_date, activity_end_time, meeting_location_going, meeting_time_going,
        departure_time_going, meeting_location_return, meeting_time_return,
        departure_time_return, created_by, organization_id, description_html, authorization_required, authorization_deadline_date, transport_required,
        is_camp
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13,
        $14, $15, $16, $17, $18, $19, $20, $21
      ) RETURNING *`,
      [
        activity.name,
        activity.description,
        activity.authorization_text,
        activity.activity_date,
        activity.activity_start_date,
        activity.activity_start_time,
        activity.activity_end_date,
        activity.activity_end_time,
        activity.meeting_location_going,
        activity.meeting_time_going,
        activity.departure_time_going,
        activity.meeting_location_return,
        activity.meeting_time_return,
        activity.departure_time_return,
        userId,
        organizationId,
        activity.description_html,
        activity.authorization_required,
        activity.authorization_deadline_date,
        activity.transport_required,
        activity.is_camp === true
      ]
    );
    return result.rows[0];
  }

  /**
   * Update an activity.
   *
   * Only the fields present in the body change; an optional field sent empty is
   * cleared. The resulting activity is validated as a whole, and the wording of
   * permission slips still awaiting an answer follows the activity. Answered
   * slips keep the text that was signed.
   *
   * `invites_everyone` and `invited_participant_ids` change who is invited;
   * children no longer invited leave its cars and their unanswered slips are
   * archived (see services/activityInvitations.js).
   *
   * Accessible by: animation, admin only
   */
  router.put('/:id', authenticate, blockDemoRoles, requirePermission('activities.edit'), validateIdParam('id'), checkValidation, asyncHandler(async (req, res) => {
    const activityId = Number(req.params.id);
    const organizationId = await getOrganizationId(req, pool);
    const body = req.body || {};
    const has = (field) => Object.prototype.hasOwnProperty.call(body, field);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query(
        `SELECT name, description, description_html, authorization_text, authorization_required, is_camp, authorization_deadline_date::text AS authorization_deadline_date, transport_required, is_active, invites_everyone,
                activity_date::text AS activity_date,
                activity_start_date::text AS activity_start_date,
                activity_start_time::text AS activity_start_time,
                activity_end_date::text AS activity_end_date,
                activity_end_time::text AS activity_end_time,
                meeting_location_going,
                meeting_time_going::text AS meeting_time_going,
                departure_time_going::text AS departure_time_going,
                meeting_location_return,
                meeting_time_return::text AS meeting_time_return,
                departure_time_return::text AS departure_time_return
           FROM activities
          WHERE id = $1 AND organization_id = $2
          FOR UPDATE`,
        [activityId, organizationId]
      );

      if (existingResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return error(res, 'Activity not found', 404);
      }

      const existing = existingResult.rows[0];
      const activity = {
        ...existing,
        activity_start_time: normalizeTime(existing.activity_start_time),
        activity_end_time: normalizeTime(existing.activity_end_time),
        meeting_time_going: normalizeTime(existing.meeting_time_going),
        departure_time_going: normalizeTime(existing.departure_time_going),
        meeting_time_return: normalizeTime(existing.meeting_time_return),
        departure_time_return: normalizeTime(existing.departure_time_return)
      };
      if (has('transport_required')) {
        if (typeof body.transport_required !== 'boolean') {
          await client.query('ROLLBACK');
          return error(res, 'invalid_request', HTTP_BAD_REQUEST);
        }
        activity.transport_required = body.transport_required;
      }
      if (has('authorization_required')) {
        if (typeof body.authorization_required !== 'boolean') {
          await client.query('ROLLBACK');
          return error(res, 'invalid_request', HTTP_BAD_REQUEST);
        }
        activity.authorization_required = body.authorization_required;
      }
      if (has('is_camp')) {
        if (typeof body.is_camp !== 'boolean') {
          await client.query('ROLLBACK');
          return error(res, 'invalid_request', HTTP_BAD_REQUEST);
        }
        activity.is_camp = body.is_camp;
      }
      if (has('authorization_deadline_date')) {
        if (body.authorization_deadline_date && !isValidDate(body.authorization_deadline_date)) {
          await client.query('ROLLBACK');
          return error(res, 'invalid_request', HTTP_BAD_REQUEST);
        }
        activity.authorization_deadline_date = optionalText(body.authorization_deadline_date);
      }
      const invalidFields = [];

      if (has('activity_name') || has('name')) {
        activity.name = optionalText(has('activity_name') ? body.activity_name : body.name);
      }
      OPTIONAL_TEXT_FIELDS.filter(has).forEach((field) => {
        activity[field] = optionalText(body[field]);
      });
      if (has('description') || has('description_html')) {
        Object.assign(activity, readDescription(body));
      }
      REQUIRED_TEXT_FIELDS.filter(has).forEach((field) => {
        activity[field] = optionalText(body[field]);
      });
      DATE_FIELDS.filter(has).forEach((field) => {
        const value = optionalText(body[field]);
        if (value !== null && !isValidDate(value)) {
          invalidFields.push(field);
        }
        activity[field] = value;
      });
      TIME_FIELDS.filter(has).forEach((field) => {
        const value = normalizeTime(body[field]);
        if (value === null && optionalText(body[field]) !== null) {
          invalidFields.push(field);
        }
        activity[field] = value;
      });
      // activity_date is the legacy copy of the start date
      if (has('activity_start_date') && !has('activity_date')) {
        activity.activity_date = activity.activity_start_date;
      }
      if (has('is_active')) {
        activity.is_active = toBool(body.is_active);
      }

      const missingFields = REQUIRED_FIELDS.filter((field) => !activity[field]);
      if (invalidFields.length > 0 || missingFields.length > 0) {
        await client.query('ROLLBACK');
        const problems = [
          ...(missingFields.length > 0 ? [`Missing required fields: ${missingFields.join(', ')}`] : []),
          ...(invalidFields.length > 0 ? [`Invalid values: ${invalidFields.join(', ')}`] : [])
        ];
        return error(res, problems.join('; '), 400);
      }

      const scheduleError = validateSchedule(activity);
      if (scheduleError) {
        await client.query('ROLLBACK');
        return error(res, scheduleError, 400);
      }

      const invitation = readInvitation(body);
      if (invitation.problem) {
        await client.query('ROLLBACK');
        return error(res, invitation.problem, HTTP_BAD_REQUEST);
      }

      const result = await client.query(
        `UPDATE activities
            SET name = $1,
                description = $2,
                authorization_text = $3,
                activity_date = $4,
                activity_start_date = $5,
                activity_start_time = $6,
                activity_end_date = $7,
                activity_end_time = $8,
                meeting_location_going = $9,
                meeting_time_going = $10,
                departure_time_going = $11,
                meeting_location_return = $12,
                meeting_time_return = $13,
                departure_time_return = $14,
                is_active = $15,
                description_html = $18,
                authorization_required = $19,
                authorization_deadline_date = $20,
                transport_required = $21,
                is_camp = $22,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $16 AND organization_id = $17
          RETURNING *`,
        [
          activity.name,
          activity.description,
          activity.authorization_text,
          activity.activity_date,
          activity.activity_start_date,
          activity.activity_start_time,
          activity.activity_end_date,
          activity.activity_end_time,
          activity.meeting_location_going,
          activity.meeting_time_going,
          activity.departure_time_going,
          activity.meeting_location_return,
          activity.meeting_time_return,
          activity.departure_time_return,
          activity.is_active,
          activityId,
          organizationId,
          activity.description_html,
          activity.authorization_required ?? false,
          activity.authorization_deadline_date || null,
          activity.transport_required ?? true,
          activity.is_camp === true
        ]
      );

      // A slip's date is part of its uniqueness key: move it only when the
      // participant has no other slip on the new date.
      const slipResult = await client.query(
        `UPDATE permission_slips ps
            SET activity_title = $1,
                activity_description = $2,
                authorization_text = $3,
                activity_description_html = $7,
                deadline_date = CASE WHEN $8::boolean THEN $9::date ELSE ps.deadline_date END,
                meeting_date = CASE
                  WHEN NOT EXISTS (
                    SELECT 1 FROM permission_slips other
                     WHERE other.organization_id = ps.organization_id
                       AND other.participant_id = ps.participant_id
                       AND other.meeting_date = $4::date
                       AND other.id <> ps.id
                  ) THEN $4::date
                  ELSE ps.meeting_date
                END,
                updated_at = CURRENT_TIMESTAMP
          WHERE ps.activity_id = $5 AND ps.organization_id = $6 AND ps.status = 'pending'`,
        [
          activity.name,
          activity.description,
          activity.authorization_text,
          activity.activity_date,
          activityId,
          organizationId,
          activity.description_html,
          has('authorization_deadline_date') && (existing.authorization_deadline_date || null) !== (activity.authorization_deadline_date || null),
          activity.authorization_deadline_date || null
        ]
      );

      // A camp planned in the year plan keeps one set of dates: its planned date follows.
      try {
        await alignPlannedDate(client, organizationId, activityId, activity.activity_start_date, activity.activity_end_date);
        if (activity.is_camp && activity.is_active !== false) {
          await planCamp(client, organizationId, activityId);
        } else if (existing.is_camp) {
          await unplanCamp(client, organizationId, activityId);
        }
      } catch (dateError) {
        if (!(dateError instanceof CampDateError)) { throw dateError; }
        await client.query('ROLLBACK');
        return error(res, dateError.code, dateError.status);
      }

      let invitationChanges = { removedCarpoolAssignments: 0, archivedPermissionSlips: 0 };
      if (invitation.provided) {
        const saved = await saveInvitation(client, {
          activityId,
          organizationId,
          invitesEveryone: invitation.invitesEveryone,
          participantIds: invitation.participantIds
        });
        if (saved.unknownParticipantIds.length > 0) {
          await client.query('ROLLBACK');
          return error(res, 'Some invited participants are not in this unit', HTTP_BAD_REQUEST,
            [{ field: 'invited_participant_ids', value: saved.unknownParticipantIds }]);
        }
        invitationChanges = saved;
      }

      await client.query('COMMIT');

      // Explicit opt-in: only the edit forms ask for it, never other API callers
      if (toBool(body.notify_participants) === 't') {
        try {
          // Opening an activity for some participants to the whole unit makes
          // every family newly concerned
          const openedToEveryone = invitation.provided && invitation.invitesEveryone
            && existing.invites_everyone === false;
          await sendActivityUpdateNotifications(pool, activityId, organizationId, { wholeUnit: openedToEveryone });
        } catch (notifyError) {
          logger.error('[Activity Update] Failed to send update notifications', {
            activityId,
            organizationId,
            error: notifyError.message
          });
        }
      }

      const invitationResponse = invitation.provided
        ? {
          invites_everyone: invitation.invitesEveryone,
          invited_participant_ids: invitation.invitesEveryone ? null : invitation.participantIds,
          invited_count: invitation.participantIds.length,
          uninvited_carpool_assignments_removed: invitationChanges.removedCarpoolAssignments,
          uninvited_permission_slips_archived: invitationChanges.archivedPermissionSlips
        }
        : {};

      return success(res, {
        ...result.rows[0],
        ...invitationResponse,
        pending_permission_slips_updated: slipResult.rowCount || 0
      }, 'Activity updated successfully');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }));

  /**
   * Delete an activity (soft delete).
   * Its carpool offers are cancelled and its unanswered permission slips are
   * archived, so guardians can no longer sign for an activity that is gone.
   * With `?notify_participants=true`, everyone it concerns and the unit's
   * leaders are emailed that it is cancelled.
   * Accessible by: animation, admin only
   */
  router.delete('/:id', authenticate, blockDemoRoles, requirePermission('activities.delete'), validateIdParam('id'), checkValidation, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    // First verify activity exists and belongs to organization
    const activityCheck = await pool.query(
      'SELECT id FROM activities WHERE id = $1 AND organization_id = $2 AND is_active = TRUE',
      [id, organizationId]
    );

    if (activityCheck.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    // Explicit opt-in, as for updates: deleting also removes mistakes. The
    // recipients are read now, while the carpool offers still name the drivers.
    let cancellationNotice = null;
    if (toBool(req.query.notify_participants) === 't') {
      try {
        cancellationNotice = await findActivityCancellationRecipients(pool, Number(id), organizationId);
      } catch (notifyError) {
        logger.error('[Activity Delete] Failed to list cancellation recipients', {
          activityId: id,
          organizationId,
          error: notifyError.message
        });
      }
    }

    // Cancel all active carpool offers for this activity
    await pool.query(
      'UPDATE carpool_offers SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE activity_id = $1 AND is_active = TRUE',
      [id]
    );

    await pool.query(
      `UPDATE permission_slips
          SET status = 'archived', updated_at = CURRENT_TIMESTAMP
        WHERE activity_id = $1 AND organization_id = $2 AND status = 'pending'`,
      [id, organizationId]
    );

    // Soft delete activity
    const result = await pool.query(
      `UPDATE activities
       SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [id, organizationId]
    );

    if (cancellationNotice) {
      try {
        await sendActivityCancellationNotifications(pool, organizationId, cancellationNotice);
      } catch (notifyError) {
        logger.error('[Activity Delete] Failed to send cancellation notifications', {
          activityId: id,
          organizationId,
          error: notifyError.message
        });
      }
    }

    return success(res, result.rows[0], 'Activity deleted successfully');
  }));

  return router;
};
