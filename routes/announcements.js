/**
 * Announcements Routes
 *
 * Provides endpoints to draft, schedule, and send announcements via email and web push.
 */

const { authenticate, blockDemoRoles, requirePermission, getOrganizationId } = require('../middleware/auth');
const express = require('express');
const { asyncHandler, error: errorResponse, success: successResponse } = require('../middleware/response');
const { body, check } = require('express-validator');
const router = express.Router();
const {
  handleOrganizationResolutionError,
  escapeHtml,
} = require('../utils/api-helpers');
const { sanitizeInput, sendEmail, sendWhatsApp, getUserEmailLanguage } = require('../utils');
const { checkValidation, validateIdParam } = require('../middleware/validation');
const { isTestEnvironment } = require('../test/test-helpers');
const {
  listAlumni,
  issueAlumniToken,
  buildUnsubscribeFooter,
  UNSUBSCRIBE_PURPOSE
} = require('../services/alumni');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');
const { WITHDRAWN_FAMILY_ACCOUNT_SQL } = require('../services/parentInvitations');
const { resolveOrganizationEmailSender } = require('../services/emailSender');
const { resolveDatabaseConnectionString } = require('../config/database-url');
const {
  getVapidKeys, recordPushOutcomes, describePushFailure, pushServiceHost,
} = require('../utils/web-push');
const { recordUserMessages, messageUrl } = require('../services/userMessages');
const { readRichTextField, sanitizeRichTextHtml } = require('../utils/richText');
const { findTestRecipient, markAsTestEmail } = require('../utils/test-email');

/** Upper bound on roles one announcement may address; the unit's catalog is far smaller. */
const MAX_ANNOUNCEMENT_ROLES = 50;
/** Who an announcement can address. The two are mutually exclusive by design. */
const MEMBERS_AUDIENCE = 'members';
const ALUMNI_AUDIENCE = 'alumni';
const ALLOWED_AUDIENCES = [MEMBERS_AUDIENCE, ALUMNI_AUDIENCE];
const MAX_ANNOUNCEMENT_SUBJECT_LENGTH = 255;
const MAX_ANNOUNCEMENT_MESSAGE_LENGTH = 10000;
const MAX_ANNOUNCEMENT_GROUPS = 200;
const HTTP_BAD_REQUEST = 400;
/** The email service did not accept a message. */
const HTTP_BAD_GATEWAY = 502;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
/** Statuses of a message that is still to go out: it cannot leave the history yet. */
const PENDING_STATUSES = ['scheduled', 'sending'];
// A send still marked 'sending' this long after it started was cut off by a
// restart. It is marked failed rather than resent: some recipients may
// already have it, and a failed message stays visible for a leader to resend.
const STALE_SENDING_MINUTES = 60;
/** Messages listed per page of the history, and the last page number accepted. */
const HISTORY_PAGE_SIZE = 50;
const MAX_HISTORY_PAGE = 100000;
/** How often the scheduler re-checks with nothing else to wake it. */
const FALLBACK_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const pg = require('pg');
const { Client } = pg;

/**
 * Whether a request names at least one den to write to.
 *
 * @param {Object} body - Request body
 * @returns {boolean}
 */
function hasRecipientGroups(body) {
  return Array.isArray(body?.recipient_group_ids) && body.recipient_group_ids.length > 0;
}

/**
 * Normalize and sanitize announcement payload
 * @param {Object} body
 * @returns {Object}
 */
function normalizeAnnouncementPayload(body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const audience = ALLOWED_AUDIENCES.includes(payload.audience) ? payload.audience : MEMBERS_AUDIENCE;
  // Role names are only shape-checked here; the route keeps those the unit
  // may use (filterRolesInUnit), since a custom role belongs to one unit.
  const roles = Array.isArray(payload.recipient_roles)
    && payload.recipient_roles.length <= MAX_ANNOUNCEMENT_ROLES
    ? [...new Set(payload.recipient_roles.filter((role) => typeof role === 'string' && role))]
    : [];
  const groups = Array.isArray(payload.recipient_group_ids)
    && payload.recipient_group_ids.length <= MAX_ANNOUNCEMENT_GROUPS
    ? payload.recipient_group_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];

  const scheduledAt = typeof payload.scheduled_at === 'string' && payload.scheduled_at
    ? new Date(payload.scheduled_at)
    : null;
  const saveAsDraft = Boolean(payload.save_as_draft);
  const sendNow = payload.send_now !== undefined ? Boolean(payload.send_now) : !scheduledAt && !saveAsDraft;
  const subject = typeof payload.subject === 'string'
    ? payload.subject.slice(0, MAX_ANNOUNCEMENT_SUBJECT_LENGTH)
    : '';
  // A formatted message brings its own plain text: the one the other
  // channels send. Without one, the message is plain text as before.
  const rich = readRichTextField(payload.message_html);
  const plainMessage = rich.text ?? payload.message;
  const message = typeof plainMessage === 'string'
    ? plainMessage.slice(0, MAX_ANNOUNCEMENT_MESSAGE_LENGTH)
    : '';

  return {
    subject: sanitizeInput(subject),
    message: sanitizeInput(message),
    messageHtml: rich.html,
    audience,
    // An alumni mailing has no roles and no dens to filter on: the people it
    // reaches left the unit. Any role or group the client sent is dropped here
    // rather than carried into storage, so a later send cannot reinterpret it.
    roles: audience === ALUMNI_AUDIENCE ? [] : roles,
    groups: audience === ALUMNI_AUDIENCE ? [] : groups,
    scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null,
    saveAsDraft,
    sendNow,
  };
}

/**
 * Keep the role names the unit may use: its own custom roles and the
 * built-in ones.
 *
 * @param {Object} pool - Database pool
 * @param {Array<string>} roleNames - Requested role names
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Array<string>>} Role names known to the unit
 */
async function filterRolesInUnit(pool, roleNames, organizationId) {
  if (!roleNames.length) {
    return [];
  }
  const { rows } = await pool.query(
    `SELECT role_name
     FROM roles r
     WHERE r.role_name = ANY($1::text[])
       AND (r.organization_id = $2 OR (r.organization_id IS NULL AND r.is_system_role))`,
    [roleNames, organizationId],
  );
  return rows.map((row) => row.role_name);
}

/**
 * Keep the dens that belong to the unit: one deleted since the page loaded,
 * or another unit's, is dropped.
 *
 * @param {Object} pool - Database pool
 * @param {Array<number>} groupIds - Requested den ids
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Array<number>>} The unit's dens among them
 */
async function filterGroupsInUnit(pool, groupIds, organizationId) {
  if (!groupIds.length) {
    return [];
  }
  const { rows } = await pool.query(
    'SELECT id FROM groups WHERE id = ANY($1::int[]) AND organization_id = $2',
    [groupIds, organizationId],
  );
  return rows.map((row) => row.id);
}

/**
 * Roles the unit may address: its own custom roles and the built-in ones.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Array<{role_name: string, display_name: string}>>} Roles, built-in first
 */
async function listUnitRoles(pool, organizationId) {
  const { rows } = await pool.query(
    `SELECT r.role_name, r.display_name
     FROM roles r
     WHERE r.organization_id = $1 OR (r.organization_id IS NULL AND r.is_system_role)
     ORDER BY r.organization_id NULLS FIRST, r.id`,
    [organizationId],
  );
  return rows;
}

/**
 * Fetch announcement templates for the organization with organization defaults
 */
async function fetchAnnouncementTemplates(pool, organizationId) {
  const templatesQuery = `
    SELECT setting_value
    FROM organization_settings
    WHERE setting_key = 'announcement_templates'
      AND (organization_id = $1 OR organization_id IS NULL OR organization_id = 0)
    ORDER BY organization_id DESC NULLS LAST
  `;
  const { rows } = await pool.query(templatesQuery, [organizationId]);
  const [orgTemplates, fallbackTemplates] = rows;

  const parsedOrgTemplates = orgTemplates?.setting_value || [];
  const parsedFallbackTemplates = fallbackTemplates?.setting_value || [];

  return [...parsedOrgTemplates, ...parsedFallbackTemplates];
}

/**
 * Build the alumni audience.
 *
 * Email only, and only for memberships that opted in. No push and no WhatsApp:
 * those channels belong to an account that is no longer active, and a former
 * member who agreed to an occasional email did not agree to a phone
 * notification.
 *
 * Every address is returned with its own unsubscribe token, because the whole
 * arrangement rests on leaving being as easy as one click.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Organization ID
 * @returns {Promise<{emails: Array<string>, subscribers: Array, whatsappNumbers: Array, alumniByEmail: Map}>} Recipients
 */
async function buildAlumniRecipients(pool, organizationId) {
  const alumni = await listAlumni(pool, organizationId);
  const alumniByEmail = new Map();

  alumni.forEach((row) => {
    if (!alumniByEmail.has(row.email)) {
      alumniByEmail.set(row.email, row);
    }
  });

  return {
    emails: [...alumniByEmail.keys()],
    subscribers: [],
    whatsappNumbers: [],
    alumniByEmail,
  };
}

/**
 * Build email, push, and WhatsApp recipients based on roles and group filters
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Organization ID
 * @param {Array<string>} roles - Recipient roles
 * @param {Array<number>} groupIds - Recipient den ids
 * @param {string} [audience] - 'members' (the unit) or 'alumni' (former families)
 * @returns {Promise<Object>} Recipients per channel
 */
async function buildRecipients(pool, organizationId, roles, groupIds, audience = MEMBERS_AUDIENCE) {
  // The alumni audience is a separate list, never a filter over the unit's:
  // that is what keeps it out of a general send.
  if (audience === ALUMNI_AUDIENCE) {
    return buildAlumniRecipients(pool, organizationId);
  }

  const roleFilter = roles || [];
  // Dens chosen without any role: the message is for those dens' families.
  const familiesOnly = !roleFilter.length && groupIds.length > 0;
  const includeParents = familiesOnly || roleFilter.includes('parent');
  const groupFilterClause = groupIds.length
    ? 'AND pgroups.group_id = ANY($2::int[]) AND pgroups.organization_id = $1'
    : '';
  const groupParams = groupIds.length ? [organizationId, groupIds] : [organizationId];

  // Members reached through their role. A den filter narrows family accounts
  // (roles that see only their own children) to those linked to a youth of
  // the den; leaders belong to no den and stay reached as their role was chosen.
  // A family account whose invitation the unit withdrew is not reached.
  const userRoleQuery = `
    SELECT DISTINCT LOWER(u.email) AS email, u.id AS user_id, u.whatsapp_phone_number
    FROM user_organizations uo
    JOIN users u ON u.id = uo.user_id
    JOIN roles r ON r.id = ANY(SELECT jsonb_array_elements_text(uo.role_ids)::int)
    WHERE uo.organization_id = $1
      AND uo.status = 'active'
      AND (r.role_name = ANY($3::text[]) OR ($4::boolean AND r.data_scope = 'linked'))
      AND NOT (r.data_scope IS NOT DISTINCT FROM 'linked' AND ${WITHDRAWN_FAMILY_ACCOUNT_SQL})
      AND (
        cardinality($2::int[]) = 0
        OR r.data_scope IS DISTINCT FROM 'linked'
        OR EXISTS (
          SELECT 1
          FROM user_participants up
          JOIN participant_groups pgroups ON pgroups.participant_id = up.participant_id
          WHERE up.user_id = u.id
            AND pgroups.organization_id = $1
            AND pgroups.group_id = ANY($2::int[])
        )
      )
  `;
  const userRoleResult = await pool.query(userRoleQuery, [organizationId, groupIds, roleFilter, familiesOnly]);

  // Guardian emails per participant (optional group filter)
  const guardianEmails = [];
  const participantEmails = [];

  if (includeParents) {
    const guardianQuery = `
      WITH guardian_children AS (
        SELECT DISTINCT LOWER(pg.courriel) AS email,
               p.first_name || ' ' || p.last_name AS participant_name
        FROM parents_guardians pg
        JOIN participant_guardians pg_rel ON pg_rel.guardian_id = pg.id
        JOIN participant_organizations po ON po.participant_id = pg_rel.participant_id
        JOIN participants p ON p.id = pg_rel.participant_id
        ${groupIds.length ? 'JOIN participant_groups pgroups ON pgroups.participant_id = pg_rel.participant_id' : ''}
        WHERE po.organization_id = $1
          ${groupFilterClause}
          AND pg.courriel IS NOT NULL
          AND pg.courriel <> ''
      )
      SELECT email, string_agg(participant_name, ', ' ORDER BY participant_name) AS participants
      FROM guardian_children
      GROUP BY email
    `;
    const guardianResult = await pool.query(guardianQuery, groupParams);

    // Participant emails captured on forms (optional group filter)
    const participantQuery = `
      SELECT LOWER(fs.submission_data->>'courriel') AS courriel
      FROM form_submissions fs
      ${groupIds.length ? 'JOIN participant_groups pgroups ON pgroups.participant_id = fs.participant_id' : ''}
      WHERE (fs.submission_data->>'courriel') IS NOT NULL
        AND (fs.submission_data->>'courriel') != ''
        AND fs.organization_id = $1
        ${groupFilterClause}
    `;
    const participantResult = await pool.query(participantQuery, groupParams);

    guardianEmails.push(...guardianResult.rows.map((row) => row.email));
    participantEmails.push(...participantResult.rows.map((row) => row.courriel));
  }
  const roleEmails = userRoleResult.rows.map((row) => row.email);

  const whatsappNumbers = userRoleResult.rows
    .filter((row) => row.whatsapp_phone_number)
    .map((row) => ({ phone: row.whatsapp_phone_number, user_id: row.user_id }));

  const allEmails = [...roleEmails, ...guardianEmails, ...participantEmails].filter(Boolean);
  const uniqueEmails = [...new Set(allEmails)];

  // Push goes to the same members as above, den filter included.
  const memberIds = [...new Set(userRoleResult.rows.map((row) => row.user_id))];
  const subscriberQuery = `
    SELECT DISTINCT s.endpoint, s.p256dh, s.auth, s.user_id
    FROM subscribers s
    WHERE s.organization_id = $1
      AND s.user_id = ANY($2::uuid[])
  `;
  const subscribersResult = await pool.query(subscriberQuery, [organizationId, memberIds]);

  return {
    emails: uniqueEmails,
    subscribers: subscribersResult.rows,
    whatsappNumbers: whatsappNumbers,
  };
}

/**
 * The email an announcement sends: its formatted message when it has one,
 * with the plain message as the text part; plain text only otherwise. An
 * alumni mailing adds its recipient's unsubscribe footer.
 *
 * @param {Object} announcement - Announcement row (subject, message, message_html)
 * @param {{text: string, html: string}|null} [footer] - Unsubscribe footer
 * @returns {{subject: string, textBody: string, htmlBody: (string|null)}}
 */
function buildAnnouncementEmail(announcement, footer = null) {
  const messageHtml = sanitizeRichTextHtml(announcement.message_html);
  if (footer) {
    return {
      subject: announcement.subject,
      textBody: `${announcement.message}${footer.text}`,
      htmlBody: `<div>${messageHtml || escapeHtml(announcement.message).replace(/\n/g, '<br />')}</div>${footer.html}`,
    };
  }
  return {
    subject: announcement.subject,
    textBody: announcement.message,
    htmlBody: messageHtml ? `<div>${messageHtml}</div>` : null,
  };
}

/**
 * Send announcement via email, push, WhatsApp, and Google Chat
 */
async function dispatchAnnouncement(pool, logger, announcement, whatsappService = null, googleChatService = null) {
  const audience = announcement.audience || MEMBERS_AUDIENCE;
  const { emails, subscribers, whatsappNumbers, alumniByEmail } = await buildRecipients(
    pool,
    announcement.organization_id,
    announcement.recipient_roles,
    announcement.recipient_groups,
    audience,
  );

  const isAlumniSend = audience === ALUMNI_AUDIENCE;
  const sender = emails.length > 0
    ? await resolveOrganizationEmailSender(pool, announcement.organization_id)
    : null;
  // Scheduled sends run without a request, so the unsubscribe link cannot be
  // derived from the caller's host the way the invitation's is.
  const baseUrl = isAlumniSend
    ? await resolveOrganizationBaseUrl(pool, announcement.organization_id)
    : null;

  const emailLogs = await Promise.allSettled(
    emails.map(async (email) => {
      // An alumni mailing carries its own way out. Building the footer per
      // recipient is what makes the link personal — a shared one could only
      // unsubscribe everybody or nobody.
      let footer = null;
      if (isAlumniSend) {
        const membership = alumniByEmail.get(email);
        const language = await getUserEmailLanguage(pool, email, announcement.organization_id);
        const unsubscribeLink = `${baseUrl}/alumni-unsubscribe?token=${issueAlumniToken(membership, UNSUBSCRIBE_PURPOSE)}`;
        footer = buildUnsubscribeFooter({ language, unsubscribeLink });
      }
      const { subject, textBody, htmlBody } = buildAnnouncementEmail(announcement, footer);

      const success = await sendEmail(email, subject, textBody, htmlBody, sender);
      await pool.query(
        `INSERT INTO announcement_logs (announcement_id, channel, recipient_email, status, error_message)
         VALUES ($1, 'email', $2, $3, $4)`,
        [announcement.id, email, success ? 'sent' : 'failed', success ? null : 'Email send failed'],
      );
      return success;
    }),
  );

  let pushOutcome = { successes: 0, failures: 0 };
  if (subscribers.length) {
    try {
      const webpush = require('web-push');
      const { publicKey: vapidPublicKey, privateKey: vapidPrivateKey } = getVapidKeys();

      if (!vapidPublicKey || !vapidPrivateKey) {
        throw new Error('VAPID keys not configured');
      }

      webpush.setVapidDetails('mailto:info@wampums.app', vapidPublicKey, vapidPrivateKey);

      // Each recipient's copy is what the tapped notification opens. Without
      // it the push still goes out, and opens the list of messages.
      let messageIds = new Map();
      try {
        messageIds = await recordUserMessages(pool, {
          organizationId: announcement.organization_id,
          userIds: subscribers.map((subscriber) => subscriber.user_id),
          title: announcement.subject,
          body: announcement.message,
          sentBy: announcement.created_by,
          announcementId: announcement.id,
        });
      } catch (recordError) {
        logger.error('Announcement push: could not keep the message for its recipients:', recordError);
      }

      const pushResults = await Promise.allSettled(
        subscribers.map(async (subscriber) => {
          const pushSubscription = {
            endpoint: subscriber.endpoint,
            keys: { p256dh: subscriber.p256dh, auth: subscriber.auth },
          };
          await webpush.sendNotification(pushSubscription, JSON.stringify({
            title: announcement.subject,
            body: announcement.message,
            tag: 'announcement',
            data: { url: messageUrl(messageIds, subscriber.user_id) },
          }));
          await pool.query(
            `INSERT INTO announcement_logs (announcement_id, channel, recipient_user_id, status)
             VALUES ($1, 'push', $2, 'sent')`,
            [announcement.id, subscriber.user_id],
          );
          return true;
        }),
      );

      pushOutcome = pushResults.reduce(
        (acc, result) => {
          if (result.status === 'fulfilled') {
            acc.successes += 1;
          } else {
            acc.failures += 1;
          }
          return acc;
        },
        { successes: 0, failures: 0 },
      );

      // Devices that will not receive again are forgotten
      try {
        await recordPushOutcomes(pool, announcement.organization_id, pushResults, subscribers);
      } catch (cleanupError) {
        logger.error('Error recording push outcomes:', cleanupError);
      }

      // One log row per failed device, naming whose device it was and its
      // push service, so the history shows where the failures went.
      const failures = pushResults
        .map((result, index) => ({ result, subscriber: subscribers[index] }))
        .filter(({ result }) => result.status === 'rejected');
      if (failures.length > 0) {
        await pool.query(
          `INSERT INTO announcement_logs (announcement_id, channel, recipient_user_id, status, error_message, metadata)
           SELECT $1, 'push', recipient, 'failed', reason, jsonb_build_object('push_service', service)
             FROM unnest($2::uuid[], $3::text[], $4::text[]) AS failed(recipient, reason, service)`,
          [
            announcement.id,
            failures.map(({ subscriber }) => subscriber.user_id),
            failures.map(({ result }) => describePushFailure(result.reason)),
            failures.map(({ subscriber }) => pushServiceHost(subscriber.endpoint)),
          ],
        );
      }
    } catch (error) {
      logger.error('Push notification send failed:', error);
      await pool.query(
        `INSERT INTO announcement_logs (announcement_id, channel, status, error_message)
         VALUES ($1, 'push', 'failed', $2)`,
        [announcement.id, error.message || 'Push send failed'],
      );
    }
  }

  // Send WhatsApp messages
  let whatsappOutcome = { successes: 0, failures: 0 };
  if (whatsappNumbers && whatsappNumbers.length > 0) {
    const whatsappMessage = `*${announcement.subject}*\n\n${announcement.message}`;

    const whatsappResults = await Promise.allSettled(
      whatsappNumbers.map(async ({ phone, user_id }) => {
        const success = await sendWhatsApp(phone, whatsappMessage, announcement.organization_id, whatsappService);
        await pool.query(
          `INSERT INTO announcement_logs (announcement_id, channel, recipient_user_id, status, error_message, metadata)
           VALUES ($1, 'whatsapp', $2, $3, $4, $5)`,
          [
            announcement.id,
            user_id,
            success ? 'sent' : 'failed',
            success ? null : 'WhatsApp send failed',
            JSON.stringify({ phone_number: phone })
          ],
        );
        return success;
      }),
    );

    whatsappOutcome = whatsappResults.reduce(
      (acc, result) => {
        if (result.status === 'fulfilled' && result.value) {
          acc.successes += 1;
        } else {
          acc.failures += 1;
        }
        return acc;
      },
      { successes: 0, failures: 0 },
    );
  }

  // Send Google Chat broadcast.
  //
  // Never for an alumni send: the broadcast space belongs to the unit, so
  // posting there would put a message meant for former families in front of the
  // current ones — the general send this audience exists to stay out of.
  const googleChatOutcome = { successes: 0, failures: 0 };
  if (googleChatService && !isAlumniSend) {
    try {
      // Check if Google Chat is configured for this organization
      const configCheck = await pool.query(
        `SELECT id FROM google_chat_config
         WHERE organization_id = $1 AND is_active = TRUE`,
        [announcement.organization_id]
      );

      if (configCheck.rows.length > 0) {
        // Check if broadcast space is configured
        const spaceCheck = await pool.query(
          `SELECT space_id FROM google_chat_spaces
           WHERE organization_id = $1 AND is_broadcast_space = TRUE AND is_active = TRUE`,
          [announcement.organization_id]
        );

        if (spaceCheck.rows.length > 0) {
          // Send broadcast to Google Chat Space
          await googleChatService.sendBroadcast(
            announcement.organization_id,
            announcement.subject,
            announcement.message
          );

          googleChatOutcome.successes = 1;

          await pool.query(
            `INSERT INTO announcement_logs (announcement_id, channel, status)
             VALUES ($1, 'google_chat', 'sent')`,
            [announcement.id]
          );

          logger.info(`Google Chat broadcast sent for announcement ${announcement.id}`);
        } else {
          logger.info(`No broadcast space configured for organization ${announcement.organization_id}, skipping Google Chat`);
        }
      }
    } catch (error) {
      logger.error('Google Chat broadcast failed:', error);
      googleChatOutcome.failures = 1;

      await pool.query(
        `INSERT INTO announcement_logs (announcement_id, channel, status, error_message)
         VALUES ($1, 'google_chat', 'failed', $2)`,
        [announcement.id, error.message || 'Google Chat send failed']
      );
    }
  }

  const emailFailures = emailLogs.filter((log) => log.status === 'fulfilled' && !log.value).length;
  const pushFailures = pushOutcome.failures;
  const whatsappFailures = whatsappOutcome.failures;
  const googleChatFailures = googleChatOutcome.failures;
  const hasFailures = emailFailures > 0 || pushFailures > 0 || whatsappFailures > 0 || googleChatFailures > 0;

  await pool.query(
    `UPDATE announcements
     SET status = $1,
         sent_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [hasFailures ? 'partial' : 'sent', announcement.id],
  );

  return { emailFailures, pushFailures, whatsappFailures, googleChatFailures };
}

/**
 * Claim and send due scheduled announcements
 */
async function processScheduledAnnouncements(pool, logger, whatsappService = null, googleChatService = null) {
  const stale = await pool.query(
    `UPDATE announcements
     SET status = 'failed', updated_at = NOW()
     WHERE status = 'sending'
       AND updated_at < NOW() - make_interval(mins => $1)
     RETURNING id`,
    [STALE_SENDING_MINUTES],
  );
  if (stale.rows.length > 0) {
    logger.warn('Marked interrupted announcements as failed:', stale.rows.map((row) => row.id));
  }

  const dueQuery = `
    UPDATE announcements
    SET status = 'sending', updated_at = NOW()
    WHERE status = 'scheduled'
      AND scheduled_at <= NOW()
    RETURNING *
  `;

  const { rows } = await pool.query(dueQuery);
  for (const announcement of rows) {
    try {
      await dispatchAnnouncement(pool, logger, announcement, whatsappService, googleChatService);
    } catch (error) {
      logger.error('Error sending scheduled announcement:', error);
      await pool.query(
        `UPDATE announcements
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [announcement.id],
      );
    }
  }
}

/**
 * When the next scheduled announcement falls due, across every unit: the
 * scheduler is one process serving them all.
 *
 * @param {Object} pool - Database pool
 * @returns {Promise<Date|null>} Earliest due time, or null when none waits
 */
async function findNextScheduledAt(pool) {
  const { rows } = await pool.query(
    `SELECT MIN(scheduled_at) AS next_at FROM announcements WHERE status = 'scheduled'`,
  );
  return rows[0]?.next_at ? new Date(rows[0].next_at) : null;
}

module.exports = (pool, logger, whatsappService = null, googleChatService = null) => {
  // ==============================================
  // PostgreSQL LISTEN/NOTIFY for Scheduled Announcements
  // ==============================================
  // Replaces inefficient polling (43,200 queries/month) with event-driven processing
  // Expected compute reduction: 95-98%

  let listenClient = null;
  let reconnectTimeout = null;
  let isProcessing = false;
  let reconnectAttempts = 0;
  let fallbackInterval = null;
  let nextDueTimeout = null;

  /**
   * Send what is due, then wake again when the next announcement falls due.
   *
   * A NOTIFY arrives when an announcement is saved, not when it is due, so
   * without this timer a future send waited for the hourly fallback. The
   * timer is capped at that interval, so a far-off send is re-checked rather
   * than held in one long timer.
   *
   * @param {string} reason - Why the check runs, for the log
   * @returns {Promise<void>}
   */
  async function runScheduledCheck(reason) {
    if (isProcessing) {
      return;
    }
    isProcessing = true;
    try {
      await processScheduledAnnouncements(pool, logger, whatsappService, googleChatService);
    } catch (error) {
      logger.error(`Scheduled announcement check failed (${reason}):`, error);
    } finally {
      isProcessing = false;
    }
    await armNextDueTimer();
  }

  /**
   * Replace the timer with one for the earliest scheduled announcement.
   * @returns {Promise<void>}
   */
  async function armNextDueTimer() {
    if (nextDueTimeout) {
      clearTimeout(nextDueTimeout);
      nextDueTimeout = null;
    }
    try {
      const nextAt = await findNextScheduledAt(pool);
      if (!nextAt) {
        return;
      }
      const delay = Math.min(Math.max(nextAt.getTime() - Date.now(), 0), FALLBACK_CHECK_INTERVAL_MS);
      nextDueTimeout = setTimeout(() => {
        nextDueTimeout = null;
        runScheduledCheck('due time');
      }, delay).unref();
    } catch (error) {
      logger.error('Could not find the next scheduled announcement:', error);
    }
  }

  /**
   * Setup PostgreSQL LISTEN connection for announcement notifications
   * Uses a dedicated client to avoid blocking the connection pool
   *
   * @returns {Promise<void>}
   */
  async function setupAnnouncementListener() {
    // Skip listener in test environment
    if (isTestEnvironment()) {
      logger.info('Skipping announcement listener in test environment');
      return;
    }

    try {
      // Create dedicated client for LISTEN (cannot use pooled connection)
      listenClient = new Client({
        connectionString: resolveDatabaseConnectionString(),
      });

      await listenClient.connect();
      logger.info('✓ Announcement listener client connected');

      // Reset reconnect attempts on successful connection
      reconnectAttempts = 0;

      // Listen for announcement_scheduled notifications
      await listenClient.query('LISTEN announcement_scheduled');
      logger.info('✓ Listening for announcement_scheduled notifications');

      // Handle notifications from database triggers
      listenClient.on('notification', async (msg) => {
        if (msg.channel === 'announcement_scheduled') {
          // Parse and validate notification payload
          let payload = null;
          try {
            payload = msg.payload ? JSON.parse(msg.payload) : null;
            logger.info('📢 Received announcement notification:', {
              id: payload?.id,
              organization_id: payload?.organization_id,
              scheduled_at: payload?.scheduled_at,
            });
          } catch (parseError) {
            logger.warn('Failed to parse announcement notification payload:', msg.payload, parseError);
          }

          await runScheduledCheck('notification');
        }
      });

      // Handle client errors
      listenClient.on('error', (err) => {
        logger.error('PostgreSQL LISTEN client error:', err);
        reconnectListener();
      });

      // Handle unexpected disconnection
      listenClient.on('end', () => {
        logger.warn('PostgreSQL LISTEN client disconnected');
        reconnectListener();
      });

      // Check for any overdue announcements on startup (in case server was down)
      logger.info('Checking for overdue announcements on startup...');
      await runScheduledCheck('startup');

    } catch (error) {
      logger.error('Failed to setup announcement listener:', error);
      reconnectListener();
    }
  }

  /**
   * Reconnect listener with exponential backoff
   * Uses progressive delay: 5s, 10s, 20s, 40s, up to max 60s
   *
   * @returns {void}
   */
  function reconnectListener() {
    if (reconnectTimeout) {
      return; // Already reconnecting
    }

    // Clean up existing client
    if (listenClient) {
      listenClient.removeAllListeners();

      // Properly await end() to ensure connection closes
      listenClient.end().catch((err) => {
        logger.error('Error closing LISTEN client:', err);
      });

      listenClient = null;
    }

    // True exponential backoff: 5s * 2^attempts, capped at 60s
    reconnectAttempts++;
    const delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000);
    logger.info(`Reconnecting announcement listener in ${delay}ms (attempt ${reconnectAttempts})...`);

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      setupAnnouncementListener();
    }, delay);
  }

  /**
   * Graceful shutdown handler for announcement listener
   * Cleans up database connection and clears timers
   *
   * @returns {Promise<void>}
   */
  async function shutdownListener() {
    logger.info('Shutting down announcement listener...');

    // Clear fallback interval
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }

    if (nextDueTimeout) {
      clearTimeout(nextDueTimeout);
      nextDueTimeout = null;
    }

    // Clear reconnect timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    // Close LISTEN client
    if (listenClient) {
      listenClient.removeAllListeners();

      try {
        await listenClient.end();
        logger.info('✓ Announcement listener client closed');
      } catch (err) {
        logger.error('Error during listener shutdown:', err);
      }

      listenClient = null;
    }
  }

  // Make shutdown function available for tests
  global.__announcementListenerShutdown = shutdownListener;

  // Initialize the listener
  setupAnnouncementListener();

  // SAFETY NET: Periodic fallback check (once per hour) in case notifications are missed
  // This provides defense-in-depth while still reducing queries by 99.8% vs 1-minute polling
  fallbackInterval = setInterval(() => {
    logger.info('Running hourly fallback check for scheduled announcements...');
    runScheduledCheck('fallback');
  }, FALLBACK_CHECK_INTERVAL_MS).unref();

  // Cleanup on process termination (use once to avoid duplicate listeners)
  process.once('SIGTERM', shutdownListener);
  process.once('SIGINT', shutdownListener);

  /**
   * Create a new announcement
   * Permission: communications.send
   */
  router.post(
    '/v1/announcements',
    authenticate, blockDemoRoles, requirePermission((req) =>
      req.body?.audience === ALUMNI_AUDIENCE ? ['communications.send', 'alumni.manage'] : ['communications.send']),
    [
      check('subject').trim().notEmpty().withMessage('Subject is required'),
      check('message').trim().notEmpty().withMessage('Message is required'),
      check('audience').optional().isIn(ALLOWED_AUDIENCES).withMessage(`audience must be one of ${ALLOWED_AUDIENCES.join(', ')}`),
      // An alumni mailing has no roles to pick from, and a send to dens alone
      // reaches their families: either way no role is required.
      check('recipient_roles')
        .if((_value, { req }) => req.body?.audience !== ALUMNI_AUDIENCE && !hasRecipientGroups(req.body))
        .isArray({ min: 1 }).withMessage('announcement_recipients_required'),
      check('recipient_roles').optional().isArray().withMessage('recipient_roles must be an array'),
      check('recipient_group_ids').optional().isArray().withMessage('recipient_group_ids must be an array'),
      check('scheduled_at').optional({ values: 'falsy' }).isISO8601().withMessage('scheduled_at must be a valid date'),
      check('save_as_draft').optional().isBoolean(),
      check('send_now').optional().isBoolean(),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {

        const organizationId = await getOrganizationId(req, pool);
        const normalized = normalizeAnnouncementPayload(req.body);
        const requestedRoleCount = normalized.roles.length;
        const requestedGroupCount = normalized.groups.length;
        [normalized.roles, normalized.groups] = await Promise.all([
          filterRolesInUnit(pool, normalized.roles, organizationId),
          filterGroupsInUnit(pool, normalized.groups, organizationId),
        ]);

        if (normalized.audience !== ALUMNI_AUDIENCE) {
          if (requestedRoleCount && !normalized.roles.length) {
            return res.status(400).json({ success: false, message: 'No valid roles provided' });
          }
          // Dens that no longer exist would narrow the message to nobody.
          if (requestedGroupCount && !normalized.groups.length) {
            return errorResponse(res, 'announcement_groups_not_found', HTTP_BAD_REQUEST);
          }
          if (!normalized.roles.length && !normalized.groups.length) {
            return errorResponse(res, 'announcement_recipients_required', HTTP_BAD_REQUEST);
          }
        }

        const shouldSendNow = normalized.sendNow || !normalized.scheduledAt || normalized.scheduledAt <= new Date();
        const initialStatus = normalized.saveAsDraft
          ? 'draft'
          : shouldSendNow
            ? 'sending'
            : 'scheduled';

        const insertQuery = `
          INSERT INTO announcements
            (organization_id, created_by, subject, message, recipient_roles, recipient_groups, scheduled_at, status, audience,
             message_html)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        `;

        const { rows } = await pool.query(insertQuery, [
          organizationId,
          req.user.id,
          normalized.subject,
          normalized.message,
          normalized.roles,
          normalized.groups,
          normalized.scheduledAt,
          initialStatus,
          normalized.audience,
          normalized.messageHtml,
        ]);

        const announcement = rows[0];

        if (initialStatus === 'sending') {
          await dispatchAnnouncement(pool, logger, announcement, whatsappService, googleChatService);
        }

        res.json({ success: true, data: { ...announcement, status: initialStatus } });
      } catch (error) {
        if (handleOrganizationResolutionError(res, error, logger)) {
          return;
        }
        logger.error('Error creating announcement:', error);
        return errorResponse(res, 'internal_server_error', 500);
      }
    }),
  );

  /**
   * Send the signed-in member a test copy of an announcement being written:
   * the email its recipients would get, marked as a test. Nothing is saved
   * and nobody else receives it.
   * Permission: communications.send
   */
  router.post(
    '/v1/announcements/test',
    authenticate, blockDemoRoles, requirePermission(['communications.send']),
    [
      check('subject').trim().notEmpty().withMessage('Subject is required'),
      check('message').trim().notEmpty().withMessage('Message is required'),
      check('audience').optional().isIn(ALLOWED_AUDIENCES).withMessage(`audience must be one of ${ALLOWED_AUDIENCES.join(', ')}`),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const recipient = await findTestRecipient(pool, req.user.id, organizationId);
      if (!recipient) {
        return errorResponse(res, 'Your account has no email address', HTTP_BAD_REQUEST);
      }

      const normalized = normalizeAnnouncementPayload(req.body);
      const noteKeys = [];
      let footer = null;
      // An alumni mailing shows its unsubscribe footer; in a test its link
      // leads nowhere.
      if (normalized.audience === ALUMNI_AUDIENCE) {
        const baseUrl = await resolveOrganizationBaseUrl(pool, organizationId);
        footer = buildUnsubscribeFooter({
          language: recipient.languageCode,
          unsubscribeLink: `${baseUrl}/alumni-unsubscribe?token=test`,
        });
        noteKeys.push('announcement_test_unsubscribe_note');
      }
      const email = buildAnnouncementEmail({
        subject: normalized.subject,
        message: normalized.message,
        message_html: normalized.messageHtml,
      }, footer);
      const test = markAsTestEmail(email, { languageCode: recipient.languageCode, noteKeys });
      const sender = await resolveOrganizationEmailSender(pool, organizationId);
      const sent = await sendEmail(recipient.email, test.subject, test.textBody, test.htmlBody, sender);
      if (!sent) {
        return errorResponse(res, 'The test email could not be sent', HTTP_BAD_GATEWAY);
      }
      return successResponse(res, { email: recipient.email }, 'Test email sent');
    }),
  );

  /**
   * List announcements with delivery logs.
   * `?archived=true` lists the archived ones instead of the active ones.
   */
  router.get('/v1/announcements', authenticate, requirePermission(['communications.send']), [
    check('archived').optional().isIn(['true', 'false']).withMessage('archived must be true or false'),
    check('page').optional().isInt({ min: 1, max: MAX_HISTORY_PAGE }).withMessage('page must be a positive integer'),
  ], checkValidation, asyncHandler(async (req, res) => {
    try {

      const organizationId = await getOrganizationId(req, pool);
      const archived = req.query.archived === 'true';
      const page = Number(req.query.page) || 1;

      const announcementsQuery = `
        SELECT id, subject, message, recipient_roles, recipient_groups, audience, scheduled_at, sent_at, status, created_at, archived_at
        FROM announcements
        WHERE organization_id = $1
          AND (archived_at IS NOT NULL) = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3 OFFSET $4
      `;
      const [announcementsResult, countResult, groupsResult] = await Promise.all([
        pool.query(announcementsQuery, [organizationId, archived, HISTORY_PAGE_SIZE, (page - 1) * HISTORY_PAGE_SIZE]),
        pool.query(
          'SELECT COUNT(*)::int AS total FROM announcements WHERE organization_id = $1 AND (archived_at IS NOT NULL) = $2',
          [organizationId, archived],
        ),
        // The groups' names label each message's recipients, so reading the history
        // does not depend on holding groups.view as well.
        pool.query('SELECT id, name FROM groups WHERE organization_id = $1 ORDER BY name', [organizationId]),
      ]);
      const total = countResult.rows[0]?.total || 0;

      const announcementIds = announcementsResult.rows.map((row) => row.id);
      let logsByAnnouncement = {};
      if (announcementIds.length) {
        const logsResult = await pool.query(
          `SELECT l.announcement_id, l.channel, l.recipient_email, l.recipient_user_id,
                  COALESCE(NULLIF(u.full_name, ''), u.email) AS recipient_name,
                  l.status, l.error_message, l.metadata->>'push_service' AS push_service, l.sent_at
           FROM announcement_logs l
           LEFT JOIN users u ON u.id = l.recipient_user_id
           WHERE l.announcement_id = ANY($1::int[])
           ORDER BY l.sent_at DESC`,
          [announcementIds],
        );
        logsByAnnouncement = logsResult.rows.reduce((acc, log) => {
          if (!acc[log.announcement_id]) {acc[log.announcement_id] = [];}
          acc[log.announcement_id].push(log);
          return acc;
        }, {});
      }

      const [templates, roles] = await Promise.all([
        fetchAnnouncementTemplates(pool, organizationId),
        listUnitRoles(pool, organizationId),
      ]);

      res.json({
        success: true,
        data: announcementsResult.rows.map((row) => ({
          ...row,
          message: escapeHtml(row.message),
          logs: logsByAnnouncement[row.id] || [],
        })),
        pagination: {
          page,
          limit: HISTORY_PAGE_SIZE,
          total,
          totalPages: Math.ceil(total / HISTORY_PAGE_SIZE),
          hasNext: page * HISTORY_PAGE_SIZE < total,
          hasPrev: page > 1,
        },
        groups: groupsResult.rows,
        templates,
        roles,
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching announcements:', error);
      return errorResponse(res, 'internal_server_error', 500);
    }
  }));

  /**
   * Archive an announcement out of the history, or restore it.
   * A message still waiting to go out (scheduled or sending) cannot be archived.
   * Permission: communications.send
   */
  router.patch(
    '/v1/announcements/:announcementId/archive',
    authenticate, blockDemoRoles, requirePermission(['communications.send']),
    validateIdParam('announcementId'),
    [body('archived').isIn(['true', 'false']).withMessage('archived must be true or false in the request body')],
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const archived = String(req.body.archived) === 'true';

      const result = await pool.query(
        `UPDATE announcements
         SET archived_at = CASE WHEN $1::boolean THEN COALESCE(archived_at, NOW()) ELSE NULL END,
             updated_at = NOW()
         WHERE id = $2 AND organization_id = $3
           AND (NOT $1::boolean OR status <> ALL($4::text[]))
         RETURNING id, status, archived_at`,
        [archived, Number(req.params.announcementId), organizationId, PENDING_STATUSES],
      );
      if (result.rows.length) {
        return successResponse(res, result.rows[0], archived ? 'announcement_archived' : 'announcement_restored');
      }

      const exists = await pool.query(
        'SELECT id FROM announcements WHERE id = $1 AND organization_id = $2',
        [Number(req.params.announcementId), organizationId],
      );
      if (!exists.rows.length) {
        return errorResponse(res, 'announcement_not_found', HTTP_NOT_FOUND);
      }
      return errorResponse(res, 'announcement_not_archivable', HTTP_CONFLICT);
    }),
  );

  return router;
};

/**
 * Recipient resolution, exported so the audience separation can be asserted
 * against a real database. It is the single property this whole feature rests
 * on — an alumni address must never appear in a members send, and vice versa —
 * and it lives in a query, not in a branch a unit test could stub.
 *
 * @private Used only in test environments
 */
module.exports.buildRecipientsForTests = buildRecipients;
module.exports.dispatchAnnouncementForTests = dispatchAnnouncement;

/**
 * Export shutdown function for tests to clean up resources
 * @private Used only in test environments
 */
module.exports.shutdownListenerForTests = async function() {
  // This will be set by the route initialization
  if (typeof global.__announcementListenerShutdown === 'function') {
    await global.__announcementListenerShutdown();
  }
};
module.exports.normalizeAnnouncementPayloadForTests = normalizeAnnouncementPayload;
module.exports.buildAnnouncementEmailForTests = buildAnnouncementEmail;
module.exports.processScheduledAnnouncementsForTests = processScheduledAnnouncements;
