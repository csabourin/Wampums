// Email notification utilities for carpool module
const {
  sendEmail,
  getUserEmailLanguage,
  getTranslationsByCode,
  sanitizeInput
} = require('./index');
const { escapeHtml } = require('./api-helpers');
const { resolveOrganizationEmailSender } = require('../services/emailSender');

const fallbackTranslations = getTranslationsByCode('en');

/** A calendar date without a time, as PostgreSQL sends a DATE column as text. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Format a date value according to locale for email templates.
 * @param {string|Date} dateValue - Date string or Date instance.
 * @param {string} locale - Locale code (e.g., en, fr).
 * @returns {string}
 */
function formatEmailDate(dateValue, locale) {
  const safeLocale = (locale || 'en').slice(0, 2).toLowerCase();
  // A date alone ("2026-11-22") is a calendar day, not UTC midnight: read as UTC,
  // it would show the day before anywhere in the Americas.
  const date = typeof dateValue === 'string' && DATE_ONLY_PATTERN.test(dateValue)
    ? new Date(`${dateValue}T12:00:00`)
    : new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(safeLocale, { dateStyle: 'long' }).format(date);
}

/**
 * Email texts for one unit, in each recipient's language. An optional language's
 * bundle may be partial: a missing key falls back to the unit's fallback language
 * (`interface_languages.fallback`, French or English), then to English.
 *
 * @param {Object} pool - Database connection pool
 * @param {number} organizationId - Unit whose fallback language applies
 * @returns {Promise<function(string): function(string, Object=): string>} Translator for a language
 */
async function loadEmailTranslator(pool, organizationId) {
  let fallback = 'en';
  try {
    const result = await pool.query(
      `SELECT setting_value FROM organization_settings
       WHERE organization_id = $1 AND setting_key = 'interface_languages'`,
      [organizationId]
    );
    const raw = result.rows[0]?.setting_value;
    const setting = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (setting?.fallback === 'fr' || setting?.fallback === 'en') {
      fallback = setting.fallback;
    }
  } catch (err) {
    console.error(`Could not read the language fallback of unit ${organizationId}:`, err);
  }
  const fallbackBundle = getTranslationsByCode(fallback);
  return (language) => {
    const bundle = getTranslationsByCode(language);
    return (key, values = {}) => Object.entries(values).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(value ?? ''),
      bundle[key] ?? fallbackBundle[key] ?? fallbackTranslations[key] ?? key
    );
  };
}

/**
 * One cancellation email, as text and HTML, in the recipient's language.
 *
 * @param {Object} parts - Already translated texts
 * @param {string} parts.heading - Title of the HTML email
 * @param {string} parts.greeting - "Hello {name},"
 * @param {string} parts.activity - Activity name
 * @param {string} parts.dateLabel - Label of the date line
 * @param {string} parts.date - Date, formatted for the recipient
 * @param {string[]} parts.paragraphs - Body paragraphs
 * @param {string} parts.signature - Closing lines
 * @returns {{text: string, html: string}} The email bodies
 */
function buildCancellationEmail({ heading, greeting, activity, dateLabel, date, paragraphs, signature }) {
  const text = [greeting, ...paragraphs, signature].join('\n\n');
  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #d9534f;">${escapeHtml(heading)}</h2>
  <p>${escapeHtml(greeting)}</p>
  <div style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #d9534f; margin: 20px 0;">
    <h3 style="margin-top: 0;">${escapeHtml(activity)}</h3>
    <p style="margin-bottom: 0;"><strong>${escapeHtml(dateLabel)}:</strong> ${escapeHtml(date)}</p>
  </div>
  ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n  ')}
  <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
  <p style="color: #6c757d; font-size: 14px;">${escapeHtml(signature).replace(/\n/g, '<br>')}</p>
</div>
  `.trim();
  return { text, html };
}

/**
 * Send email notifications to affected guardians when a ride is cancelled,
 * each in the guardian's language.
 * @param {Object} pool - Database connection pool
 * @param {Array} affectedParticipants - Array of affected participants with guardian info
 * @param {Number} organizationId - Organization ID, whose sender identity the emails use
 */
async function sendRideCancellationNotifications(pool, affectedParticipants, organizationId) {
  const sender = await resolveOrganizationEmailSender(pool, organizationId);
  const translatorFor = await loadEmailTranslator(pool, organizationId);
  const emailPromises = affectedParticipants.map(async (participant) => {
    try {
      const language = await getUserEmailLanguage(pool, participant.guardian_email, organizationId);
      const t = translatorFor(language);
      const activity = sanitizeInput(participant.activity_name);
      const date = formatEmailDate(participant.activity_date, language);
      const name = sanitizeInput(participant.guardian_name) || t('activity_update_email_generic_name');
      const { text, html } = buildCancellationEmail({
        heading: t('carpool_ride_cancelled_email_heading'),
        greeting: t('activity_update_email_greeting', { name }),
        activity,
        dateLabel: t('activity_update_email_date_label'),
        date,
        paragraphs: [
          t('carpool_ride_cancelled_email_intro', { participant: sanitizeInput(participant.participant_name), activity, date }),
          t('carpool_ride_cancelled_email_action'),
          t('carpool_ride_cancelled_email_portal'),
        ],
        signature: t('activity_update_email_signature'),
      });
      await sendEmail(participant.guardian_email, t('carpool_ride_cancelled_email_subject', { activity }), text, html, sender);
    } catch (err) {
      console.error('Failed to send a carpool cancellation email:', err);
    }
  });

  await Promise.allSettled(emailPromises);
}

/**
 * Send email notifications when activity details are updated
 * @param {Object} pool - Database connection pool
 * @param {Number} activityId - ID of the updated activity
 * @param {Number} organizationId - Organization ID
 * @param {Object} [options]
 * @param {boolean} [options.wholeUnit=false] - Also reach every family of the
 *   unit: the edit opened an activity for some participants to everyone, so
 *   families who were not invited are newly concerned
 */
async function sendActivityUpdateNotifications(pool, activityId, organizationId, { wholeUnit = false } = {}) {
  // Everyone the activity concerns: guardians of children riding in its
  // carpools, holding one of its permission slips or on its invitation list,
  // and its drivers. A child
  // can be enrolled in several units, so only accounts that are active members
  // of this activity's unit hear about it.
  const result = await pool.query(
    `WITH recipients AS (
       SELECT up.user_id
         FROM user_participants up
         JOIN carpool_assignments ca ON ca.participant_id = up.participant_id
         JOIN carpool_offers co ON co.id = ca.carpool_offer_id
        WHERE co.activity_id = $1

       UNION

       SELECT co.user_id
         FROM carpool_offers co
        WHERE co.activity_id = $1 AND co.is_active = TRUE

       UNION

       SELECT up.user_id
         FROM user_participants up
         JOIN permission_slips ps ON ps.participant_id = up.participant_id
         JOIN activities sa ON sa.id = ps.activity_id
        WHERE ps.activity_id = $1
          AND ps.organization_id = $2
          AND ps.status IN ('pending', 'signed')
          -- A signed slip outlives its child's invitation; only invitees hear
          AND (sa.invites_everyone
               OR ps.participant_id IN (SELECT participant_id FROM activity_invitees WHERE activity_id = $1))

       UNION

       -- An activity for some participants concerns every invited family,
       -- including those invited by this very edit
       SELECT up.user_id
         FROM user_participants up
         JOIN activity_invitees ai ON ai.participant_id = up.participant_id
        WHERE ai.activity_id = $1 AND ai.organization_id = $2

       UNION

       -- Opened to the whole unit: every enrolled child's family
       SELECT up.user_id
         FROM user_participants up
         JOIN participant_organizations po ON po.participant_id = up.participant_id
        WHERE $3::boolean AND po.organization_id = $2
     )
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
     FROM recipients r
     JOIN users u ON u.id = r.user_id
     JOIN user_organizations uo
       ON uo.user_id = u.id AND uo.organization_id = $2 AND uo.status = 'active'
     JOIN activities a ON a.id = $1 AND a.organization_id = $2
     WHERE u.email IS NOT NULL AND u.email <> ''`,
    [activityId, organizationId, wholeUnit]
  );

  if (result.rows.length === 0) {
    return; // No one to notify
  }

  const activity = result.rows[0]; // Activity details are the same for all rows

  const sender = await resolveOrganizationEmailSender(pool, organizationId);
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
      await sendEmail(user.email, subject, message, html, sender);
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
     -- user_participants has no unit: only guardians active in this unit.
     JOIN user_organizations uo
       ON uo.user_id = u.id AND uo.organization_id = $2 AND uo.status = 'active'
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

  const sender = await resolveOrganizationEmailSender(pool, organizationId);
  const translatorFor = await loadEmailTranslator(pool, organizationId);
  const emailPromises = result.rows.map(async (user) => {
    try {
      const language = await getUserEmailLanguage(pool, user.email, organizationId);
      const t = translatorFor(language);
      const activityName = sanitizeInput(activity.activity_name);
      const date = formatEmailDate(activity.activity_date, language);
      const name = sanitizeInput(user.guardian_name) || t('activity_update_email_generic_name');
      const { text, html } = buildCancellationEmail({
        heading: t('activity_cancelled_email_heading'),
        greeting: t('activity_update_email_greeting', { name }),
        activity: activityName,
        dateLabel: t('activity_update_email_date_label'),
        date,
        paragraphs: [
          t('activity_cancelled_email_intro', { activity: activityName, date }),
          t('activity_cancelled_email_carpools'),
          t('activity_cancelled_email_apology'),
        ],
        signature: t('activity_update_email_signature'),
      });
      await sendEmail(user.email, t('activity_cancelled_email_subject', { activity: activityName }), text, html, sender);
    } catch (err) {
      console.error('Failed to send an activity cancellation email:', err);
    }
  });

  await Promise.allSettled(emailPromises);
}

module.exports = {
  sendRideCancellationNotifications,
  sendActivityUpdateNotifications,
  sendActivityCancellationNotifications
};
