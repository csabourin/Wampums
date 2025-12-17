// RESTful routes for carpool offers and assignments
const express = require('express');
const router = express.Router();
const { authenticate, authorize, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

module.exports = (pool) => {
  /**
   * Get all carpool offers for an activity
   * Accessible by: animation, admin, parent
   */
  router.get('/activity/:activityId', authenticate, asyncHandler(async (req, res) => {
    const { activityId } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT
        co.*,
        u.full_name as driver_name,
        u.email as driver_email,
        COUNT(DISTINCT ca.participant_id) FILTER (WHERE ca.trip_direction IN ('both', 'to_activity')) as seats_used_going,
        COUNT(DISTINCT ca.participant_id) FILTER (WHERE ca.trip_direction IN ('both', 'from_activity')) as seats_used_return,
        json_agg(
          DISTINCT jsonb_build_object(
            'assignment_id', ca.id,
            'participant_id', ca.participant_id,
            'participant_name', p.first_name || ' ' || p.last_name,
            'trip_direction', ca.trip_direction,
            'assigned_by', ca.assigned_by,
            'assigned_by_name', assigner.full_name
          )
        ) FILTER (WHERE ca.id IS NOT NULL) as assignments
       FROM carpool_offers co
       JOIN users u ON co.user_id = u.id
       LEFT JOIN carpool_assignments ca ON co.id = ca.carpool_offer_id
       LEFT JOIN participants p ON ca.participant_id = p.id
       LEFT JOIN users assigner ON ca.assigned_by = assigner.id
       WHERE co.activity_id = $1 AND co.organization_id = $2 AND co.is_active = TRUE
       GROUP BY co.id, u.full_name, u.email
       ORDER BY co.created_at DESC`,
      [activityId, organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * Get user's own carpool offers
   * Accessible by: animation, admin, parent
   */
  router.get('/my-offers', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT
        co.*,
        a.name as activity_name,
        a.activity_date,
        a.departure_time_going,
        COUNT(DISTINCT ca.participant_id) as total_assignments
       FROM carpool_offers co
       JOIN activities a ON co.activity_id = a.id
       LEFT JOIN carpool_assignments ca ON co.id = ca.carpool_offer_id
       WHERE co.user_id = $1 AND co.organization_id = $2 AND co.is_active = TRUE
       GROUP BY co.id, a.name, a.activity_date, a.departure_time_going
       ORDER BY a.activity_date DESC, a.departure_time_going ASC`,
      [userId, organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * Create a new carpool offer
   * Accessible by: animation, admin, parent
   */
  router.post('/offers', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.user.id;

    const {
      activity_id,
      vehicle_make,
      vehicle_color,
      total_seats_available,
      trip_direction,
      notes
    } = req.body;

    // Validation
    if (!activity_id || !vehicle_make || !vehicle_color || !total_seats_available || !trip_direction) {
      return error(res, 'Missing required fields: activity_id, vehicle_make, vehicle_color, total_seats_available, trip_direction', 400);
    }

    // Validate trip direction
    const validDirections = ['both', 'to_activity', 'from_activity'];
    if (!validDirections.includes(trip_direction)) {
      return error(res, 'Invalid trip_direction. Must be one of: both, to_activity, from_activity', 400);
    }

    // Validate seat count
    if (total_seats_available < 1 || total_seats_available > 8) {
      return error(res, 'total_seats_available must be between 1 and 8', 400);
    }

    // Check if activity exists and belongs to organization
    const activityCheck = await pool.query(
      'SELECT id FROM activities WHERE id = $1 AND organization_id = $2 AND is_active = TRUE',
      [activity_id, organizationId]
    );

    if (activityCheck.rows.length === 0) {
      return error(res, 'Activity not found', 404);
    }

    // Check if user already has an offer for this activity with the same direction
    const existingOffer = await pool.query(
      `SELECT id FROM carpool_offers
       WHERE activity_id = $1 AND user_id = $2 AND is_active = TRUE
       AND (trip_direction = $3 OR trip_direction = 'both' OR $3 = 'both')`,
      [activity_id, userId, trip_direction]
    );

    if (existingOffer.rows.length > 0) {
      return error(res, 'You already have an active carpool offer for this activity and direction', 400);
    }

    const result = await pool.query(
      `INSERT INTO carpool_offers (
        activity_id, user_id, organization_id,
        vehicle_make, vehicle_color, total_seats_available,
        trip_direction, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        activity_id, userId, organizationId,
        vehicle_make, vehicle_color, total_seats_available,
        trip_direction, notes
      ]
    );

    return success(res, result.rows[0], 'Carpool offer created successfully', 201);
  }));

  /**
   * Update a carpool offer
   * Accessible by: owner of offer, or animation/admin
   */
  router.put('/offers/:id', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.user.id;
    const userRole = req.user.role;

    const {
      vehicle_make,
      vehicle_color,
      total_seats_available,
      trip_direction,
      notes
    } = req.body;

    // Check if offer exists and user has permission
    const offerCheck = await pool.query(
      'SELECT user_id FROM carpool_offers WHERE id = $1 AND organization_id = $2 AND is_active = TRUE',
      [id, organizationId]
    );

    if (offerCheck.rows.length === 0) {
      return error(res, 'Carpool offer not found', 404);
    }

    // Check permission: owner or animation/admin
    const isOwner = offerCheck.rows[0].user_id === userId;
    const isStaff = ['animation', 'admin'].includes(userRole);

    if (!isOwner && !isStaff) {
      return error(res, 'You do not have permission to update this carpool offer', 403);
    }

    // Validate trip direction if provided
    if (trip_direction) {
      const validDirections = ['both', 'to_activity', 'from_activity'];
      if (!validDirections.includes(trip_direction)) {
        return error(res, 'Invalid trip_direction. Must be one of: both, to_activity, from_activity', 400);
      }
    }

    // Validate seat count if provided
    if (total_seats_available && (total_seats_available < 1 || total_seats_available > 8)) {
      return error(res, 'total_seats_available must be between 1 and 8', 400);
    }

    // If reducing seats, check if current assignments exceed new capacity
    if (total_seats_available) {
      const assignmentCount = await pool.query(
        'SELECT COUNT(DISTINCT participant_id) as count FROM carpool_assignments WHERE carpool_offer_id = $1',
        [id]
      );
      if (parseInt(assignmentCount.rows[0].count) > total_seats_available) {
        return error(res, `Cannot reduce seats to ${total_seats_available}. Currently ${assignmentCount.rows[0].count} participants are assigned`, 400);
      }
    }

    const result = await pool.query(
      `UPDATE carpool_offers SET
        vehicle_make = COALESCE($1, vehicle_make),
        vehicle_color = COALESCE($2, vehicle_color),
        total_seats_available = COALESCE($3, total_seats_available),
        trip_direction = COALESCE($4, trip_direction),
        notes = COALESCE($5, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6 AND organization_id = $7
      RETURNING *`,
      [vehicle_make, vehicle_color, total_seats_available, trip_direction, notes, id, organizationId]
    );

    return success(res, result.rows[0], 'Carpool offer updated successfully');
  }));

  /**
   * Cancel/deactivate a carpool offer
   * Accessible by: owner of offer, or animation/admin
   */
  router.delete('/offers/:id', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.user.id;
    const userRole = req.user.role;
    const { reason } = req.body;

    // Check if offer exists and user has permission
    const offerCheck = await pool.query(
      `SELECT co.user_id, co.activity_id
       FROM carpool_offers co
       WHERE co.id = $1 AND co.organization_id = $2 AND co.is_active = TRUE`,
      [id, organizationId]
    );

    if (offerCheck.rows.length === 0) {
      return error(res, 'Carpool offer not found', 404);
    }

    // Check permission: owner or animation/admin
    const isOwner = offerCheck.rows[0].user_id === userId;
    const isStaff = ['animation', 'admin'].includes(userRole);

    if (!isOwner && !isStaff) {
      return error(res, 'You do not have permission to cancel this carpool offer', 403);
    }

    // Get affected participants and their guardians before deactivating
    const affectedResult = await pool.query(
      `SELECT DISTINCT
        p.id as participant_id,
        p.first_name || ' ' || p.last_name as participant_name,
        u.email as guardian_email,
        u.full_name as guardian_name,
        a.name as activity_name,
        a.activity_date
       FROM carpool_assignments ca
       JOIN participants p ON ca.participant_id = p.id
       JOIN user_participants up ON p.id = up.participant_id
       JOIN users u ON up.user_id = u.id
       JOIN carpool_offers co ON ca.carpool_offer_id = co.id
       JOIN activities a ON co.activity_id = a.id
       WHERE ca.carpool_offer_id = $1`,
      [id]
    );

    // Deactivate the offer
    await pool.query(
      `UPDATE carpool_offers
       SET is_active = FALSE,
           cancelled_at = CURRENT_TIMESTAMP,
           cancelled_reason = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND organization_id = $3`,
      [reason || 'Offer cancelled', id, organizationId]
    );

    // Delete all assignments for this offer
    await pool.query(
      'DELETE FROM carpool_assignments WHERE carpool_offer_id = $1',
      [id]
    );

    // Send email notifications to affected guardians
    if (affectedResult.rows.length > 0) {
      const { sendRideCancellationNotifications } = require('../utils/carpool-notifications');
      await sendRideCancellationNotifications(pool, affectedResult.rows);
    }

    return success(res, {
      affected_participants: affectedResult.rows.length
    }, 'Carpool offer cancelled and notifications sent');
  }));

  /**
   * Assign a participant to a carpool
   * Accessible by: parent (own children), animation/admin (any child)
   */
  router.post('/assignments', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.user.id;
    const userRole = req.user.role;

    const {
      carpool_offer_id,
      participant_id,
      trip_direction,
      notes
    } = req.body;

    // Validation
    if (!carpool_offer_id || !participant_id || !trip_direction) {
      return error(res, 'Missing required fields: carpool_offer_id, participant_id, trip_direction', 400);
    }

    // Validate trip direction
    const validDirections = ['both', 'to_activity', 'from_activity'];
    if (!validDirections.includes(trip_direction)) {
      return error(res, 'Invalid trip_direction. Must be one of: both, to_activity, from_activity', 400);
    }

    // Check if carpool offer exists and is active
    const offerCheck = await pool.query(
      `SELECT co.*, u.full_name as driver_name
       FROM carpool_offers co
       JOIN users u ON co.user_id = u.id
       WHERE co.id = $1 AND co.organization_id = $2 AND co.is_active = TRUE`,
      [carpool_offer_id, organizationId]
    );

    if (offerCheck.rows.length === 0) {
      return error(res, 'Carpool offer not found or is not active', 404);
    }

    const offer = offerCheck.rows[0];

    // Check permission: parent can only assign own children, animation/admin can assign any
    const isStaff = ['animation', 'admin'].includes(userRole);
    if (!isStaff) {
      const guardianCheck = await pool.query(
        'SELECT 1 FROM user_participants WHERE user_id = $1 AND participant_id = $2',
        [userId, participant_id]
      );

      if (guardianCheck.rows.length === 0) {
        return error(res, 'You can only assign your own children to carpools', 403);
      }
    }

    // Verify participant belongs to organization
    const participantCheck = await pool.query(
      'SELECT 1 FROM participant_organizations WHERE participant_id = $1 AND organization_id = $2',
      [participant_id, organizationId]
    );

    if (participantCheck.rows.length === 0) {
      return error(res, 'Participant not found in this organization', 404);
    }

    // Check for existing assignment that conflicts with this one
    const existingAssignment = await pool.query(
      `SELECT ca.id, co.trip_direction as offer_direction
       FROM carpool_assignments ca
       JOIN carpool_offers co ON ca.carpool_offer_id = co.id
       WHERE ca.participant_id = $1
         AND co.activity_id = (SELECT activity_id FROM carpool_offers WHERE id = $2)
         AND co.is_active = TRUE
         AND (
           (ca.trip_direction = 'both' OR $3 = 'both')
           OR (ca.trip_direction = 'to_activity' AND $3 IN ('to_activity', 'both'))
           OR (ca.trip_direction = 'from_activity' AND $3 IN ('from_activity', 'both'))
         )`,
      [participant_id, carpool_offer_id, trip_direction]
    );

    if (existingAssignment.rows.length > 0) {
      return error(res, 'Participant is already assigned to a carpool for this trip direction', 400);
    }

    // The database trigger will handle seat availability validation
    try {
      const result = await pool.query(
        `INSERT INTO carpool_assignments (
          carpool_offer_id, participant_id, assigned_by,
          organization_id, trip_direction, notes
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [carpool_offer_id, participant_id, userId, organizationId, trip_direction, notes]
      );

      return success(res, {
        ...result.rows[0],
        driver_name: offer.driver_name
      }, 'Participant assigned to carpool successfully', 201);
    } catch (err) {
      if (err.message.includes('No available seats')) {
        return error(res, err.message, 400);
      }
      if (err.message.includes('Cannot assign')) {
        return error(res, err.message, 400);
      }
      throw err; // Let asyncHandler deal with unexpected errors
    }
  }));

  /**
   * Remove a participant from a carpool assignment
   * Accessible by: parent (own children), animation/admin (any child)
   */
  router.delete('/assignments/:id', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if assignment exists
    const assignmentCheck = await pool.query(
      `SELECT ca.participant_id, ca.assigned_by
       FROM carpool_assignments ca
       WHERE ca.id = $1 AND ca.organization_id = $2`,
      [id, organizationId]
    );

    if (assignmentCheck.rows.length === 0) {
      return error(res, 'Assignment not found', 404);
    }

    const assignment = assignmentCheck.rows[0];

    // Check permission: parent can only remove own children, animation/admin can remove any
    const isStaff = ['animation', 'admin'].includes(userRole);
    if (!isStaff) {
      const guardianCheck = await pool.query(
        'SELECT 1 FROM user_participants WHERE user_id = $1 AND participant_id = $2',
        [userId, assignment.participant_id]
      );

      if (guardianCheck.rows.length === 0) {
        return error(res, 'You can only remove your own children from carpools', 403);
      }
    }

    // Delete the assignment
    await pool.query(
      'DELETE FROM carpool_assignments WHERE id = $1',
      [id]
    );

    return success(res, null, 'Participant removed from carpool');
  }));

  /**
   * Get carpool assignments for current user's children
   * Accessible by: parent
   */
  router.get('/my-children-assignments', authenticate, asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT
        ca.*,
        p.first_name || ' ' || p.last_name as participant_name,
        co.vehicle_make,
        co.vehicle_color,
        co.trip_direction as offer_trip_direction,
        u.full_name as driver_name,
        u.email as driver_email,
        a.name as activity_name,
        a.activity_date,
        a.meeting_location_going,
        a.meeting_time_going,
        a.departure_time_going,
        a.meeting_location_return,
        a.meeting_time_return,
        a.departure_time_return
       FROM carpool_assignments ca
       JOIN participants p ON ca.participant_id = p.id
       JOIN user_participants up ON p.id = up.participant_id
       JOIN carpool_offers co ON ca.carpool_offer_id = co.id
       JOIN users u ON co.user_id = u.id
       JOIN activities a ON co.activity_id = a.id
       WHERE up.user_id = $1
         AND ca.organization_id = $2
         AND co.is_active = TRUE
         AND a.is_active = TRUE
       ORDER BY a.activity_date ASC, a.departure_time_going ASC`,
      [userId, organizationId]
    );

    return success(res, result.rows);
  }));

  /**
   * Get unassigned participants for an activity
   * Accessible by: animation, admin
   */
  router.get('/activity/:activityId/unassigned', authenticate, authorize('animation', 'admin'), asyncHandler(async (req, res) => {
    const { activityId } = req.params;
    const organizationId = await getOrganizationId(req, pool);

    const result = await pool.query(
      `SELECT
        p.id,
        p.first_name,
        p.last_name,
        p.date_of_birth,
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
          WHEN ca_going.participant_id IS NULL THEN FALSE
          ELSE TRUE
        END as has_ride_going,
        CASE
          WHEN ca_return.participant_id IS NULL THEN FALSE
          ELSE TRUE
        END as has_ride_return
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN user_participants up ON p.id = up.participant_id
       LEFT JOIN users u ON up.user_id = u.id
       LEFT JOIN carpool_assignments ca_going ON p.id = ca_going.participant_id
         AND ca_going.trip_direction IN ('both', 'to_activity')
         AND ca_going.carpool_offer_id IN (
           SELECT id FROM carpool_offers WHERE activity_id = $1 AND is_active = TRUE
         )
       LEFT JOIN carpool_assignments ca_return ON p.id = ca_return.participant_id
         AND ca_return.trip_direction IN ('both', 'from_activity')
         AND ca_return.carpool_offer_id IN (
           SELECT id FROM carpool_offers WHERE activity_id = $1 AND is_active = TRUE
         )
       WHERE po.organization_id = $2
       GROUP BY p.id, ca_going.participant_id, ca_return.participant_id
       HAVING ca_going.participant_id IS NULL OR ca_return.participant_id IS NULL
       ORDER BY p.last_name, p.first_name`,
      [activityId, organizationId]
    );

    return success(res, result.rows);
  }));

  return router;
};
