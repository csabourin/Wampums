/**
 * Yearly Meeting Planner Routes
 *
 * Handles year plans, periods, objectives, activity library,
 * meeting generation, distribution rules, and reminders.
 * All endpoints use /api/v1/yearly-planner prefix.
 *
 * @module routes/yearlyPlanner
 */
const express = require('express');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, paginated, asyncHandler } = require('../middleware/response');
const { check } = require('express-validator');
const { checkValidation } = require('../middleware/validation');
const { getMeetingDefaults, computeEndTime, formatLocalDate } = require('../utils/meeting-defaults');

/**
 * Kinds of dated block on the planner calendar.
 * regular = weekly meeting night, weekend = single out-of-schedule outing,
 * camp = multi-day block (the span lives on the linked activities row),
 * special = a one-off that is neither.
 */
const MEETING_KINDS = ['regular', 'weekend', 'camp', 'special'];

/** Kinds that get a linked activities row (consent + carpooling) by default. */
const ACTIVITY_EVENT_KINDS = ['weekend', 'camp'];

/**
 * Columns PATCH /meetings/:id may write. Used to build the SET clause, so a
 * request can never name a column of its own.
 */
const PATCHABLE_MEETING_FIELDS = [
  'start_time', 'end_time', 'duration_minutes', 'location',
  'theme', 'notes', 'is_cancelled', 'period_id', 'meeting_kind', 'metadata'
];

/**
 * Resolve the activities-row fields implied by a planned meeting.
 *
 * @param {Object} meeting - year_plan_meetings row (meeting_date as text)
 * @param {Object} body - Request overrides
 * @param {Object} defaults - getMeetingDefaults() result for the organization
 * @returns {{name: string, description: ?string, startDate: string, endDate: string,
 *   startTime: string, endTime: string, departureTime: string, location: string}}
 * @throws {Error} When the name is missing or the times are inconsistent
 */
function buildActivityEventPlan(meeting, body = {}, defaults = {}) {
  const name = (body.name || meeting.theme || '').trim();
  if (!name) {
    throw new Error('name is required (or set a theme on the meeting)');
  }

  const startTimeRaw = body.meeting_time || (meeting.start_time
    ? String(meeting.start_time).substring(0, 5)
    : defaults.meetingTime);
  const startTime = computeEndTime(startTimeRaw, 0);
  const departureTimeRaw = body.departure_time
    || computeEndTime(startTime, meeting.duration_minutes || defaults.durationMinutes);
  const departureTime = computeEndTime(departureTimeRaw, 0);

  if (startTime >= departureTime) {
    throw new Error('Departure time must be after meeting time');
  }

  const endDate = body.end_date || meeting.meeting_date;
  if (endDate < meeting.meeting_date) {
    throw new Error('end_date must be on or after the meeting date');
  }

  return {
    name,
    description: body.description || meeting.notes || null,
    startDate: meeting.meeting_date,
    endDate,
    startTime,
    endTime: body.end_time || departureTime,
    departureTime,
    location: body.location || meeting.location || defaults.location || ''
  };
}

/**
 * Insert the activities row for a meeting and link it back, inside a caller's
 * transaction. This is what unlocks carpools, permission slips and the iCal feed.
 *
 * @param {Object} client - Connected pg client already inside a transaction
 * @param {Object} params - { organizationId, userId, meetingId, plan }
 * @returns {Promise<Object>} The inserted activities row
 */
async function insertActivityEventForMeeting(client, { organizationId, userId, meetingId, plan }) {
  // meeting_time_return and departure_time_return are `time` columns: they take
  // NULL when there is no return leg. Passing '' raised
  // `invalid input syntax for type time` and made this path fail outright.
  const activityResult = await client.query(
    `INSERT INTO activities (
       name, description, activity_date, activity_start_date, activity_start_time,
       activity_end_date, activity_end_time, meeting_location_going, meeting_time_going,
       departure_time_going, meeting_location_return, meeting_time_return,
       departure_time_return, created_by, organization_id
     ) VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $4, $8, '', NULL, NULL, $9, $10)
     RETURNING *`,
    [
      plan.name,
      plan.description,
      plan.startDate,
      plan.startTime,
      plan.endDate,
      plan.endTime,
      plan.location,
      plan.departureTime,
      userId,
      organizationId
    ]
  );

  await client.query(
    'UPDATE year_plan_meetings SET activity_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3',
    [activityResult.rows[0].id, meetingId, organizationId]
  );

  return activityResult.rows[0];
}

module.exports = (pool, logger) => {
  const router = express.Router();

  // =========================================================================
  // YEAR PLANS
  // =========================================================================

  /**
   * GET /v1/yearly-planner/plans
   * List all year plans for the organization
   */
  router.get('/plans',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const result = await pool.query(
        `SELECT yp.*, u.full_name as created_by_name,
                (SELECT COUNT(*) FROM year_plan_meetings WHERE year_plan_id = yp.id AND NOT is_cancelled) as meeting_count,
                (SELECT COUNT(*) FROM year_plan_periods WHERE year_plan_id = yp.id) as period_count
         FROM year_plans yp
         LEFT JOIN users u ON yp.created_by = u.id
         WHERE yp.organization_id = $1 AND yp.is_active = TRUE
         ORDER BY yp.start_date DESC`,
        [organizationId]
      );

      return success(res, result.rows);
    })
  );

  /**
   * GET /v1/yearly-planner/plans/:id
   * Get a single year plan with periods, objectives, and meetings
   */
  router.get('/plans/:id',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.id);

      const [planResult, periodsResult, objectivesResult, meetingsResult] = await Promise.all([
        pool.query(
          `SELECT yp.*, u.full_name as created_by_name
           FROM year_plans yp
           LEFT JOIN users u ON yp.created_by = u.id
           WHERE yp.id = $1 AND yp.organization_id = $2 AND yp.is_active = TRUE`,
          [planId, organizationId]
        ),
        pool.query(
          `SELECT * FROM year_plan_periods
           WHERE year_plan_id = $1 AND organization_id = $2
           ORDER BY sort_order, start_date`,
          [planId, organizationId]
        ),
        pool.query(
          `SELECT o.*, p.title as period_title,
                  parent.title as parent_title
           FROM year_plan_objectives o
           LEFT JOIN year_plan_periods p ON o.period_id = p.id
           LEFT JOIN year_plan_objectives parent ON o.parent_id = parent.id
           WHERE o.year_plan_id = $1 AND o.organization_id = $2
           ORDER BY o.period_id, o.sort_order`,
          [planId, organizationId]
        ),
        pool.query(
          `SELECT m.*, m.meeting_date::text as meeting_date,
                  p.title as period_title,
                  (SELECT COUNT(*) FROM year_plan_meeting_activities WHERE meeting_id = m.id) as activity_count,
                  (m.animateur_responsable IS NOT NULL OR EXISTS (
                    SELECT 1 FROM year_plan_meeting_activities a WHERE a.meeting_id = m.id
                  )) as is_prepared,
                  COALESCE(
                    (SELECT ARRAY_AGG(DISTINCT a.series_id)
                       FROM year_plan_meeting_activities a
                      WHERE a.meeting_id = m.id AND a.series_id IS NOT NULL),
                    ARRAY[]::varchar[]
                  ) as series_ids,
                  -- Span of the linked outing: what makes a camp render as a
                  -- multi-day block instead of a single chip.
                  (act.activity_end_date - act.activity_start_date + 1) as span_days,
                  COALESCE(act.activity_end_date, act.activity_start_date)::text as span_end_date
           FROM year_plan_meetings m
           LEFT JOIN year_plan_periods p ON m.period_id = p.id
           LEFT JOIN activities act ON act.id = m.activity_id AND act.is_active = TRUE
           WHERE m.year_plan_id = $1 AND m.organization_id = $2
           ORDER BY m.meeting_date`,
          [planId, organizationId]
        )
      ]);

      if (planResult.rows.length === 0) {
        return error(res, 'Year plan not found', 404);
      }

      const plan = planResult.rows[0];
      plan.periods = periodsResult.rows;
      plan.objectives = objectivesResult.rows;
      plan.meetings = meetingsResult.rows;

      // Outings/events (activities table) within the plan range, so the
      // timeline can show camps and outings next to regular meetings.
      // Consent and transport status travels with the outing so a chip can show
      // its badges without a request per date.
      const eventsResult = await pool.query(
        `SELECT a.id, a.name,
                COALESCE(a.activity_start_date, a.activity_date)::text as start_date,
                COALESCE(a.activity_end_date, a.activity_start_date, a.activity_date)::text as end_date,
                a.meeting_location_going as location,
                ypm.id as linked_meeting_id,
                COUNT(DISTINCT co.id) as carpool_offer_count,
                COUNT(DISTINCT ca.id) as assigned_participant_count,
                COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'pending') as pending_slip_count,
                COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'signed') as signed_slip_count,
                COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'declined') as declined_slip_count
         FROM activities a
         LEFT JOIN year_plan_meetings ypm
                ON ypm.activity_id = a.id AND ypm.organization_id = a.organization_id
         LEFT JOIN carpool_offers co
                ON co.activity_id = a.id AND co.is_active = TRUE
         LEFT JOIN carpool_assignments ca ON ca.carpool_offer_id = co.id
         LEFT JOIN permission_slips ps ON ps.activity_id = a.id
         WHERE a.organization_id = $1 AND a.is_active = TRUE
           AND COALESCE(a.activity_start_date, a.activity_date) >= $2
           AND COALESCE(a.activity_start_date, a.activity_date) <= $3
         GROUP BY a.id, ypm.id
         ORDER BY COALESCE(a.activity_start_date, a.activity_date)`,
        [organizationId, plan.start_date, plan.end_date]
      );
      plan.activity_events = eventsResult.rows;

      return success(res, plan);
    })
  );

  /**
   * POST /v1/yearly-planner/plans
   * Create a new year plan and generate meetings
   */
  router.post('/plans',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    [
      check('title').trim().notEmpty().isLength({ max: 255 }),
      check('start_date').isISO8601(),
      check('end_date').isISO8601(),
      check('default_location').optional().trim().isLength({ max: 500 }),
      check('recurrence_pattern').optional().isIn(['weekly', 'biweekly']),
      checkValidation
    ],
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const {
        title, start_date, end_date, default_location,
        recurrence_pattern, blackout_dates, anchors, settings
      } = req.body;

      // Shared org defaults (same source as the meeting preparation endpoints)
      const defaults = await getMeetingDefaults(pool, organizationId);
      const meetingDay = defaults.meetingDay;
      const meetingTime = defaults.meetingTime;
      const meetingDuration = defaults.durationMinutes;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create year plan
        const planResult = await client.query(
          `INSERT INTO year_plans
           (organization_id, title, start_date, end_date, default_location,
            recurrence_pattern, blackout_dates, anchors, settings, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            organizationId, title, start_date, end_date,
            default_location || '', recurrence_pattern || 'weekly',
            JSON.stringify(blackout_dates || []),
            JSON.stringify(anchors || []),
            JSON.stringify(settings || {}),
            req.user.id
          ]
        );

        const plan = planResult.rows[0];

        // Generate meetings based on recurrence pattern
        const meetings = generateMeetingDates(
          start_date, end_date, meetingDay,
          recurrence_pattern || 'weekly',
          blackout_dates || [],
          anchors || []
        );

        const endTime = computeEndTime(meetingTime, meetingDuration);

        // The calendar is unique per (organization, date): dates that already
        // exist (standalone preparations or meetings from an older plan) are
        // adopted into this plan without losing their preparation content.
        for (const meeting of meetings) {
          // eslint-disable-next-line no-await-in-loop -- ordered inserts inside one transaction
          await client.query(
            `INSERT INTO year_plan_meetings
             (organization_id, year_plan_id, meeting_date, start_time, end_time,
              duration_minutes, location, is_cancelled, anchor_id, theme, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (organization_id, meeting_date)
             DO UPDATE SET
               year_plan_id = EXCLUDED.year_plan_id,
               period_id = NULL,
               start_time = COALESCE(year_plan_meetings.start_time, EXCLUDED.start_time),
               end_time = COALESCE(year_plan_meetings.end_time, EXCLUDED.end_time),
               duration_minutes = COALESCE(year_plan_meetings.duration_minutes, EXCLUDED.duration_minutes),
               location = CASE WHEN COALESCE(year_plan_meetings.location, '') = ''
                               THEN EXCLUDED.location ELSE year_plan_meetings.location END,
               theme = COALESCE(EXCLUDED.theme, year_plan_meetings.theme),
               is_cancelled = EXCLUDED.is_cancelled,
               anchor_id = COALESCE(EXCLUDED.anchor_id, year_plan_meetings.anchor_id),
               metadata = year_plan_meetings.metadata || EXCLUDED.metadata,
               updated_at = NOW()`,
            [
              organizationId, plan.id, meeting.date,
              meetingTime, endTime, meetingDuration,
              meeting.location || default_location || '',
              meeting.is_cancelled || false,
              meeting.anchor_id || null,
              meeting.theme || null,
              JSON.stringify(meeting.metadata || {})
            ]
          );
        }

        await client.query('COMMIT');

        // Fetch the complete plan
        const fullPlan = planResult.rows[0];
        fullPlan.meeting_count = meetings.filter(m => !m.is_cancelled).length;

        return success(res, fullPlan, 'Year plan created', 201);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  /**
   * PATCH /v1/yearly-planner/plans/:id
   * Update a year plan
   */
  router.patch('/plans/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.id);
      const { title, default_location, blackout_dates, anchors, settings } = req.body;

      const check_result = await pool.query(
        'SELECT id FROM year_plans WHERE id = $1 AND organization_id = $2 AND is_active = TRUE',
        [planId, organizationId]
      );
      if (check_result.rows.length === 0) {
        return error(res, 'Year plan not found', 404);
      }

      const result = await pool.query(
        `UPDATE year_plans SET
          title = COALESCE($1, title),
          default_location = COALESCE($2, default_location),
          blackout_dates = COALESCE($3, blackout_dates),
          anchors = COALESCE($4, anchors),
          settings = COALESCE($5, settings),
          updated_at = NOW()
         WHERE id = $6 AND organization_id = $7
         RETURNING *`,
        [
          title || null,
          default_location || null,
          blackout_dates ? JSON.stringify(blackout_dates) : null,
          anchors ? JSON.stringify(anchors) : null,
          settings ? JSON.stringify(settings) : null,
          planId, organizationId
        ]
      );

      return success(res, result.rows[0], 'Year plan updated');
    })
  );

  /**
   * DELETE /v1/yearly-planner/plans/:id
   * Soft-delete a year plan
   */
  router.delete('/plans/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.id);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const result = await client.query(
          `UPDATE year_plans SET is_active = FALSE, updated_at = NOW()
           WHERE id = $1 AND organization_id = $2 AND is_active = TRUE
           RETURNING id`,
          [planId, organizationId]
        );

        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          return error(res, 'Year plan not found', 404);
        }

        // Keep meetings that carry preparation content or already happened
        // (detached from the plan); remove the untouched generated ones.
        await client.query(
          `UPDATE year_plan_meetings m
           SET year_plan_id = NULL, period_id = NULL, updated_at = NOW()
           WHERE m.year_plan_id = $1 AND m.organization_id = $2
             AND (m.meeting_date < CURRENT_DATE
                  OR m.animateur_responsable IS NOT NULL
                  OR EXISTS (SELECT 1 FROM year_plan_meeting_activities a WHERE a.meeting_id = m.id))`,
          [planId, organizationId]
        );
        await client.query(
          'DELETE FROM year_plan_meetings WHERE year_plan_id = $1 AND organization_id = $2',
          [planId, organizationId]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return success(res, null, 'Year plan deleted');
    })
  );

  // =========================================================================
  // PERIODS
  // =========================================================================

  /**
   * GET /v1/yearly-planner/plans/:planId/periods
   */
  router.get('/plans/:planId/periods',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.planId);

      const result = await pool.query(
        `SELECT p.*,
                (SELECT COUNT(*) FROM year_plan_objectives WHERE period_id = p.id) as objective_count,
                (SELECT COUNT(*) FROM year_plan_meetings WHERE period_id = p.id AND NOT is_cancelled) as meeting_count
         FROM year_plan_periods p
         WHERE p.year_plan_id = $1 AND p.organization_id = $2
         ORDER BY p.sort_order, p.start_date`,
        [planId, organizationId]
      );

      return success(res, result.rows);
    })
  );

  /**
   * POST /v1/yearly-planner/plans/:planId/periods
   */
  router.post('/plans/:planId/periods',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    [
      check('title').trim().notEmpty().isLength({ max: 255 }),
      check('start_date').isISO8601(),
      check('end_date').isISO8601(),
      checkValidation
    ],
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.planId);
      const { title, start_date, end_date, sort_order, settings } = req.body;

      // Verify plan exists
      const planCheck = await pool.query(
        'SELECT id FROM year_plans WHERE id = $1 AND organization_id = $2 AND is_active = TRUE',
        [planId, organizationId]
      );
      if (planCheck.rows.length === 0) {
        return error(res, 'Year plan not found', 404);
      }

      const result = await pool.query(
        `INSERT INTO year_plan_periods
         (organization_id, year_plan_id, title, start_date, end_date, sort_order, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [organizationId, planId, title, start_date, end_date, sort_order || 0, JSON.stringify(settings || {})]
      );

      // Auto-assign meetings within period date range
      await pool.query(
        `UPDATE year_plan_meetings SET period_id = $1
         WHERE year_plan_id = $2 AND organization_id = $3
         AND meeting_date >= $4 AND meeting_date <= $5
         AND period_id IS NULL`,
        [result.rows[0].id, planId, organizationId, start_date, end_date]
      );

      return success(res, result.rows[0], 'Period created', 201);
    })
  );

  /**
   * PATCH /v1/yearly-planner/periods/:id
   */
  router.patch('/periods/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const periodId = parseInt(req.params.id);
      const { title, start_date, end_date, sort_order, settings } = req.body;

      const result = await pool.query(
        `UPDATE year_plan_periods SET
          title = COALESCE($1, title),
          start_date = COALESCE($2, start_date),
          end_date = COALESCE($3, end_date),
          sort_order = COALESCE($4, sort_order),
          settings = COALESCE($5, settings),
          updated_at = NOW()
         WHERE id = $6 AND organization_id = $7
         RETURNING *`,
        [
          title || null, start_date || null, end_date || null,
          sort_order != null ? sort_order : null,
          settings ? JSON.stringify(settings) : null,
          periodId, organizationId
        ]
      );

      if (result.rows.length === 0) {
        return error(res, 'Period not found', 404);
      }

      return success(res, result.rows[0], 'Period updated');
    })
  );

  /**
   * DELETE /v1/yearly-planner/periods/:id
   */
  router.delete('/periods/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const periodId = parseInt(req.params.id);

      // Unlink meetings from period before deleting
      await pool.query(
        'UPDATE year_plan_meetings SET period_id = NULL WHERE period_id = $1 AND organization_id = $2',
        [periodId, organizationId]
      );

      const result = await pool.query(
        'DELETE FROM year_plan_periods WHERE id = $1 AND organization_id = $2 RETURNING id',
        [periodId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Period not found', 404);
      }

      return success(res, null, 'Period deleted');
    })
  );

  // =========================================================================
  // OBJECTIVES
  // =========================================================================

  /**
   * GET /v1/yearly-planner/plans/:planId/objectives
   */
  router.get('/plans/:planId/objectives',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.planId);

      const result = await pool.query(
        `SELECT o.*,
                p.title as period_title,
                parent.title as parent_title,
                (SELECT COUNT(*) FROM objective_achievements WHERE objective_id = o.id) as achievement_count
         FROM year_plan_objectives o
         LEFT JOIN year_plan_periods p ON o.period_id = p.id
         LEFT JOIN year_plan_objectives parent ON o.parent_id = parent.id
         WHERE o.year_plan_id = $1 AND o.organization_id = $2
         ORDER BY o.period_id NULLS LAST, o.sort_order`,
        [planId, organizationId]
      );

      return success(res, result.rows);
    })
  );

  /**
   * POST /v1/yearly-planner/plans/:planId/objectives
   */
  router.post('/plans/:planId/objectives',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    [
      check('title').trim().notEmpty().isLength({ max: 255 }),
      checkValidation
    ],
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.planId);
      const { title, description, period_id, parent_id, scope, sort_order } = req.body;

      const result = await pool.query(
        `INSERT INTO year_plan_objectives
         (organization_id, year_plan_id, period_id, parent_id, title, description, scope, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          organizationId, planId, period_id || null, parent_id || null,
          title, description || null, scope || 'unit', sort_order || 0
        ]
      );

      return success(res, result.rows[0], 'Objective created', 201);
    })
  );

  /**
   * PATCH /v1/yearly-planner/objectives/:id
   */
  router.patch('/objectives/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const objId = parseInt(req.params.id);
      const { title, description, period_id, parent_id, scope, sort_order } = req.body;

      const result = await pool.query(
        `UPDATE year_plan_objectives SET
          title = COALESCE($1, title),
          description = COALESCE($2, description),
          period_id = $3,
          parent_id = $4,
          scope = COALESCE($5, scope),
          sort_order = COALESCE($6, sort_order),
          updated_at = NOW()
         WHERE id = $7 AND organization_id = $8
         RETURNING *`,
        [
          title || null, description, period_id, parent_id,
          scope || null, sort_order != null ? sort_order : null,
          objId, organizationId
        ]
      );

      if (result.rows.length === 0) {
        return error(res, 'Objective not found', 404);
      }

      return success(res, result.rows[0], 'Objective updated');
    })
  );

  /**
   * DELETE /v1/yearly-planner/objectives/:id
   */
  router.delete('/objectives/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const objId = parseInt(req.params.id);

      const result = await pool.query(
        'DELETE FROM year_plan_objectives WHERE id = $1 AND organization_id = $2 RETURNING id',
        [objId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Objective not found', 404);
      }

      return success(res, null, 'Objective deleted');
    })
  );

  // =========================================================================
  // MEETINGS (year plan meeting instances)
  // =========================================================================

  /**
   * PATCH /v1/yearly-planner/meetings/:id
   * Update a meeting (theme, location, time, notes, cancel)
   */
  router.patch('/meetings/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const meetingId = parseInt(req.params.id);

      const meetingCheck = await pool.query(
        'SELECT id, meeting_date FROM year_plan_meetings WHERE id = $1 AND organization_id = $2',
        [meetingId, organizationId]
      );

      if (meetingCheck.rows.length === 0) {
        return error(res, 'Meeting not found', 404);
      }

      // Past meetings stay editable: documenting what actually happened is
      // normal for an animation team, and POST /v1/meetings/preparation already
      // rewrites the same row with no date restriction, so a lock here protected
      // nothing while making the planner worse than the preparation page.
      // Only already-processed honors are defended, below.
      if (req.body.is_cancelled === true) {
        const processed = await pool.query(
          `SELECT 1 FROM year_plan_meeting_activities
            WHERE meeting_id = $1 AND organization_id = $2 AND processed = TRUE
            LIMIT 1`,
          [meetingId, organizationId]
        );
        if (processed.rows.length > 0) {
          return error(res, 'meeting_already_processed', 409);
        }
      }

      // Only columns explicitly present in the body are touched. A COALESCE-based
      // update cannot express "clear this field", and treating an absent key as
      // NULL silently wiped period_id on every partial update — which would erase
      // the period a meeting belongs to each time the planner saves a theme.
      const updates = [];
      const values = [];
      for (const field of PATCHABLE_MEETING_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(req.body, field)) {
          continue;
        }
        let value = req.body[field];
        if (field === 'metadata') {
          value = JSON.stringify(value || {});
        }
        if (field === 'meeting_kind' && !MEETING_KINDS.includes(value)) {
          return error(res, `meeting_kind must be one of: ${MEETING_KINDS.join(', ')}`, 400);
        }
        updates.push(`${field} = $${updates.length + 3}`);
        values.push(value);
      }

      if (updates.length === 0) {
        return success(res, meetingCheck.rows[0], 'No changes detected');
      }

      // Field names come from the PATCHABLE_MEETING_FIELDS whitelist above, never
      // from the request; every value is parameterized.
      const updateSql = `UPDATE year_plan_meetings SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`;
      const result = await pool.query(updateSql, [meetingId, organizationId, ...values]);

      return success(res, result.rows[0], 'Meeting updated');
    })
  );

  /**
   * GET /v1/yearly-planner/meetings/:id
   * Get meeting details with activities
   */
  router.get('/meetings/:id',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const meetingId = parseInt(req.params.id);

      const [meetingResult, activitiesResult] = await Promise.all([
        pool.query(
          `SELECT m.*, m.meeting_date::text as meeting_date, p.title as period_title
           FROM year_plan_meetings m
           LEFT JOIN year_plan_periods p ON m.period_id = p.id
           WHERE m.id = $1 AND m.organization_id = $2`,
          [meetingId, organizationId]
        ),
        pool.query(
          `SELECT a.*, al.name as library_name, al.category as library_category
           FROM year_plan_meeting_activities a
           LEFT JOIN activity_library al ON a.activity_library_id = al.id
           WHERE a.meeting_id = $1 AND a.organization_id = $2
           ORDER BY a.sort_order`,
          [meetingId, organizationId]
        )
      ]);

      if (meetingResult.rows.length === 0) {
        return error(res, 'Meeting not found', 404);
      }

      const meeting = meetingResult.rows[0];
      meeting.activities = activitiesResult.rows;

      // Check locked status
      const meetingDate = new Date(`${meeting.meeting_date}T00:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      meeting.is_locked = meetingDate < today;

      return success(res, meeting);
    })
  );

  /**
   * POST /v1/yearly-planner/meetings/:id/activity-event
   * Create an outing/event in the activities table from a planned meeting
   * (unlocks carpools, permission slips, and the iCal feed) and link it back.
   */
  router.post('/meetings/:id/activity-event',
    authenticate,
    blockDemoRoles,
    requirePermission('activities.create'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const meetingId = parseInt(req.params.id);

      const meetingResult = await pool.query(
        `SELECT m.*, m.meeting_date::text as meeting_date
         FROM year_plan_meetings m
         WHERE m.id = $1 AND m.organization_id = $2`,
        [meetingId, organizationId]
      );

      if (meetingResult.rows.length === 0) {
        return error(res, 'Meeting not found', 404);
      }

      const meeting = meetingResult.rows[0];

      if (meeting.activity_id) {
        return error(res, 'Meeting is already linked to an activity', 409);
      }

      const defaults = await getMeetingDefaults(pool, organizationId);
      let plan;
      try {
        plan = buildActivityEventPlan(meeting, req.body, defaults);
      } catch (err) {
        return error(res, err.message, 400);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const activity = await insertActivityEventForMeeting(client, {
          organizationId,
          userId: req.user.id,
          meetingId,
          plan
        });

        await client.query('COMMIT');
        return success(res, activity, 'Activity created from meeting', 201);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  /**
   * DELETE /v1/yearly-planner/meetings/:id/activity-event
   * Unlink the outing from a meeting. The activities row is kept: it may
   * already carry signed permission slips and carpool offers.
   */
  router.delete('/meetings/:id/activity-event',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const meetingId = parseInt(req.params.id);

      const existing = await pool.query(
        'SELECT activity_id FROM year_plan_meetings WHERE id = $1 AND organization_id = $2',
        [meetingId, organizationId]
      );
      if (existing.rows.length === 0) {
        return error(res, 'Meeting not found', 404);
      }
      const previousActivityId = existing.rows[0].activity_id;
      if (!previousActivityId) {
        return error(res, 'Meeting is not linked to an activity', 404);
      }

      await pool.query(
        'UPDATE year_plan_meetings SET activity_id = NULL, updated_at = NOW() WHERE id = $1 AND organization_id = $2',
        [meetingId, organizationId]
      );

      return success(
        res,
        { meeting_id: meetingId, unlinked_activity_id: previousActivityId },
        'Activity unlinked from meeting'
      );
    })
  );

  /**
   * POST /v1/yearly-planner/plans/:planId/meetings
   * Add a single date to a plan: a one-off meeting, a weekend outing, or a
   * multi-day camp. Multi-day blocks are one meeting row plus one multi-day
   * activities row, which is what carpools and permission slips point at.
   */
  router.post('/plans/:planId/meetings',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    [
      check('meeting_date').isISO8601(),
      check('end_date').optional({ nullable: true }).isISO8601(),
      check('kind').optional().isIn(MEETING_KINDS),
      check('theme').optional({ nullable: true }).trim().isLength({ max: 255 }),
      check('location').optional({ nullable: true }).trim().isLength({ max: 500 }),
      checkValidation
    ],
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.planId);
      const {
        meeting_date, end_date, theme, location, notes,
        start_time, end_time, duration_minutes, period_id
      } = req.body;
      const kind = req.body.kind || 'regular';

      if (end_date && end_date < meeting_date) {
        return error(res, 'end_date must be on or after meeting_date', 400);
      }

      const planCheck = await pool.query(
        'SELECT id FROM year_plans WHERE id = $1 AND organization_id = $2 AND is_active = TRUE',
        [planId, organizationId]
      );
      if (planCheck.rows.length === 0) {
        return error(res, 'Year plan not found', 404);
      }

      // A period may only be attached if it belongs to this plan.
      if (period_id) {
        const periodCheck = await pool.query(
          'SELECT id FROM year_plan_periods WHERE id = $1 AND year_plan_id = $2 AND organization_id = $3',
          [period_id, planId, organizationId]
        );
        if (periodCheck.rows.length === 0) {
          return error(res, 'Period not found in this plan', 404);
        }
      }

      const defaults = await getMeetingDefaults(pool, organizationId);
      const startTime = start_time || defaults.meetingTime;
      const durationMinutes = duration_minutes || defaults.durationMinutes;
      const endTime = end_time || computeEndTime(startTime, durationMinutes);

      const wantsActivityEvent = req.body.create_activity_event !== undefined
        ? req.body.create_activity_event === true
        : (ACTIVITY_EVENT_KINDS.includes(kind) || Boolean(end_date && end_date > meeting_date));
      // Creating the outing needs activities.create. Rather than gating the whole
      // endpoint on both permissions - which would lock out animation staff who
      // may plan dates but not create outings - the date is still created and the
      // omission is reported.
      const canCreateActivities = Array.isArray(req.user.permissions)
        && req.user.permissions.includes('activities.create');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // The calendar is unique per (organization, date). A date that already
        // exists as a standalone preparation is the normal case after the merge
        // migration, so adopt it into this plan instead of rejecting.
        const meetingResult = await client.query(
          `INSERT INTO year_plan_meetings
             (organization_id, year_plan_id, period_id, meeting_date, start_time, end_time,
              duration_minutes, location, theme, notes, meeting_kind, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (organization_id, meeting_date)
           DO UPDATE SET
             year_plan_id = EXCLUDED.year_plan_id,
             period_id = COALESCE(EXCLUDED.period_id, year_plan_meetings.period_id),
             start_time = COALESCE(EXCLUDED.start_time, year_plan_meetings.start_time),
             end_time = COALESCE(EXCLUDED.end_time, year_plan_meetings.end_time),
             duration_minutes = COALESCE(EXCLUDED.duration_minutes, year_plan_meetings.duration_minutes),
             location = CASE WHEN COALESCE(EXCLUDED.location, '') = ''
                             THEN year_plan_meetings.location ELSE EXCLUDED.location END,
             theme = COALESCE(EXCLUDED.theme, year_plan_meetings.theme),
             notes = COALESCE(EXCLUDED.notes, year_plan_meetings.notes),
             meeting_kind = EXCLUDED.meeting_kind,
             updated_at = NOW()
           RETURNING *, meeting_date::text AS meeting_date, (xmax = 0) AS inserted`,
          [
            organizationId, planId, period_id || null, meeting_date,
            startTime, endTime, durationMinutes,
            location || null, theme || null, notes || null, kind,
            JSON.stringify({})
          ]
        );

        const meeting = meetingResult.rows[0];
        const wasInserted = meeting.inserted;
        delete meeting.inserted;

        let activityEventSkipped = null;
        if (wantsActivityEvent && meeting.activity_id) {
          activityEventSkipped = 'already_linked';
        } else if (wantsActivityEvent && !canCreateActivities) {
          activityEventSkipped = 'forbidden';
        } else if (wantsActivityEvent) {
          let plan;
          try {
            plan = buildActivityEventPlan(
              meeting,
              { ...req.body, end_date: end_date || meeting_date },
              defaults
            );
          } catch (err) {
            await client.query('ROLLBACK');
            return error(res, err.message, 400);
          }
          const activity = await insertActivityEventForMeeting(client, {
            organizationId,
            userId: req.user.id,
            meetingId: meeting.id,
            plan
          });
          meeting.activity_id = activity.id;
          meeting.activity = activity;
        }

        await client.query('COMMIT');

        if (activityEventSkipped) {
          meeting.activity_event_skipped = activityEventSkipped;
        }
        return success(
          res,
          wasInserted ? meeting : { ...meeting, adopted: true },
          wasInserted ? 'Meeting created' : 'Existing date adopted into the plan',
          wasInserted ? 201 : 200
        );
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  /**
   * DELETE /v1/yearly-planner/meetings/:id
   * Remove a date from the calendar. Refused when attendance was recorded:
   * that date is history, not clutter.
   */
  router.delete('/meetings/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const meetingId = parseInt(req.params.id);

      const meetingResult = await pool.query(
        `SELECT id, activity_id, meeting_date::text AS meeting_date
           FROM year_plan_meetings WHERE id = $1 AND organization_id = $2`,
        [meetingId, organizationId]
      );
      if (meetingResult.rows.length === 0) {
        return error(res, 'Meeting not found', 404);
      }
      const meeting = meetingResult.rows[0];

      const attendance = await pool.query(
        'SELECT 1 FROM attendance WHERE organization_id = $1 AND date = $2 LIMIT 1',
        [organizationId, meeting.meeting_date]
      );
      if (attendance.rows.length > 0) {
        return error(res, 'meeting_has_attendance', 409);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          'DELETE FROM year_plan_meeting_activities WHERE meeting_id = $1 AND organization_id = $2',
          [meetingId, organizationId]
        );
        await client.query(
          'DELETE FROM year_plan_reminders WHERE meeting_id = $1 AND organization_id = $2',
          [meetingId, organizationId]
        );
        // Detach rather than cascade: these rows outlive the planned date.
        await client.query(
          'UPDATE equipment_reservations SET meeting_id = NULL WHERE meeting_id = $1',
          [meetingId]
        );
        await client.query(
          'UPDATE objective_achievements SET meeting_id = NULL WHERE meeting_id = $1 AND organization_id = $2',
          [meetingId, organizationId]
        );

        await client.query(
          'DELETE FROM year_plan_meetings WHERE id = $1 AND organization_id = $2',
          [meetingId, organizationId]
        );

        await client.query('COMMIT');

        // The linked outing is deliberately left in place: it may already carry
        // signed permission slips and carpool offers. The caller decides.
        return success(
          res,
          { meeting_id: meetingId, unlinked_activity_id: meeting.activity_id || null },
          'Meeting deleted'
        );
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    })
  );

  // =========================================================================
  // MEETING ACTIVITIES
  // =========================================================================

  /**
   * POST /v1/yearly-planner/meetings/:meetingId/activities
   */
  router.post('/meetings/:meetingId/activities',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    [
      check('name').trim().notEmpty().isLength({ max: 255 }),
      checkValidation
    ],
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const meetingId = parseInt(req.params.meetingId);

      // Verify meeting exists. Past dates are allowed: series placement spans
      // whole terms and must not fail on dates that have already gone by.
      const meetingCheck = await pool.query(
        'SELECT id, meeting_date FROM year_plan_meetings WHERE id = $1 AND organization_id = $2',
        [meetingId, organizationId]
      );

      if (meetingCheck.rows.length === 0) {
        return error(res, 'Meeting not found', 404);
      }

      const {
        activity_library_id, name, description, duration_minutes,
        sort_order, objective_ids, series_id, series_occurrence, metadata
      } = req.body;

      const result = await pool.query(
        `INSERT INTO year_plan_meeting_activities
         (organization_id, meeting_id, activity_library_id, name, description,
          duration_minutes, sort_order, objective_ids, series_id, series_occurrence, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          organizationId, meetingId, activity_library_id || null,
          name, description || null, duration_minutes || null,
          sort_order || 0, JSON.stringify(objective_ids || []),
          series_id || null, series_occurrence || null,
          JSON.stringify(metadata || {})
        ]
      );

      // Update library usage stats if from library
      if (activity_library_id) {
        await pool.query(
          `UPDATE activity_library
           SET times_used = times_used + 1, last_used_date = CURRENT_DATE, updated_at = NOW()
           WHERE id = $1 AND organization_id = $2`,
          [activity_library_id, organizationId]
        );
      }

      return success(res, result.rows[0], 'Activity added to meeting', 201);
    })
  );

  /**
   * PATCH /v1/yearly-planner/meeting-activities/:id
   */
  router.patch('/meeting-activities/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const activityId = parseInt(req.params.id);
      const { name, description, duration_minutes, sort_order, objective_ids, metadata } = req.body;

      const result = await pool.query(
        `UPDATE year_plan_meeting_activities SET
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          duration_minutes = COALESCE($3, duration_minutes),
          sort_order = COALESCE($4, sort_order),
          objective_ids = COALESCE($5, objective_ids),
          metadata = COALESCE($6, metadata),
          updated_at = NOW()
         WHERE id = $7 AND organization_id = $8
         RETURNING *`,
        [
          name || null, description, duration_minutes,
          sort_order != null ? sort_order : null,
          objective_ids ? JSON.stringify(objective_ids) : null,
          metadata ? JSON.stringify(metadata) : null,
          activityId, organizationId
        ]
      );

      if (result.rows.length === 0) {
        return error(res, 'Activity not found', 404);
      }

      return success(res, result.rows[0], 'Activity updated');
    })
  );

  /**
   * DELETE /v1/yearly-planner/meeting-activities/:id
   */
  router.delete('/meeting-activities/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const activityId = parseInt(req.params.id);

      const result = await pool.query(
        'DELETE FROM year_plan_meeting_activities WHERE id = $1 AND organization_id = $2 RETURNING id',
        [activityId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Activity not found', 404);
      }

      return success(res, null, 'Activity removed');
    })
  );

  // =========================================================================
  // ACTIVITY LIBRARY
  // =========================================================================

  /**
   * GET /v1/yearly-planner/activity-library
   */
  router.get('/activity-library',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { category, search, objective_id, sort_by } = req.query;

      let query = `SELECT * FROM activity_library WHERE organization_id = $1 AND is_active = TRUE`;
      const params = [organizationId];
      let paramIndex = 2;

      if (category) {
        query += ` AND category = $${paramIndex}`;
        params.push(category);
        paramIndex++;
      }

      if (search) {
        query += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      if (objective_id) {
        query += ` AND objective_ids @> $${paramIndex}::jsonb`;
        params.push(JSON.stringify([parseInt(objective_id)]));
        paramIndex++;
      }

      // Sorting
      switch (sort_by) {
        case 'rating':
          query += ' ORDER BY avg_rating DESC NULLS LAST, name';
          break;
        case 'recent':
          query += ' ORDER BY last_used_date DESC NULLS LAST, name';
          break;
        case 'popular':
          query += ' ORDER BY times_used DESC, name';
          break;
        default:
          query += ' ORDER BY name';
      }

      const result = await pool.query(query, params);

      return success(res, result.rows);
    })
  );

  /**
   * POST /v1/yearly-planner/activity-library
   */
  router.post('/activity-library',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    [
      check('name').trim().notEmpty().isLength({ max: 255 }),
      checkValidation
    ],
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const {
        name, description, category, tags,
        estimated_duration_min, estimated_duration_max,
        material, objective_ids, metadata
      } = req.body;

      const result = await pool.query(
        `INSERT INTO activity_library
         (organization_id, name, description, category, tags,
          estimated_duration_min, estimated_duration_max, material,
          objective_ids, metadata, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          organizationId, name, description || null, category || null,
          JSON.stringify(tags || []),
          estimated_duration_min || null, estimated_duration_max || null,
          material || null, JSON.stringify(objective_ids || []),
          JSON.stringify(metadata || {}), req.user.id
        ]
      );

      return success(res, result.rows[0], 'Activity added to library', 201);
    })
  );

  /**
   * PATCH /v1/yearly-planner/activity-library/:id
   */
  router.patch('/activity-library/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const libId = parseInt(req.params.id);
      const {
        name, description, category, tags,
        estimated_duration_min, estimated_duration_max,
        material, objective_ids, metadata
      } = req.body;

      const result = await pool.query(
        `UPDATE activity_library SET
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          category = COALESCE($3, category),
          tags = COALESCE($4, tags),
          estimated_duration_min = COALESCE($5, estimated_duration_min),
          estimated_duration_max = COALESCE($6, estimated_duration_max),
          material = COALESCE($7, material),
          objective_ids = COALESCE($8, objective_ids),
          metadata = COALESCE($9, metadata),
          updated_at = NOW()
         WHERE id = $10 AND organization_id = $11 AND is_active = TRUE
         RETURNING *`,
        [
          name || null, description, category || null,
          tags ? JSON.stringify(tags) : null,
          estimated_duration_min, estimated_duration_max,
          material, objective_ids ? JSON.stringify(objective_ids) : null,
          metadata ? JSON.stringify(metadata) : null,
          libId, organizationId
        ]
      );

      if (result.rows.length === 0) {
        return error(res, 'Library activity not found', 404);
      }

      return success(res, result.rows[0], 'Library activity updated');
    })
  );

  /**
   * DELETE /v1/yearly-planner/activity-library/:id
   */
  router.delete('/activity-library/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const libId = parseInt(req.params.id);

      const result = await pool.query(
        `UPDATE activity_library SET is_active = FALSE, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND is_active = TRUE
         RETURNING id`,
        [libId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Library activity not found', 404);
      }

      return success(res, null, 'Library activity deleted');
    })
  );

  // =========================================================================
  // OBJECTIVE ACHIEVEMENTS
  // =========================================================================

  /**
   * POST /v1/yearly-planner/achievements
   * Grant objective achievement to participants
   */
  router.post('/achievements',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { objective_id, participant_ids, meeting_id, achieved_date, attribution_source, notes } = req.body;

      if (!objective_id || !participant_ids || !Array.isArray(participant_ids) || participant_ids.length === 0) {
        return error(res, 'objective_id and participant_ids array required', 400);
      }

      const inserted = [];
      for (const participantId of participant_ids) {
        try {
          const result = await pool.query(
            `INSERT INTO objective_achievements
             (organization_id, objective_id, participant_id, meeting_id, achieved_date, attribution_source, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (organization_id, objective_id, participant_id) DO NOTHING
             RETURNING *`,
            [
              organizationId, objective_id, participantId,
              meeting_id || null,
              achieved_date || new Date().toISOString().split('T')[0],
              attribution_source || 'manual',
              notes || null,
              req.user.id
            ]
          );
          if (result.rows.length > 0) {
            inserted.push(result.rows[0]);
          }
        } catch (err) {
          logger.warn(`Failed to insert achievement for participant ${participantId}:`, err.message);
        }
      }

      return success(res, inserted, `${inserted.length} achievements granted`, 201);
    })
  );

  /**
   * GET /v1/yearly-planner/achievements
   * Get achievements for a plan/objective/participant
   */
  router.get('/achievements',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { objective_id, participant_id, meeting_id } = req.query;

      let query = `
        SELECT a.*, o.title as objective_title, p.first_name, p.last_name
        FROM objective_achievements a
        JOIN year_plan_objectives o ON a.objective_id = o.id
        JOIN participants p ON a.participant_id = p.id
        WHERE a.organization_id = $1`;
      const params = [organizationId];
      let idx = 2;

      if (objective_id) {
        query += ` AND a.objective_id = $${idx}`;
        params.push(parseInt(objective_id));
        idx++;
      }
      if (participant_id) {
        query += ` AND a.participant_id = $${idx}`;
        params.push(parseInt(participant_id));
        idx++;
      }
      if (meeting_id) {
        query += ` AND a.meeting_id = $${idx}`;
        params.push(parseInt(meeting_id));
        idx++;
      }

      query += ' ORDER BY a.achieved_date DESC';

      const result = await pool.query(query, params);

      return success(res, result.rows);
    })
  );

  /**
   * DELETE /v1/yearly-planner/achievements/:id
   */
  router.delete('/achievements/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const achId = parseInt(req.params.id);

      const result = await pool.query(
        'DELETE FROM objective_achievements WHERE id = $1 AND organization_id = $2 RETURNING id',
        [achId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Achievement not found', 404);
      }

      return success(res, null, 'Achievement removed');
    })
  );

  // =========================================================================
  // DISTRIBUTION RULES
  // =========================================================================

  /**
   * GET /v1/yearly-planner/plans/:planId/distribution-rules
   */
  router.get('/plans/:planId/distribution-rules',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.planId);

      const result = await pool.query(
        `SELECT dr.*, al.name as library_activity_name, al.category
         FROM activity_distribution_rules dr
         LEFT JOIN activity_library al ON dr.activity_library_id = al.id
         WHERE dr.year_plan_id = $1 AND dr.organization_id = $2
         ORDER BY dr.activity_name`,
        [planId, organizationId]
      );

      return success(res, result.rows);
    })
  );

  /**
   * POST /v1/yearly-planner/plans/:planId/distribution-rules
   */
  router.post('/plans/:planId/distribution-rules',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    [
      check('activity_name').trim().notEmpty().isLength({ max: 255 }),
      check('distribution_scope').isIn(['year', 'period', 'month']),
      check('placement_rule').isIn(['near_start', 'near_end', 'evenly_spaced', 'manual']),
      checkValidation
    ],
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.planId);
      const {
        activity_library_id, activity_name, distribution_scope,
        placement_rule, occurrences_per_scope, settings
      } = req.body;

      const result = await pool.query(
        `INSERT INTO activity_distribution_rules
         (organization_id, year_plan_id, activity_library_id, activity_name,
          distribution_scope, placement_rule, occurrences_per_scope, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          organizationId, planId, activity_library_id || null,
          activity_name, distribution_scope, placement_rule,
          occurrences_per_scope || 1, JSON.stringify(settings || {})
        ]
      );

      return success(res, result.rows[0], 'Distribution rule created', 201);
    })
  );

  /**
   * DELETE /v1/yearly-planner/distribution-rules/:id
   */
  router.delete('/distribution-rules/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const ruleId = parseInt(req.params.id);

      const result = await pool.query(
        'DELETE FROM activity_distribution_rules WHERE id = $1 AND organization_id = $2 RETURNING id',
        [ruleId, organizationId]
      );

      if (result.rows.length === 0) {
        return error(res, 'Distribution rule not found', 404);
      }

      return success(res, null, 'Distribution rule deleted');
    })
  );

  // =========================================================================
  // MEETING REMINDERS
  // =========================================================================

  /**
   * POST /v1/yearly-planner/meetings/:meetingId/reminders
   */
  router.post('/meetings/:meetingId/reminders',
    authenticate,
    blockDemoRoles,
    requirePermission('meetings.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const meetingId = parseInt(req.params.meetingId);
      const { channel, scheduled_at, custom_message } = req.body;

      const result = await pool.query(
        `INSERT INTO year_plan_reminders
         (organization_id, meeting_id, channel, scheduled_at, custom_message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          organizationId, meetingId,
          channel || 'email',
          scheduled_at,
          custom_message || null
        ]
      );

      return success(res, result.rows[0], 'Reminder scheduled', 201);
    })
  );

  /**
   * GET /v1/yearly-planner/plans/:planId/reminders
   */
  router.get('/plans/:planId/reminders',
    authenticate,
    requirePermission('meetings.view'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const planId = parseInt(req.params.planId);

      const result = await pool.query(
        `SELECT r.*, m.meeting_date, m.theme
         FROM year_plan_reminders r
         JOIN year_plan_meetings m ON r.meeting_id = m.id
         WHERE m.year_plan_id = $1 AND r.organization_id = $2
         ORDER BY r.scheduled_at`,
        [planId, organizationId]
      );

      return success(res, result.rows);
    })
  );

  // =========================================================================
  // HELPER: Generate meeting dates
  // =========================================================================

  /**
   * Generate meeting dates for a year plan based on recurrence and blackouts
   * @param {string} startDate - Start date ISO string
   * @param {string} endDate - End date ISO string
   * @param {string} meetingDay - Day of week (e.g., 'Wednesday')
   * @param {string} pattern - 'weekly' or 'biweekly'
   * @param {Array} blackoutDates - Array of {start_date, end_date, label}
   * @param {Array} anchors - Array of {date, type, theme, location, ...}
   * @returns {Array} Array of meeting objects
   */
  function generateMeetingDates(startDate, endDate, meetingDay, pattern, blackoutDates, anchors) {
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const targetDay = daysOfWeek.indexOf(meetingDay);
    if (targetDay === -1) return [];

    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    const increment = pattern === 'biweekly' ? 14 : 7;
    const meetings = [];

    // Find first meeting day on or after start
    const current = new Date(start);
    while (current.getDay() !== targetDay) {
      current.setDate(current.getDate() + 1);
    }

    // Build blackout ranges
    const blackoutRanges = (blackoutDates || []).map(b => ({
      start: new Date(`${b.start_date}T00:00:00`),
      end: new Date(`${b.end_date}T00:00:00`),
      label: b.label
    }));

    // Build anchor map by date
    const anchorMap = {};
    for (const anchor of (anchors || [])) {
      if (anchor.date) {
        anchorMap[anchor.date] = anchor;
      }
    }

    while (current <= end) {
      const dateStr = formatLocalDate(current);

      // Check blackout
      const inBlackout = blackoutRanges.some(
        b => current >= b.start && current <= b.end
      );

      const anchor = anchorMap[dateStr];

      if (inBlackout) {
        meetings.push({
          date: dateStr,
          is_cancelled: true,
          theme: null,
          location: null,
          anchor_id: null,
          metadata: { blackout: true }
        });
      } else if (anchor) {
        meetings.push({
          date: dateStr,
          is_cancelled: anchor.type === 'no_meeting',
          theme: anchor.theme || null,
          location: anchor.location || null,
          anchor_id: anchor.id || null,
          metadata: { anchor: true, anchor_type: anchor.type }
        });
      } else {
        meetings.push({
          date: dateStr,
          is_cancelled: false,
          theme: null,
          location: null,
          anchor_id: null,
          metadata: {}
        });
      }

      current.setDate(current.getDate() + increment);
    }

    // Add anchor meetings on non-meeting-day dates (special events)
    for (const anchor of (anchors || [])) {
      if (!anchor.date) continue;
      const anchorDate = new Date(`${anchor.date}T00:00:00`);
      if (anchorDate.getDay() !== targetDay && anchor.type !== 'no_meeting') {
        const exists = meetings.some(m => m.date === anchor.date);
        if (!exists && anchorDate >= start && anchorDate <= end) {
          meetings.push({
            date: anchor.date,
            is_cancelled: false,
            theme: anchor.theme || null,
            location: anchor.location || null,
            anchor_id: anchor.id || null,
            metadata: { anchor: true, special_date: true }
          });
        }
      }
    }

    // Sort by date
    meetings.sort((a, b) => a.date.localeCompare(b.date));

    return meetings;
  }

  return router;
};
