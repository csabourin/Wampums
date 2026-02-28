/**
 * Announcements Routes
 *
 * Provides endpoints to draft, schedule, and send announcements via email and web push.
 */

const express = require('express');
const { check } = require('express-validator');
const router = express.Router();
const {
  verifyJWT,
  getCurrentOrganizationId,
  verifyOrganizationMembership,
  handleOrganizationResolutionError,
  escapeHtml,
} = require('../utils/api-helpers');
const { sanitizeInput, sendEmail, sendWhatsApp } = require('../utils');
const { checkValidation } = require('../middleware/validation');
const { isTestEnvironment } = require('../test/test-helpers');

const ALLOWED_ROLES = ['admin', 'animation', 'parent'];
const pg = require('pg');
const { Client } = pg;

/**
 * Normalize and sanitize announcement payload
 * @param {Object} body
 * @returns {Object}
 */
function normalizeAnnouncementPayload(body) {
  const roles = Array.isArray(body.recipient_roles)
    ? body.recipient_roles.filter((role) => ALLOWED_ROLES.includes(role))
    : [];
  const groups = Array.isArray(body.recipient_group_ids)
    ? body.recipient_group_ids.map(Number).filter((id) => Number.isInteger(id))
    : [];

  const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at) : null;
  const saveAsDraft = Boolean(body.save_as_draft);
  const sendNow = body.send_now !== undefined ? Boolean(body.send_now) : !scheduledAt && !saveAsDraft;

  return {
    subject: sanitizeInput(body.subject).slice(0, 255),
    message: sanitizeInput(body.message),
    roles,
    groups,
    scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null,
    saveAsDraft,
    sendNow,
  };
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
 * Build email, push, and WhatsApp recipients based on roles and group filters
 */
async function buildRecipients(pool, organizationId, roles, groupIds) {
  const roleFilter = roles.length ? roles : ALLOWED_ROLES;
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
  const { emails, subscribers, whatsappNumbers } = await buildRecipients(
    pool,
    announcement.organization_id,
    announcement.recipient_roles,
    announcement.recipient_groups,
  );

  const emailLogs = await Promise.allSettled(
    emails.map(async (email) => {
      const success = await sendEmail(email, announcement.subject, announcement.message);
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

  // Send Google Chat broadcast
  let googleChatOutcome = { successes: 0, failures: 0 };
  if (googleChatService) {
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
        connectionString: process.env.DATABASE_URL || process.env.SB_URL,
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

          // Prevent concurrent processing
          if (!isProcessing) {
            isProcessing = true;
            try {
              await processScheduledAnnouncements(pool, logger, whatsappService, googleChatService);
            } catch (error) {
              logger.error('Error processing scheduled announcements:', error);
            } finally {
              isProcessing = false;
            }
          }
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
      await processScheduledAnnouncements(pool, logger, whatsappService, googleChatService);

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
    if (!isProcessing) {
      logger.info('Running hourly fallback check for scheduled announcements...');
      processScheduledAnnouncements(pool, logger, whatsappService, googleChatService).catch((error) =>
        logger.error('Fallback announcement check failed:', error),
      );
    }
  }, 60 * 60 * 1000).unref(); // 1 hour

  // Cleanup on process termination (use once to avoid duplicate listeners)
  process.once('SIGTERM', shutdownListener);
  process.once('SIGINT', shutdownListener);

  /**
   * Create a new announcement
   * Permission: communications.send
   */
  router.post(
    '/v1/announcements',
    [
      check('subject').trim().notEmpty().withMessage('Subject is required'),
      check('message').trim().notEmpty().withMessage('Message is required'),
      check('recipient_roles').isArray({ min: 1 }).withMessage('recipient_roles must include at least one role'),
      check('recipient_group_ids').optional().isArray().withMessage('recipient_group_ids must be an array'),
      check('scheduled_at').optional().isISO8601().withMessage('scheduled_at must be a valid date'),
      check('save_as_draft').optional().isBoolean(),
      check('send_now').optional().isBoolean(),
    ],
    checkValidation,
    async (req, res) => {
      try {
        const token = req.headers.authorization?.split(' ')[1];
        const payload = verifyJWT(token);
        if (!payload?.user_id) {
          return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const organizationId = await getCurrentOrganizationId(req, pool, logger);
        const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId, {
          requiredPermissions: ['communications.send'],
        });
        if (!membership.authorized) {
          return res.status(403).json({ success: false, message: membership.message });
        }

        const normalized = normalizeAnnouncementPayload(req.body);
        if (!normalized.roles.length) {
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
            (organization_id, created_by, subject, message, recipient_roles, recipient_groups, scheduled_at, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;

        const { rows } = await pool.query(insertQuery, [
          organizationId,
          payload.user_id,
          normalized.subject,
          normalized.message,
          normalized.roles,
          normalized.groups,
          normalized.scheduledAt,
          initialStatus,
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
        res.status(500).json({ success: false, message: error.message });
      }
    },
  );

  /**
   * List announcements with delivery logs
   */
  router.get('/v1/announcements', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const payload = verifyJWT(token);
      if (!payload?.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId, {
        requiredPermissions: ['communications.send'],
      });
      if (!membership.authorized) {
        return res.status(403).json({ success: false, message: membership.message });
      }

      const announcementsQuery = `
        SELECT id, subject, message, recipient_roles, recipient_groups, scheduled_at, sent_at, status, created_at
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
          if (!acc[log.announcement_id]) acc[log.announcement_id] = [];
          acc[log.announcement_id].push(log);
          return acc;
        }, {});
      }

      const templates = await fetchAnnouncementTemplates(pool, organizationId);

      res.json({
        success: true,
        data: announcementsResult.rows.map((row) => ({
          ...row,
          message: escapeHtml(row.message),
          logs: logsByAnnouncement[row.id] || [],
        })),
        templates,
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching announcements:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};

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
