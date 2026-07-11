/**
 * Meetings Routes
 *
 * Meeting preparation, dates, guests, reminders, and meeting activities.
 * Backed by the unified calendar in year_plan_meetings (shared with the yearly
 * planner) and structured activity rows in year_plan_meeting_activities.
 * All endpoints are mounted at /api/v1/meetings and use the standard
 * success()/error() response envelope.
 *
 * @module routes/meetings
 */

const express = require('express');
const { check } = require('express-validator');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateDate, validateDateOptional, checkValidation } = require('../middleware/validation');
const { getMeetingSectionConfig } = require('../utils/meeting-sections');
const { getMeetingDefaults, computeEndTime, formatLocalDate } = require('../utils/meeting-defaults');

const MINUTES_PER_HOUR = 60;
const UNPROCESSED_MEETINGS_LIMIT = 10;

/**
 * Trim a Postgres TIME value ("HH:MM:SS") to "HH:MM".
 * @param {string|null} value - Time value
 * @returns {string|null}
 */
function toShortTime(value) {
  if (!value) {
    return null;
  }
  return String(value).substring(0, 5);
}

/**
 * Convert minutes to a "HH:MM" duration string (legacy timeline format).
 * @param {number|null} minutes - Duration in minutes
 * @returns {string|null}
 */
function minutesToDuration(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) {
    return null;
  }
  const total = Number(minutes);
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const mins = total % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Convert a legacy "HH:MM" duration (or plain minutes) to minutes.
 * @param {string|number|null} duration - Duration value
 * @returns {number|null}
 */
function durationToMinutes(duration) {
  if (duration === null || duration === undefined || duration === '') {
    return null;
  }
  if (typeof duration === 'number') {
    return duration;
  }
  const text = String(duration);
  if (/^\d+$/.test(text)) {
    return parseInt(text, 10);
  }
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  return parseInt(match[1], 10) * MINUTES_PER_HOUR + parseInt(match[2], 10);
}

/**
 * Reconstruct a legacy prep-timeline activity object from a structured
 * year_plan_meeting_activities row. Extra fields the timeline UI relies on
 * (activityKey, typeKey, star_type, participant_ids, ...) are preserved in
 * metadata.legacy and merged back, with structured columns taking precedence.
 * @param {Object} row - year_plan_meeting_activities row
 * @returns {Object} Timeline activity
 */
function toTimelineActivity(row) {
  const legacy = (row.metadata && row.metadata.legacy) || {};
  return {
    ...legacy,
    id: row.id,
    position: row.sort_order,
    time: toShortTime(row.start_time) || legacy.time || '',
    duration: minutesToDuration(row.duration_minutes) || legacy.duration || '00:00',
    activity: row.name,
    type: row.activity_type || legacy.type || '',
    description: row.description || legacy.description || '',
    responsable: row.responsable || '',
    materiel: row.material || '',
    isDefault: row.is_default === true,
    badge_template_id: row.badge_template_id || null,
    processed: row.processed === true,
    objective_ids: row.objective_ids || [],
    activity_library_id: row.activity_library_id || null
  };
}

/**
 * Serialize a merged meeting row (+ its activity rows) for the API.
 * Exposes both the calendar fields and the preparation-page aliases
 * (date, endroit) so a meeting is one coherent object everywhere.
 * @param {Object} row - year_plan_meetings row
 * @param {Array} activityRows - year_plan_meeting_activities rows
 * @returns {Object} API meeting object
 */
function serializeMeeting(row, activityRows = []) {
  return {
    id: row.id,
    date: row.meeting_date,
    meeting_date: row.meeting_date,
    year_plan_id: row.year_plan_id || null,
    period_id: row.period_id || null,
    period_title: row.period_title || null,
    plan_title: row.plan_title || null,
    theme: row.theme || null,
    location: row.location || '',
    endroit: row.location || '',
    notes: row.notes || '',
    is_cancelled: row.is_cancelled === true,
    start_time: toShortTime(row.start_time),
    end_time: toShortTime(row.end_time),
    duration_minutes: row.duration_minutes || null,
    duration_override: row.duration_override || null,
    youth_of_honor: Array.isArray(row.youth_of_honor) ? row.youth_of_honor : [],
    animateur_responsable: row.animateur_responsable || '',
    activity_id: row.activity_id || null,
    metadata: row.metadata || {},
    activities: activityRows.map(toTimelineActivity)
  };
}

module.exports = (pool, logger) => {
  const router = express.Router();

  // Note: the duplicated meeting_date::text alias intentionally overrides the
  // DATE value from m.* so dates serialize as plain YYYY-MM-DD strings.
  const MEETING_SELECT = `
    SELECT m.*, m.meeting_date::text AS meeting_date,
           p.title AS period_title, yp.title AS plan_title
    FROM year_plan_meetings m
    LEFT JOIN year_plan_periods p ON m.period_id = p.id
    LEFT JOIN year_plans yp ON m.year_plan_id = yp.id AND yp.is_active = TRUE`;

  /**
   * Load a meeting row and its activities by organization + date.
   * @param {number} organizationId - Organization identifier
   * @param {string} date - Meeting date (YYYY-MM-DD)
   * @returns {Promise<Object|null>} Serialized meeting or null
   */
  async function loadMeetingByDate(organizationId, date) {
    const meetingResult = await pool.query(
      `${MEETING_SELECT}
       WHERE m.organization_id = $1 AND m.meeting_date = $2`,
      [organizationId, date]
    );
    if (meetingResult.rows.length === 0) {
      return null;
    }
    const meeting = meetingResult.rows[0];
    const activitiesResult = await pool.query(
      `SELECT * FROM year_plan_meeting_activities
       WHERE meeting_id = $1 AND organization_id = $2
       ORDER BY sort_order, id`,
      [meeting.id, organizationId]
    );
    return serializeMeeting(meeting, activitiesResult.rows);
  }

  // ===========================================================================
  // PREPARATION
  // ===========================================================================

  /**
   * GET /v1/meetings/preparation?date=YYYY-MM-DD
   * Meeting (calendar + preparation) for a date. Defaults to today.
   * Read remains authenticate-only: parents consume it through the upcoming
   * meeting view and dashboard widgets.
   */
  router.get('/preparation',
    authenticate,
    validateDateOptional('date'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const date = req.query.date || formatLocalDate(new Date());

      const [meeting, meetingSections] = await Promise.all([
        loadMeetingByDate(organizationId, date),
        getMeetingSectionConfig(pool, organizationId, logger)
      ]);

      return success(res, { meeting, meetingSections });
    })
  );

  /**
   * POST /v1/meetings/preparation
   * Upsert the meeting for a date (calendar row + preparation timeline).
   * Creates a standalone meeting when the date is not part of a year plan.
   */
  router.post('/preparation',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    validateDate('date'),
    check('endroit').optional().trim().isLength({ max: 500 }).withMessage('endroit must not exceed 500 characters'),
    check('notes').optional().trim().isLength({ max: 5000 }).withMessage('notes must not exceed 5000 characters'),
    check('duration_override').optional({ nullable: true }).isInt({ min: 15 }).withMessage('duration_override must be at least 15 minutes'),
    check('youth_of_honor').optional({ nullable: true }).custom(value =>
      Array.isArray(value) || typeof value === 'string'
    ).withMessage('youth_of_honor must be an array or string'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { date, youth_of_honor, endroit, notes, animateur_responsable, duration_override, theme } = req.body;

      // Honor requirement comes from the organization's meeting section config
      const meetingSections = await getMeetingSectionConfig(pool, organizationId, logger);
      const defaults = await getMeetingDefaults(pool, organizationId);
      let sectionKey = meetingSections.defaultSection;
      const orgSectionResult = await pool.query(
        `SELECT setting_value FROM organization_settings
         WHERE organization_id = $1 AND setting_key = 'organization_info'`,
        [organizationId]
      );
      if (orgSectionResult.rows[0]?.setting_value) {
        const rawInfo = orgSectionResult.rows[0].setting_value;
        const orgInfo = typeof rawInfo === 'string' ? JSON.parse(rawInfo) : rawInfo;
        if (orgInfo?.meeting_section && meetingSections.sections?.[orgInfo.meeting_section]) {
          sectionKey = orgInfo.meeting_section;
        }
      }
      const honorConfig = meetingSections.sections?.[sectionKey]?.honorField || {};
      const honorValues = Array.isArray(youth_of_honor)
        ? youth_of_honor
        : typeof youth_of_honor === 'string' && youth_of_honor.trim()
          ? [youth_of_honor.trim()]
          : [];

      if (honorConfig.required && honorValues.length === 0) {
        return error(res, 'meeting_section_honor_required', 400);
      }

      // Timeline may arrive as an array or a JSON string (legacy clients)
      let timeline = req.body.activities;
      if (typeof timeline === 'string') {
        try {
          timeline = JSON.parse(timeline);
        } catch (err) {
          return error(res, 'activities must be a JSON array', 400);
        }
      }
      if (!Array.isArray(timeline)) {
        timeline = [];
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const upsertResult = await client.query(
          `INSERT INTO year_plan_meetings
             (organization_id, meeting_date, location, notes, theme, youth_of_honor,
              animateur_responsable, duration_override, start_time, duration_minutes, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{"standalone": true}'::jsonb)
           ON CONFLICT (organization_id, meeting_date)
           DO UPDATE SET
             location = EXCLUDED.location,
             notes = EXCLUDED.notes,
             theme = COALESCE(EXCLUDED.theme, year_plan_meetings.theme),
             youth_of_honor = EXCLUDED.youth_of_honor,
             animateur_responsable = EXCLUDED.animateur_responsable,
             duration_override = EXCLUDED.duration_override,
             updated_at = NOW()
           RETURNING *`,
          [
            organizationId, date, endroit || defaults.location, notes || null,
            theme || null, JSON.stringify(honorValues),
            animateur_responsable || null, duration_override || null,
            defaults.meetingTime, defaults.durationMinutes
          ]
        );
        const meeting = upsertResult.rows[0];

        // Replace the preparation timeline with the submitted one
        await client.query(
          'DELETE FROM year_plan_meeting_activities WHERE meeting_id = $1 AND organization_id = $2',
          [meeting.id, organizationId]
        );

        for (let index = 0; index < timeline.length; index++) {
          const act = timeline[index] || {};
          // eslint-disable-next-line no-await-in-loop -- ordered inserts inside one transaction
          await client.query(
            `INSERT INTO year_plan_meeting_activities
               (organization_id, meeting_id, name, description, start_time, duration_minutes,
                activity_type, responsable, material, is_default, badge_template_id, processed,
                sort_order, objective_ids, activity_library_id, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              organizationId, meeting.id,
              act.activity || act.name || 'Activity',
              act.description || null,
              /^\d{1,2}:\d{2}/.test(String(act.time || '')) ? act.time : null,
              durationToMinutes(act.duration),
              act.type || null,
              act.responsable || null,
              act.materiel || act.material || null,
              act.isDefault === true,
              parseInt(act.badge_template_id, 10) || null,
              act.processed === true,
              index,
              JSON.stringify(act.objective_ids || []),
              parseInt(act.activity_library_id, 10) || null,
              JSON.stringify({ legacy: act })
            ]
          );
        }

        await client.query('COMMIT');

        const saved = await loadMeetingByDate(organizationId, date);
        return success(res, saved, 'Meeting preparation saved');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  // ===========================================================================
  // DATES & NEXT MEETING
  // ===========================================================================

  /**
   * GET /v1/meetings/dates
   * All calendar dates (planned and prepared), newest first, with a summary of
   * each meeting's state so pickers can flag cancellations and prepared dates.
   */
  router.get('/dates',
    authenticate,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT m.meeting_date::text AS date, m.is_cancelled, m.theme,
                (m.animateur_responsable IS NOT NULL OR EXISTS (
                  SELECT 1 FROM year_plan_meeting_activities a WHERE a.meeting_id = m.id
                )) AS is_prepared
         FROM year_plan_meetings m
         WHERE m.organization_id = $1
         ORDER BY m.meeting_date DESC`,
        [organizationId]
      );

      return success(res, result.rows);
    })
  );

  /**
   * GET /v1/meetings/next
   * The next non-cancelled meeting on or after today, with its timeline.
   */
  router.get('/next',
    authenticate,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const today = formatLocalDate(new Date());

      const result = await pool.query(
        `${MEETING_SELECT}
         WHERE m.organization_id = $1 AND m.meeting_date >= $2 AND NOT m.is_cancelled
         ORDER BY m.meeting_date ASC
         LIMIT 1`,
        [organizationId, today]
      );

      if (result.rows.length === 0) {
        return success(res, null, 'No upcoming meetings found');
      }

      const meeting = await loadMeetingByDate(organizationId, result.rows[0].meeting_date);
      return success(res, meeting);
    })
  );

  // ===========================================================================
  // GUESTS
  // ===========================================================================

  /**
   * GET /v1/meetings/guests?date=YYYY-MM-DD
   */
  router.get('/guests',
    authenticate,
    requirePermission('meetings.view'),
    validateDateOptional('date'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const date = req.query.date || formatLocalDate(new Date());

      const result = await pool.query(
        `SELECT id, name, email, attendance_date::text AS attendance_date
         FROM guests
         WHERE attendance_date = $1 AND organization_id = $2
         ORDER BY name`,
        [date, organizationId]
      );

      return success(res, result.rows);
    })
  );

  /**
   * POST /v1/meetings/guests
   */
  router.post('/guests',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    check('name').trim().notEmpty().isLength({ max: 255 }),
    check('email').optional({ nullable: true, checkFalsy: true }).trim().isEmail().isLength({ max: 255 }),
    validateDate('attendance_date'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { name, email, attendance_date } = req.body;

      const result = await pool.query(
        `INSERT INTO guests (name, email, attendance_date, organization_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, attendance_date::text AS attendance_date`,
        [name, email || null, attendance_date, organizationId]
      );

      return success(res, result.rows[0], 'Guest saved', 201);
    })
  );

  // ===========================================================================
  // REMINDERS (organization-level, stored in year_plan_reminders)
  // ===========================================================================

  /**
   * GET /v1/meetings/reminders
   * Latest organization-level reminder.
   */
  router.get('/reminders',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT id, reminder_date::text AS reminder_date, is_recurring,
                custom_message AS reminder_text, created_at
         FROM year_plan_reminders
         WHERE organization_id = $1 AND meeting_id IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [organizationId]
      );

      return success(res, result.rows[0] || null);
    })
  );

  /**
   * POST /v1/meetings/reminders
   * Create or update the organization-level reminder.
   */
  router.post('/reminders',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    validateDate('reminder_date'),
    check('reminder_text').trim().notEmpty().isLength({ max: 5000 }),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { reminder_date, is_recurring, reminder_text } = req.body;

      const updateResult = await pool.query(
        `UPDATE year_plan_reminders
         SET reminder_date = $2,
             scheduled_at = $2::timestamptz,
             is_recurring = $3,
             custom_message = $4
         WHERE id = (
           SELECT id FROM year_plan_reminders
           WHERE organization_id = $1 AND meeting_id IS NULL
           ORDER BY created_at DESC
           LIMIT 1
         )
         RETURNING id`,
        [organizationId, reminder_date, is_recurring === true, reminder_text]
      );

      if (updateResult.rowCount === 0) {
        await pool.query(
          `INSERT INTO year_plan_reminders
             (organization_id, channel, scheduled_at, custom_message, is_recurring, reminder_date, status)
           VALUES ($1, 'email', $2::timestamptz, $3, $4, $2, 'pending')`,
          [organizationId, reminder_date, reminder_text, is_recurring === true]
        );
      }

      return success(res, null, 'Reminder saved');
    })
  );

  // ===========================================================================
  // MEETING ACTIVITY CATALOG (shared activity_library)
  // ===========================================================================

  /**
   * GET /v1/meetings/activities
   * Activity catalog for the prep timeline (legacy field aliases preserved).
   */
  router.get('/activities',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT id, name AS activity, category AS type,
                estimated_duration_min AS estimated_time_min,
                estimated_duration_max AS estimated_time_max,
                material, description
         FROM activity_library
         WHERE organization_id = $1 AND is_active = TRUE
         ORDER BY name`,
        [organizationId]
      );

      return success(res, result.rows);
    })
  );

  /**
   * GET /v1/meetings/activities/templates
   * Same catalog grouped for template pickers.
   */
  router.get('/activities/templates',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT id, name AS activity, category AS type,
                estimated_duration_min AS estimated_time_min,
                estimated_duration_max AS estimated_time_max,
                material, description
         FROM activity_library
         WHERE organization_id = $1 AND is_active = TRUE
         ORDER BY category, name`,
        [organizationId]
      );

      return success(res, result.rows);
    })
  );

  // ===========================================================================
  // ACHIEVEMENTS (badge-linked timeline activities)
  // ===========================================================================

  /**
   * GET /v1/meetings/achievements/unprocessed
   * Past meetings that still have badge-linked activities awaiting processing.
   */
  router.get('/achievements/unprocessed',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT m.id, m.meeting_date::text AS date,
                json_agg(json_build_object(
                  'id', a.id,
                  'activity', a.name,
                  'badge_template_id', a.badge_template_id,
                  'star_type', a.metadata->'legacy'->>'star_type',
                  'participant_ids', COALESCE(a.metadata->'legacy'->'participant_ids', '[]'::jsonb),
                  'processed', a.processed
                ) ORDER BY a.sort_order) AS activities
         FROM year_plan_meetings m
         JOIN year_plan_meeting_activities a ON a.meeting_id = m.id
         WHERE m.organization_id = $1
           AND m.meeting_date < CURRENT_DATE
           AND a.badge_template_id IS NOT NULL
           AND a.processed = FALSE
         GROUP BY m.id, m.meeting_date
         ORDER BY m.meeting_date DESC
         LIMIT $2`,
        [organizationId, UNPROCESSED_MEETINGS_LIMIT]
      );

      return success(res, result.rows);
    })
  );

  /**
   * POST /v1/meetings/activities/mark-processed
   * Mark badge-linked timeline activities as processed after awards are saved.
   */
  router.post('/activities/mark-processed',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    check('activity_ids').isArray({ min: 1 }).withMessage('activity_ids must be a non-empty array'),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const activityIds = req.body.activity_ids
        .map(id => parseInt(id, 10))
        .filter(Number.isInteger);

      if (activityIds.length === 0) {
        return error(res, 'activity_ids must contain integers', 400);
      }

      const result = await pool.query(
        `UPDATE year_plan_meeting_activities
         SET processed = TRUE, updated_at = NOW()
         WHERE id = ANY($1::int[]) AND organization_id = $2
         RETURNING id`,
        [activityIds, organizationId]
      );

      return success(res, { updated: result.rows.map(r => r.id) }, `${result.rowCount} activities marked processed`);
    })
  );

  return router;
};
