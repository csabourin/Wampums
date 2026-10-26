// Email notification utilities for carpool module
const {
  sendEmail,
  getUserEmailLanguage,
  getTranslationsByCode,
  sanitizeInput
} = require('./index');
const { escapeHtml } = require('./api-helpers');
const { resolveOrganizationEmailSender } = require('../services/emailSender');
const { listActivityLeaderContacts } = require('../services/unitLeaders');

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
 * Everyone an activity email goes to: the people it concerns, and the unit's
 * leaders who follow activities (services/unitLeaders.js), so the team knows
 * what families were told. Each address is written to once, under the first
 * name it came with. Should the leaders fail to load, the families are still
 * told.
 *
 * @param {Object} pool - Database connection pool
 * @param {number} organizationId - Unit of the activity
 * @param {Array<{email: string, name: string}>} concerned - Families and drivers
 * @returns {Promise<Array<{email: string, name: string}>>} Recipients
 */
async function withActivityLeaders(pool, organizationId, concerned) {
  let leaders = [];
  try {
    leaders = await listActivityLeaderContacts(pool, organizationId);
  } catch (err) {
    console.error(`Could not list the activity leaders of unit ${organizationId}:`, err);
  }
  const byAddress = new Map();
  [...concerned, ...leaders.map((leader) => ({ email: leader.email, name: leader.full_name }))]
    .forEach((recipient) => {
      const address = String(recipient.email || '').trim().toLowerCase();
      if (address && !byAddress.has(address)) {
        byAddress.set(address, recipient);
      }
    });
  return [...byAddress.values()];
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
 * The accounts an activity concerns, with an address to write to: guardians of
 * children riding in its carpools, holding one of its permission slips or on
 * its invitation list, and its drivers. A child can be enrolled in several
 * units, so only accounts that are active members of the activity's unit count.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db - Pool or client
 * @param {number} activityId - Activity
 * @param {number} organizationId - Unit of the activity
 * @param {Object} [options]
 * @param {boolean} [options.wholeUnit=false] - Also every family of the unit
 * @returns {Promise<Array<{email: string, name: string}>>} Accounts
 */
async function listConcernedAccounts(db, activityId, organizationId, { wholeUnit = false } = {}) {
  const result = await db.query(
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
     SELECT DISTINCT u.email, u.full_name AS name
     FROM recipients r
     JOIN users u ON u.id = r.user_id
     JOIN user_organizations uo
       ON uo.user_id = u.id AND uo.organization_id = $2 AND uo.status = 'active'
     WHERE u.email IS NOT NULL AND u.email <> ''`,
    [activityId, organizationId, wholeUnit]
  );
  return result.rows;
}

/**
 * Send email notifications when activity details are updated, to the families
 * and drivers it concerns and to the unit's leaders who follow activities
 * @param {Object} pool - Database connection pool
 * @param {Number} activityId - ID of the updated activity
 * @param {Number} organizationId - Organization ID
 * @param {Object} [options]
 * @param {boolean} [options.wholeUnit=false] - Also reach every family of the
 *   unit: the edit opened an activity for some participants to everyone, so
 *   families who were not invited are newly concerned
 */
async function sendActivityUpdateNotifications(pool, activityId, organizationId, { wholeUnit = false } = {}) {
  const activityResult = await pool.query(
    `SELECT name AS activity_name,
            activity_date,
            meeting_location_going,
            meeting_time_going,
            departure_time_going,
            meeting_location_return,
            meeting_time_return,
            departure_time_return
       FROM activities
      WHERE id = $1 AND organization_id = $2`,
    [activityId, organizationId]
  );
  const activity = activityResult.rows[0];
  if (!activity) {
    return;
  }

  const concerned = await listConcernedAccounts(pool, activityId, organizationId, { wholeUnit });
  const recipients = await withActivityLeaders(pool, organizationId, concerned);
  if (recipients.length === 0) {
    return; // No one to notify
  }

  const sender = await resolveOrganizationEmailSender(pool, organizationId);
  const emailPromises = recipients.map(async (user) => {
    const preferredLanguage = await getUserEmailLanguage(pool, user.email, organizationId);
    const translations = getTranslationsByCode(preferredLanguage);
    const localeDate = formatEmailDate(activity.activity_date, preferredLanguage);
    const safeGuardianName = sanitizeInput(user.name)
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
 * Who is told that an activity is cancelled, read before the deletion: it
 * withdraws the carpool offers that identify the drivers. Everyone an update
 * reaches, the whole unit when every participant was invited, and the unit's
 * leaders who follow activities.
 *
 * @param {Object} pool - Database connection pool
 * @param {number} activityId - Activity about to be cancelled
 * @param {number} organizationId - Unit of the activity
 * @returns {Promise<{activity: Object, recipients: Array<{email: string, name: string}>}|null>}
 *   What to send, or null when the activity is not this unit's
 */
async function findActivityCancellationRecipients(pool, activityId, organizationId) {
  const activityResult = await pool.query(
    `SELECT name AS activity_name, activity_date, invites_everyone
       FROM activities
      WHERE id = $1 AND organization_id = $2`,
    [activityId, organizationId]
  );
  const activity = activityResult.rows[0];
  if (!activity) {
    return null;
  }
  const concerned = await listConcernedAccounts(pool, activityId, organizationId, {
    wholeUnit: activity.invites_everyone !== false
  });
  const recipients = await withActivityLeaders(pool, organizationId, concerned);
  return { activity, recipients };
}

/**
 * Tell each recipient, in their language, that an activity is cancelled.
 *
 * @param {Object} pool - Database connection pool
 * @param {number} organizationId - Unit of the activity, whose sender the emails use
 * @param {{activity: Object, recipients: Array<{email: string, name: string}>}} notice -
 *   From findActivityCancellationRecipients
 */
async function sendActivityCancellationNotifications(pool, organizationId, { activity, recipients }) {
  if (recipients.length === 0) {
    return; // No one to notify
  }

  const sender = await resolveOrganizationEmailSender(pool, organizationId);
  const translatorFor = await loadEmailTranslator(pool, organizationId);
  const emailPromises = recipients.map(async (user) => {
    try {
      const language = await getUserEmailLanguage(pool, user.email, organizationId);
      const t = translatorFor(language);
      const activityName = sanitizeInput(activity.activity_name);
      const date = formatEmailDate(activity.activity_date, language);
      const name = sanitizeInput(user.name) || t('activity_update_email_generic_name');
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
  findActivityCancellationRecipients,
  sendActivityCancellationNotifications
};
