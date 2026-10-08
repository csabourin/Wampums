/**
 * Announcements Routes
 *
 * Provides endpoints to draft, schedule, and send announcements via email and web push.
 */

const { authenticate, blockDemoRoles, requirePermission, getOrganizationId } = require('../middleware/auth');
const express = require('express');
const { asyncHandler, error: errorResponse } = require('../middleware/response');
const { check } = require('express-validator');
const router = express.Router();
const {
  handleOrganizationResolutionError,
  escapeHtml,
} = require('../utils/api-helpers');
const { sanitizeInput, sendEmail, sendWhatsApp, getUserEmailLanguage } = require('../utils');
const { checkValidation } = require('../middleware/validation');
const { isTestEnvironment } = require('../test/test-helpers');
const {
  listAlumni,
  issueAlumniToken,
  buildUnsubscribeFooter,
  UNSUBSCRIBE_PURPOSE
} = require('../services/alumni');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');
const { resolveOrganizationEmailSender } = require('../services/emailSender');
const { resolveDatabaseConnectionString } = require('../config/database-url');

/** Upper bound on roles one announcement may address; the unit's catalog is far smaller. */
const MAX_ANNOUNCEMENT_ROLES = 50;
/** Who an announcement can address. The two are mutually exclusive by design. */
const MEMBERS_AUDIENCE = 'members';
const ALUMNI_AUDIENCE = 'alumni';
const ALLOWED_AUDIENCES = [MEMBERS_AUDIENCE, ALUMNI_AUDIENCE];
const MAX_ANNOUNCEMENT_SUBJECT_LENGTH = 255;
const MAX_ANNOUNCEMENT_MESSAGE_LENGTH = 10000;
const MAX_ANNOUNCEMENT_GROUPS = 200;
/** How often the scheduler re-checks with nothing else to wake it. */
const FALLBACK_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const pg = require('pg');
const { Client } = pg;

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
  const message = typeof payload.message === 'string'
    ? payload.message.slice(0, MAX_ANNOUNCEMENT_MESSAGE_LENGTH)
    : '';

  return {
    subject: sanitizeInput(subject),
    message: sanitizeInput(message),
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
  const includeParents = roleFilter.includes('parent');
  const groupFilterClause = groupIds.length ? 'AND pgroups.group_id = ANY($2::int[])' : '';
  const groupParams = groupIds.length ? [organizationId, groupIds] : [organizationId];

  // User roles (admins/animation/parents as users) - get email and WhatsApp
  const userRoleQuery = `
    SELECT DISTINCT LOWER(u.email) AS email, u.id AS user_id, u.whatsapp_phone_number
    FROM user_organizations uo
    JOIN users u ON u.id = uo.user_id
    JOIN roles r ON r.id = ANY(SELECT jsonb_array_elements_text(uo.role_ids)::int)
    WHERE uo.organization_id = $1
      AND uo.status = 'active'
      AND r.role_name = ANY($${groupParams.length + 1}::text[])
      AND u.email IS NOT NULL AND u.email <> ''
  `;
  const userRoleResult = await pool.query(userRoleQuery, [...groupParams, roleFilter]);

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

  // Push subscribers limited to requested roles
  const subscriberQuery = `
    SELECT DISTINCT s.endpoint, s.p256dh, s.auth, s.user_id
    FROM subscribers s
    JOIN user_organizations uo ON uo.user_id = s.user_id
    JOIN roles r ON r.id = ANY(SELECT jsonb_array_elements_text(uo.role_ids)::int)
    WHERE s.organization_id = $1
      AND uo.organization_id = $1
      AND uo.status = 'active'
      AND r.role_name = ANY($2::text[])
  `;
  const subscribersResult = await pool.query(subscriberQuery, [organizationId, roleFilter]);

  return {
    emails: uniqueEmails,
    subscribers: subscribersResult.rows,
    whatsappNumbers: whatsappNumbers,
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
      let body = announcement.message;
      let html = null;

      // An alumni mailing carries its own way out. Building the footer per
      // recipient is what makes the link personal — a shared one could only
      // unsubscribe everybody or nobody.
      if (isAlumniSend) {
        const membership = alumniByEmail.get(email);
        const language = await getUserEmailLanguage(pool, email, announcement.organization_id);
        const unsubscribeLink = `${baseUrl}/alumni-unsubscribe?token=${issueAlumniToken(membership, UNSUBSCRIBE_PURPOSE)}`;
        const footer = buildUnsubscribeFooter({ language, unsubscribeLink });
        body = `${announcement.message}${footer.text}`;
        html = `<div>${escapeHtml(announcement.message).replace(/\n/g, '<br />')}</div>${footer.html}`;
      }

      const success = await sendEmail(email, announcement.subject, body, html, sender);
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
      const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
      const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE;

      if (!vapidPublicKey || !vapidPrivateKey) {
        throw new Error('VAPID keys not configured');
      }

      webpush.setVapidDetails('mailto:info@wampums.app', vapidPublicKey, vapidPrivateKey);

      const payload = JSON.stringify({
        title: announcement.subject,
        body: announcement.message,
        options: {
          body: announcement.message,
          tag: 'announcement',
          renotify: true,
        },
      });

      const pushResults = await Promise.allSettled(
        subscribers.map(async (subscriber) => {
          const pushSubscription = {
            endpoint: subscriber.endpoint,
            keys: { p256dh: subscriber.p256dh, auth: subscriber.auth },
          };
          await webpush.sendNotification(pushSubscription, payload);
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

      // Batch log failures for push notifications
      const failedPushResults = pushResults.filter(result => result.status === 'rejected');
      if (failedPushResults.length > 0) {
        const values = failedPushResults.map((_, idx) =>
          `($1, 'push', 'failed', $${idx + 2})`
        ).join(', ');
        const errorMessages = failedPushResults.map(result =>
          result.reason?.message || 'Push send failed'
        );

        await pool.query(
          `INSERT INTO announcement_logs (announcement_id, channel, status, error_message)
           VALUES ${values}`,
          [announcement.id, ...errorMessages]
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
      // An alumni mailing has no roles to pick from, so the requirement only
      // applies to the unit's own audience.
      check('recipient_roles')
        .if((_value, { req }) => req.body?.audience !== ALUMNI_AUDIENCE)
        .isArray({ min: 1 }).withMessage('recipient_roles must include at least one role'),
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
        normalized.roles = await filterRolesInUnit(pool, normalized.roles, organizationId);

        if (normalized.audience !== ALUMNI_AUDIENCE && !normalized.roles.length) {
          return res.status(400).json({ success: false, message: 'No valid roles provided' });
        }

        const shouldSendNow = normalized.sendNow || !normalized.scheduledAt || normalized.scheduledAt <= new Date();
        const initialStatus = normalized.saveAsDraft
          ? 'draft'
          : shouldSendNow
            ? 'sending'
            : 'scheduled';

        const insertQuery = `
          INSERT INTO announcements
            (organization_id, created_by, subject, message, recipient_roles, recipient_groups, scheduled_at, status, audience)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
   * List announcements with delivery logs
   */
  router.get('/v1/announcements', authenticate, requirePermission(['communications.send']), asyncHandler(async (req, res) => {
    try {

      const organizationId = await getOrganizationId(req, pool);

      const announcementsQuery = `
        SELECT id, subject, message, recipient_roles, recipient_groups, audience, scheduled_at, sent_at, status, created_at
        FROM announcements
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `;
      const announcementsResult = await pool.query(announcementsQuery, [organizationId]);

      const announcementIds = announcementsResult.rows.map((row) => row.id);
      let logsByAnnouncement = {};
      if (announcementIds.length) {
        const logsResult = await pool.query(
          `SELECT announcement_id, channel, recipient_email, recipient_user_id, status, error_message, sent_at
           FROM announcement_logs
           WHERE announcement_id = ANY($1::int[])
           ORDER BY sent_at DESC`,
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
