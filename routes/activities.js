// RESTful routes for activities and event calendar
const express = require('express');
const router = express.Router();
const { authenticate, authorize, getOrganizationId, requirePermission, blockDemoRoles } = require('../middleware/auth');
const { toBool } = require('../utils');
const { success, error, asyncHandler } = require('../middleware/response');

module.exports = (pool) => {
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
        COUNT(DISTINCT co.id) as carpool_offer_count,
        COUNT(DISTINCT ca.participant_id) as assigned_participant_count,
        COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'pending') as pending_slip_count,
        COUNT(DISTINCT ps.id) FILTER (WHERE ps.status = 'signed') as signed_slip_count
       FROM activities a
       LEFT JOIN users u ON a.created_by = u.id
       LEFT JOIN carpool_offers co ON a.id = co.activity_id AND co.is_active = TRUE
       LEFT JOIN carpool_assignments ca ON co.id = ca.carpool_offer_id
       LEFT JOIN permission_slips ps ON a.id = ps.activity_id AND ps.status IN ('pending', 'signed')
       WHERE a.organization_id = $1 AND a.is_active = TRUE
       GROUP BY a.id, u.full_name
       ORDER BY COALESCE(a.activity_start_date, a.activity_date) ASC, a.activity_start_time ASC, a.departure_time_going ASC`,
      [organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * Get a specific activity by ID
   * Accessible by: animation, admin, parent
   */
  router.get('/:id', authenticate, requirePermission('activities.view'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT
        a.*,
        u.full_name as created_by_name,
        u.email as created_by_email
       FROM activities a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.id = $1 AND a.organization_id = $2 AND a.is_active = TRUE`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    return success(res, result.rows[0]);
  }));

  /**
   * Create a new activity
   * Accessible by: animation, admin only
   */
  router.post('/', authenticate, blockDemoRoles, requirePermission('activities.create'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.user.id;

    // Debug logging to diagnose form submission issues
    console.log('[Activity Creation] Request body:', JSON.stringify(req.body, null, 2));
    console.log('[Activity Creation] Content-Type:', req.headers['content-type']);
    console.log('[Activity Creation] Organization ID:', organizationId);

    const {
      name,
      description,
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
    const normalizedStartTime = activity_start_time || meeting_time_going;
    const normalizedEndDate = activity_end_date || normalizedStartDate;
    const normalizedEndTime = activity_end_time || departure_time_return || departure_time_going;

    // Validation with specific error messages
    const missingFields = [];
    if (!name) missingFields.push('name');
    if (!normalizedStartDate) missingFields.push('activity_start_date or activity_date');
    if (!normalizedStartTime) missingFields.push('activity_start_time or meeting_time_going');
    if (!normalizedEndDate) missingFields.push('activity_end_date');
    if (!normalizedEndTime) missingFields.push('activity_end_time or departure_time_going/departure_time_return');
    if (!meeting_location_going) missingFields.push('meeting_location_going');
    if (!meeting_time_going) missingFields.push('meeting_time_going');
    if (!departure_time_going) missingFields.push('departure_time_going');

    if (missingFields.length > 0) {
      return error(res, `Missing required fields: ${missingFields.join(', ')}`, 400);
    }

    // Validate that departure time is after meeting time
    if (meeting_time_going >= departure_time_going) {
      return error(res, 'Departure time must be after meeting time', 400);
    }

    // If return trip is specified, validate those times too
    if (meeting_time_return && departure_time_return && meeting_time_return >= departure_time_return) {
      return error(res, 'Return departure time must be after return meeting time', 400);
    }

    const startStamp = `${normalizedStartDate}T${normalizedStartTime}`;
    const endStamp = `${normalizedEndDate}T${normalizedEndTime}`;
    if (endStamp < startStamp) {
      return error(res, 'Activity end must be after start', 400);
    }

    const result = await pool.query(
      `INSERT INTO activities (
        organization_id, created_by, name, description, activity_date,
        activity_start_date, activity_start_time, activity_end_date, activity_end_time,
        meeting_location_going, meeting_time_going, departure_time_going,
        meeting_location_return, meeting_time_return, departure_time_return
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        organizationId, userId, name, description, normalizedActivityDate,
        normalizedStartDate, normalizedStartTime, normalizedEndDate, normalizedEndTime,
        meeting_location_going, meeting_time_going, departure_time_going,
        meeting_location_return, meeting_time_return, departure_time_return
      ]
    );

    return success(res, result.rows[0], 'Activity created successfully', 201);
  }));

  /**
   * Update an activity
   * Accessible by: animation, admin only
   */
  router.put('/:id', authenticate, blockDemoRoles, requirePermission('activities.edit'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);
    const shouldNotifyParticipants = req.body.notify_participants === undefined
      ? true
      : toBool(req.body.notify_participants) === 't';

    const {
      name,
      description,
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

    // Check if activity exists and belongs to organization
    const existingActivity = await pool.query(
      `SELECT id, activity_start_date, activity_start_time, activity_end_date, activity_end_time
       FROM activities
       WHERE id = $1 AND organization_id = $2 AND is_active = TRUE`,
      [id, organizationId]
    );

    if (existingActivity.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    const currentActivity = existingActivity.rows[0];

    const normalizedStartDateInput = activity_start_date || activity_date;
    const normalizedEndDateInput = activity_end_date || activity_date;
    const normalizedActivityDate = activity_date || activity_start_date || currentActivity.activity_start_date;
    const normalizedStartDate = normalizedStartDateInput || currentActivity.activity_start_date;
    const normalizedStartTime = activity_start_time || currentActivity.activity_start_time;
    const normalizedEndDate = normalizedEndDateInput || currentActivity.activity_end_date;
    const normalizedEndTime = activity_end_time || currentActivity.activity_end_time;

    // Validate times if provided
    if (meeting_time_going && departure_time_going && meeting_time_going >= departure_time_going) {
      return error(res, 'Departure time must be after meeting time', 400);
    }

    if (meeting_time_return && departure_time_return && meeting_time_return >= departure_time_return) {
      return error(res, 'Return departure time must be after return meeting time', 400);
    }

    if (normalizedStartDate && normalizedStartTime && normalizedEndDate && normalizedEndTime) {
      const startStamp = `${normalizedStartDate}T${normalizedStartTime}`;
      const endStamp = `${normalizedEndDate}T${normalizedEndTime}`;
      if (endStamp < startStamp) {
        return error(res, 'Activity end must be after start', 400);
      }
    }

    const result = await pool.query(
      `UPDATE activities SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        activity_date = COALESCE($3, activity_date),
        activity_start_date = COALESCE($4, activity_start_date),
        activity_start_time = COALESCE($5, activity_start_time),
        activity_end_date = COALESCE($6, activity_end_date),
        activity_end_time = COALESCE($7, activity_end_time),
        meeting_location_going = COALESCE($8, meeting_location_going),
        meeting_time_going = COALESCE($9, meeting_time_going),
        departure_time_going = COALESCE($10, departure_time_going),
        meeting_location_return = COALESCE($11, meeting_location_return),
        meeting_time_return = COALESCE($12, meeting_time_return),
        departure_time_return = COALESCE($13, departure_time_return),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14 AND organization_id = $15
      RETURNING *`,
      [
        name, description, normalizedActivityDate,
        normalizedStartDateInput, activity_start_time, normalizedEndDateInput, activity_end_time,
        meeting_location_going, meeting_time_going, departure_time_going,
        meeting_location_return, meeting_time_return, departure_time_return,
        id, organizationId
      ]
    );

    // Send email notifications to affected users about activity changes
    if (shouldNotifyParticipants) {
      const { sendActivityUpdateNotifications } = require('../utils/carpool-notifications');
      await sendActivityUpdateNotifications(pool, id, organizationId);
    }

    return success(res, result.rows[0], 'Activity updated successfully');
  }));

  /**
   * Soft delete an activity
   * Accessible by: animation, admin only
   */
  router.delete('/:id', authenticate, blockDemoRoles, requirePermission('activities.delete'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `UPDATE activities
       SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organization_id = $2
       RETURNING id`,
      [id, organizationId]
    );

    if (result.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    // Send email notifications about activity cancellation
    const { sendActivityCancellationNotifications } = require('../utils/carpool-notifications');
    await sendActivityCancellationNotifications(pool, id, organizationId);

    return success(res, null, 'Activity deleted successfully');
  }));

  /**
   * Get participants for an activity (for carpool assignment)
   * Accessible by: animation, admin, parent
   */
  router.get('/:id/participants', authenticate, requirePermission('activities.view'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    // Verify activity exists
    const activityCheck = await pool.query(
      'SELECT id FROM activities WHERE id = $1 AND organization_id = $2 AND is_active = TRUE',
      [id, organizationId]
    );

    if (activityCheck.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    // Get all participants in the organization with their carpool assignment status
    const result = await pool.query(
      `SELECT
        p.id,
        p.first_name,
        p.last_name,
        po.organization_id,
        COALESCE(
          (
            SELECT json_agg(DISTINCT guardian_info)
            FROM (
              SELECT jsonb_build_object(
                'user_id', up.user_id,
                'guardian_name', u.full_name,
                'guardian_email', u.email
              ) as guardian_info
              FROM user_participants up
              LEFT JOIN users u ON up.user_id = u.id
              WHERE up.participant_id = p.id AND up.user_id IS NOT NULL
            ) guardians_subquery
          ),
          '[]'
        ) as guardians,
        COALESCE(
          (
            SELECT json_agg(DISTINCT assignment_info)
            FROM (
              SELECT jsonb_build_object(
                'assignment_id', ca.id,
                'carpool_offer_id', ca.carpool_offer_id,
                'trip_direction', ca.trip_direction,
                'driver_name', driver.full_name,
                'vehicle_make', co.vehicle_make,
                'vehicle_color', co.vehicle_color
              ) as assignment_info
              FROM carpool_assignments ca
              LEFT JOIN carpool_offers co ON ca.carpool_offer_id = co.id AND co.activity_id = $1 AND co.is_active = TRUE
              LEFT JOIN users driver ON co.user_id = driver.id
              WHERE ca.participant_id = p.id AND ca.id IS NOT NULL
            ) assignments_subquery
          ),
          '[]'
        ) as carpool_assignments
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       WHERE po.organization_id = $2
       ORDER BY p.last_name, p.first_name`,
      [id, organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * Get upcoming multi-day activities that may need offline preparation
   * Returns activities that span 2+ days and are within the next 30 days
   * Accessible by: animation, admin, parent
   */
  router.get('/upcoming-camps', authenticate, requirePermission('activities.view'), asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const today = new Date().toISOString().split('T')[0];
    const lookAheadDays = parseInt(req.query.look_ahead) || 30;

    const result = await pool.query(
      `SELECT id, name, description,
              activity_start_date::text as activity_start_date,
              activity_end_date::text as activity_end_date,
              activity_start_time::text as activity_start_time,
              activity_end_time::text as activity_end_time,
              meeting_location_going,
              (activity_end_date::date - activity_start_date::date + 1) as day_count
       FROM activities
       WHERE organization_id = $1
         AND is_active = TRUE
         AND activity_end_date >= $2::date
         AND activity_start_date <= ($2::date + $3)
         AND (activity_end_date::date - activity_start_date::date) >= 1
       ORDER BY activity_start_date ASC`,
      [organizationId, today, lookAheadDays]
    );

    return success(res, result.rows);
  }));

  return router;
};
