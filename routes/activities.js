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
        COUNT(DISTINCT ca.participant_id) as assigned_participant_count
       FROM activities a
       LEFT JOIN users u ON a.created_by = u.id
       LEFT JOIN carpool_offers co ON a.id = co.activity_id AND co.is_active = TRUE
       LEFT JOIN carpool_assignments ca ON co.id = ca.carpool_offer_id
       WHERE a.organization_id = $1 AND a.is_active = TRUE
       GROUP BY a.id, u.full_name
       ORDER BY a.activity_date ASC, a.departure_time_going ASC`,
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

    const {
      name,
      description,
      activity_date,
      meeting_location_going,
      meeting_time_going,
      departure_time_going,
      meeting_location_return,
      meeting_time_return,
      departure_time_return
    } = req.body;

    // Validation
    if (!name || !activity_date || !meeting_location_going || !meeting_time_going || !departure_time_going) {
      return error(res, 'Missing required fields: name, activity_date, meeting_location_going, meeting_time_going, departure_time_going', 400);
    }

    // Validate that departure time is after meeting time
    if (meeting_time_going >= departure_time_going) {
      return error(res, 'Departure time must be after meeting time', 400);
    }

    // If return trip is specified, validate those times too
    if (meeting_time_return && departure_time_return && meeting_time_return >= departure_time_return) {
      return error(res, 'Return departure time must be after return meeting time', 400);
    }

    const result = await pool.query(
      `INSERT INTO activities (
        organization_id, created_by, name, description, activity_date,
        meeting_location_going, meeting_time_going, departure_time_going,
        meeting_location_return, meeting_time_return, departure_time_return
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        organizationId, userId, name, description, activity_date,
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
      meeting_location_going,
      meeting_time_going,
      departure_time_going,
      meeting_location_return,
      meeting_time_return,
      departure_time_return
    } = req.body;

    // Check if activity exists and belongs to organization
    const existingActivity = await pool.query(
      'SELECT id FROM activities WHERE id = $1 AND organization_id = $2 AND is_active = TRUE',
      [id, organizationId]
    );

    if (existingActivity.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    // Validate times if provided
    if (meeting_time_going && departure_time_going && meeting_time_going >= departure_time_going) {
      return error(res, 'Departure time must be after meeting time', 400);
    }

    if (meeting_time_return && departure_time_return && meeting_time_return >= departure_time_return) {
      return error(res, 'Return departure time must be after return meeting time', 400);
    }

    const result = await pool.query(
      `UPDATE activities SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        activity_date = COALESCE($3, activity_date),
        meeting_location_going = COALESCE($4, meeting_location_going),
        meeting_time_going = COALESCE($5, meeting_time_going),
        departure_time_going = COALESCE($6, departure_time_going),
        meeting_location_return = COALESCE($7, meeting_location_return),
        meeting_time_return = COALESCE($8, meeting_time_return),
        departure_time_return = COALESCE($9, departure_time_return),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10 AND organization_id = $11
      RETURNING *`,
      [
        name, description, activity_date,
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

  return router;
};
