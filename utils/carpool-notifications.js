// Email notification utilities for carpool module
const { sendEmail } = require('./index');

/**
 * Send email notifications to affected guardians when a ride is cancelled
 * @param {Object} pool - Database connection pool
 * @param {Array} affectedParticipants - Array of affected participants with guardian info
 */
async function sendRideCancellationNotifications(pool, affectedParticipants) {
  const emailPromises = affectedParticipants.map(async (participant) => {
    const subject = `Carpool Ride Cancelled - ${participant.activity_name}`;
    const message = `
Hello ${participant.guardian_name},

The carpool ride for ${participant.participant_name} has been cancelled for the activity "${participant.activity_name}" on ${new Date(participant.activity_date).toLocaleDateString()}.

Please make alternative transportation arrangements for your child.

You can view and arrange new carpool options in the Wampums parent portal.

Best regards,
Wampums Team
    `.trim();

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #d9534f;">Carpool Ride Cancelled</h2>
  <p>Hello ${participant.guardian_name},</p>
  <p>The carpool ride for <strong>${participant.participant_name}</strong> has been cancelled for the activity:</p>
  <div style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #d9534f; margin: 20px 0;">
    <h3 style="margin-top: 0;">${participant.activity_name}</h3>
    <p style="margin-bottom: 0;"><strong>Date:</strong> ${new Date(participant.activity_date).toLocaleDateString()}</p>
  </div>
  <p><strong>Please make alternative transportation arrangements for your child.</strong></p>
  <p>You can view and arrange new carpool options in the Wampums parent portal.</p>
  <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
  <p style="color: #6c757d; font-size: 14px;">Best regards,<br>Wampums Team</p>
</div>
    `.trim();

    try {
      await sendEmail(participant.guardian_email, subject, message, html);
    } catch (err) {
      console.error(`Failed to send cancellation email to ${participant.guardian_email}:`, err);
    }
  });

  await Promise.allSettled(emailPromises);
}

/**
 * Send email notifications when activity details are updated
 * @param {Object} pool - Database connection pool
 * @param {Number} activityId - ID of the updated activity
 * @param {Number} organizationId - Organization ID
 */
async function sendActivityUpdateNotifications(pool, activityId, organizationId) {
  // Get all users who have carpool assignments for this activity
  const result = await pool.query(
    `SELECT DISTINCT
      u.email,
      u.full_name as guardian_name,
      a.name as activity_name,
      a.activity_date,
      a.meeting_location_going,
      a.meeting_time_going,
      a.departure_time_going,
      a.meeting_location_return,
      a.meeting_time_return,
      a.departure_time_return
     FROM users u
     JOIN user_participants up ON u.id = up.user_id
     JOIN carpool_assignments ca ON up.participant_id = ca.participant_id
     JOIN carpool_offers co ON ca.carpool_offer_id = co.id
     JOIN activities a ON co.activity_id = a.id
     WHERE a.id = $1 AND a.organization_id = $2

     UNION

     SELECT DISTINCT
      u.email,
      u.full_name as guardian_name,
      a.name as activity_name,
      a.activity_date,
      a.meeting_location_going,
      a.meeting_time_going,
      a.departure_time_going,
      a.meeting_location_return,
      a.meeting_time_return,
      a.departure_time_return
     FROM users u
     JOIN carpool_offers co ON u.id = co.user_id
     JOIN activities a ON co.activity_id = a.id
     WHERE a.id = $1 AND a.organization_id = $2 AND co.is_active = TRUE`,
    [activityId, organizationId]
  );

  if (result.rows.length === 0) {
    return; // No one to notify
  }

  const activity = result.rows[0]; // Activity details are the same for all rows

  const emailPromises = result.rows.map(async (user) => {
    const subject = `Activity Updated - ${activity.activity_name}`;
    const message = `
Hello ${user.guardian_name},

The details for "${activity.activity_name}" on ${new Date(activity.activity_date).toLocaleDateString()} have been updated.

Going:
- Meeting Location: ${activity.meeting_location_going}
- Meeting Time: ${activity.meeting_time_going}
- Departure Time: ${activity.departure_time_going}

${activity.meeting_location_return ? `
Returning:
- Meeting Location: ${activity.meeting_location_return}
- Meeting Time: ${activity.meeting_time_return}
- Departure Time: ${activity.departure_time_return}
` : ''}

Please review the updated information in the Wampums portal.

Best regards,
Wampums Team
    `.trim();

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #0275d8;">Activity Updated</h2>
  <p>Hello ${user.guardian_name},</p>
  <p>The details for the following activity have been updated:</p>
  <div style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #0275d8; margin: 20px 0;">
    <h3 style="margin-top: 0;">${activity.activity_name}</h3>
    <p><strong>Date:</strong> ${new Date(activity.activity_date).toLocaleDateString()}</p>

    <h4 style="margin-bottom: 10px;">Going:</h4>
    <ul style="margin-top: 0;">
      <li><strong>Meeting Location:</strong> ${activity.meeting_location_going}</li>
      <li><strong>Meeting Time:</strong> ${activity.meeting_time_going}</li>
      <li><strong>Departure Time:</strong> ${activity.departure_time_going}</li>
    </ul>

    ${activity.meeting_location_return ? `
    <h4 style="margin-bottom: 10px;">Returning:</h4>
    <ul style="margin-top: 0;">
      <li><strong>Meeting Location:</strong> ${activity.meeting_location_return}</li>
      <li><strong>Meeting Time:</strong> ${activity.meeting_time_return}</li>
      <li><strong>Departure Time:</strong> ${activity.departure_time_return}</li>
    </ul>
    ` : ''}
  </div>
  <p>Please review the updated information in the Wampums portal.</p>
  <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
  <p style="color: #6c757d; font-size: 14px;">Best regards,<br>Wampums Team</p>
</div>
    `.trim();

    try {
      await sendEmail(user.email, subject, message, html);
    } catch (err) {
      console.error(`Failed to send update email to ${user.email}:`, err);
    }
  });

  await Promise.allSettled(emailPromises);
}

/**
 * Send email notifications when an activity is cancelled
 * @param {Object} pool - Database connection pool
 * @param {Number} activityId - ID of the cancelled activity
 * @param {Number} organizationId - Organization ID
 */
async function sendActivityCancellationNotifications(pool, activityId, organizationId) {
  // Get all users who have carpool assignments for this activity
  const result = await pool.query(
    `SELECT DISTINCT
      u.email,
      u.full_name as guardian_name,
      a.name as activity_name,
      a.activity_date
     FROM users u
     JOIN user_participants up ON u.id = up.user_id
     JOIN carpool_assignments ca ON up.participant_id = ca.participant_id
     JOIN carpool_offers co ON ca.carpool_offer_id = co.id
     JOIN activities a ON co.activity_id = a.id
     WHERE a.id = $1 AND a.organization_id = $2

     UNION

     SELECT DISTINCT
      u.email,
      u.full_name as guardian_name,
      a.name as activity_name,
      a.activity_date
     FROM users u
     JOIN carpool_offers co ON u.id = co.user_id
     JOIN activities a ON co.activity_id = a.id
     WHERE a.id = $1 AND a.organization_id = $2 AND co.is_active = TRUE`,
    [activityId, organizationId]
  );

  if (result.rows.length === 0) {
    return; // No one to notify
  }

  const activity = result.rows[0]; // Activity details are the same for all rows

  const emailPromises = result.rows.map(async (user) => {
    const subject = `Activity Cancelled - ${activity.activity_name}`;
    const message = `
Hello ${user.guardian_name},

The activity "${activity.activity_name}" scheduled for ${new Date(activity.activity_date).toLocaleDateString()} has been cancelled.

All related carpool arrangements have been cancelled as well.

We apologize for any inconvenience.

Best regards,
Wampums Team
    `.trim();

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #d9534f;">Activity Cancelled</h2>
  <p>Hello ${user.guardian_name},</p>
  <div style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #d9534f; margin: 20px 0;">
    <h3 style="margin-top: 0;">${activity.activity_name}</h3>
    <p style="margin-bottom: 0;"><strong>Date:</strong> ${new Date(activity.activity_date).toLocaleDateString()}</p>
  </div>
  <p>This activity has been cancelled. All related carpool arrangements have been cancelled as well.</p>
  <p>We apologize for any inconvenience.</p>
  <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
  <p style="color: #6c757d; font-size: 14px;">Best regards,<br>Wampums Team</p>
</div>
    `.trim();

    try {
      await sendEmail(user.email, subject, message, html);
    } catch (err) {
      console.error(`Failed to send cancellation email to ${user.email}:`, err);
    }
  });

  await Promise.allSettled(emailPromises);
}

module.exports = {
  sendRideCancellationNotifications,
  sendActivityUpdateNotifications,
  sendActivityCancellationNotifications
};
