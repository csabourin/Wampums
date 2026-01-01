// Email notification utilities for carpool module
const {
  sendEmail,
  getUserEmailLanguage,
  getTranslationsByCode,
  sanitizeInput
} = require('./index');
const { escapeHtml } = require('./api-helpers');

const fallbackTranslations = getTranslationsByCode('en');

/**
 * Format a date value according to locale for email templates.
 * @param {string|Date} dateValue - Date string or Date instance.
 * @param {string} locale - Locale code (e.g., en, fr).
 * @returns {string}
 */
function formatEmailDate(dateValue, locale) {
  const safeLocale = (locale || 'en').slice(0, 2).toLowerCase();
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(safeLocale, { dateStyle: 'long' }).format(date);
}

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
    const preferredLanguage = await getUserEmailLanguage(pool, user.email, organizationId);
    const translations = getTranslationsByCode(preferredLanguage);
    const localeDate = formatEmailDate(activity.activity_date, preferredLanguage);
    const safeGuardianName = sanitizeInput(user.guardian_name)
      || translations.activity_update_email_generic_name
      || fallbackTranslations.activity_update_email_generic_name
      || '';
    const safeActivityName = sanitizeInput(activity.activity_name);
    const safeDate = sanitizeInput(localeDate);

    const subjectTemplate = translations.activity_update_email_subject
      || fallbackTranslations.activity_update_email_subject
      || 'Activity Updated - {activity}';
    const greetingTemplate = translations.activity_update_email_greeting
      || fallbackTranslations.activity_update_email_greeting
      || 'Hello {name},';
    const introTemplate = translations.activity_update_email_intro
      || fallbackTranslations.activity_update_email_intro
      || 'The details for "{activity}" on {date} have been updated.';
    const goingHeading = translations.activity_update_email_going_heading
      || fallbackTranslations.activity_update_email_going_heading
      || 'Going:';
    const returnHeading = translations.activity_update_email_return_heading
      || fallbackTranslations.activity_update_email_return_heading
      || 'Returning:';
    const meetingLocationLabel = translations.activity_update_email_meeting_location
      || fallbackTranslations.activity_update_email_meeting_location
      || 'Meeting Location';
    const meetingTimeLabel = translations.activity_update_email_meeting_time
      || fallbackTranslations.activity_update_email_meeting_time
      || 'Meeting Time';
    const departureTimeLabel = translations.activity_update_email_departure_time
      || fallbackTranslations.activity_update_email_departure_time
      || 'Departure Time';
    const reviewPrompt = translations.activity_update_email_footer
      || fallbackTranslations.activity_update_email_footer
      || 'Please review the updated information in the Wampums portal.';
    const signature = translations.activity_update_email_signature
      || fallbackTranslations.activity_update_email_signature
      || 'Best regards,\nWampums Team';

    const subject = subjectTemplate.replace('{activity}', safeActivityName);
    const greeting = greetingTemplate.replace('{name}', safeGuardianName);
    const intro = introTemplate
      .replace('{activity}', safeActivityName)
      .replace('{date}', safeDate);

    const message = `
${greeting}

${intro}

${goingHeading}
- ${meetingLocationLabel}: ${sanitizeInput(activity.meeting_location_going)}
- ${meetingTimeLabel}: ${sanitizeInput(activity.meeting_time_going)}
- ${departureTimeLabel}: ${sanitizeInput(activity.departure_time_going)}

${activity.meeting_location_return ? `
${returnHeading}
- ${meetingLocationLabel}: ${sanitizeInput(activity.meeting_location_return)}
- ${meetingTimeLabel}: ${sanitizeInput(activity.meeting_time_return)}
- ${departureTimeLabel}: ${sanitizeInput(activity.departure_time_return)}
` : ''}

${reviewPrompt}

${signature}
    `.trim();

    const safeActivityNameHtml = escapeHtml(activity.activity_name);
    const safeDateHtml = escapeHtml(safeDate);

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #0275d8;">${escapeHtml(translations.activity_update_email_heading || fallbackTranslations.activity_update_email_heading || 'Activity Updated')}</h2>
  <p>${escapeHtml(greeting)}</p>
  <p>${escapeHtml(intro)}</p>
  <div style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #0275d8; margin: 20px 0;">
    <h3 style="margin-top: 0;">${safeActivityNameHtml}</h3>
    <p><strong>${escapeHtml(translations.activity_update_email_date_label || fallbackTranslations.activity_update_email_date_label || 'Date')}:</strong> ${safeDateHtml}</p>

    <h4 style="margin-bottom: 10px;">${escapeHtml(goingHeading)}</h4>
    <ul style="margin-top: 0;">
      <li><strong>${escapeHtml(meetingLocationLabel)}:</strong> ${escapeHtml(activity.meeting_location_going || '')}</li>
      <li><strong>${escapeHtml(meetingTimeLabel)}:</strong> ${escapeHtml(activity.meeting_time_going || '')}</li>
      <li><strong>${escapeHtml(departureTimeLabel)}:</strong> ${escapeHtml(activity.departure_time_going || '')}</li>
    </ul>

    ${activity.meeting_location_return ? `
    <h4 style="margin-bottom: 10px;">${escapeHtml(returnHeading)}</h4>
    <ul style="margin-top: 0;">
      <li><strong>${escapeHtml(meetingLocationLabel)}:</strong> ${escapeHtml(activity.meeting_location_return || '')}</li>
      <li><strong>${escapeHtml(meetingTimeLabel)}:</strong> ${escapeHtml(activity.meeting_time_return || '')}</li>
      <li><strong>${escapeHtml(departureTimeLabel)}:</strong> ${escapeHtml(activity.departure_time_return || '')}</li>
    </ul>
    ` : ''}
  </div>
  <p>${escapeHtml(reviewPrompt)}</p>
  <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
  <p style="color: #6c757d; font-size: 14px;">${escapeHtml(signature).replace(/\n/g, '<br>')}</p>
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
