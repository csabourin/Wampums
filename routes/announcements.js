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
const { sanitizeInput, sendEmail } = require('../utils');
const { checkValidation } = require('../middleware/validation');

const ALLOWED_ROLES = ['admin', 'animation', 'parent'];
const SCHEDULE_POLL_INTERVAL_MS = 60 * 1000;

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
 * Build email and push recipients based on roles and group filters
 */
async function buildRecipients(pool, organizationId, roles, groupIds) {
  const roleFilter = roles.length ? roles : ALLOWED_ROLES;
  const includeParents = roleFilter.includes('parent');
  const groupFilterClause = groupIds.length ? 'AND pgroups.group_id = ANY($2::int[])' : '';
  const groupParams = groupIds.length ? [organizationId, groupIds] : [organizationId];

  // User roles (admins/animation/parents as users)
  const userRoleQuery = `
    SELECT LOWER(u.email) AS email, u.id AS user_id, uo.role
    FROM user_organizations uo
    JOIN users u ON u.id = uo.user_id
    WHERE uo.organization_id = $1
      AND uo.role = ANY($${groupParams.length + 1}::text[])
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
  const roleEmails = userRoleResult.rows
    .filter((row) => !row.role || roleFilter.includes(row.role))
    .map((row) => row.email);

  const allEmails = [...roleEmails, ...guardianEmails, ...participantEmails].filter(Boolean);
  const uniqueEmails = [...new Set(allEmails)];

  // Push subscribers limited to requested roles
  const subscriberQuery = `
    SELECT s.endpoint, s.p256dh, s.auth, s.user_id
    FROM subscribers s
    JOIN user_organizations uo ON uo.user_id = s.user_id
    WHERE s.organization_id = $1
      AND uo.role = ANY($2::text[])
  `;
  const subscribersResult = await pool.query(subscriberQuery, [organizationId, roleFilter]);

  return {
    emails: uniqueEmails,
    subscribers: subscribersResult.rows,
  };
}

/**
 * Send announcement via email and push
 */
async function dispatchAnnouncement(pool, logger, announcement) {
  const { emails, subscribers } = await buildRecipients(
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

      // Log failures individually
      for (const result of pushResults) {
        if (result.status === 'rejected') {
          await pool.query(
            `INSERT INTO announcement_logs (announcement_id, channel, status, error_message)
             VALUES ($1, 'push', 'failed', $2)`,
            [announcement.id, result.reason?.message || 'Push send failed'],
          );
        }
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

  const emailFailures = emailLogs.filter((log) => log.status === 'fulfilled' && !log.value).length;
  const pushFailures = pushOutcome.failures;
  const hasFailures = emailFailures > 0 || pushFailures > 0;

  await pool.query(
    `UPDATE announcements
     SET status = $1,
         sent_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [hasFailures ? 'partial' : 'sent', announcement.id],
  );

  return { emailFailures, pushFailures };
}

/**
 * Claim and send due scheduled announcements
 */
async function processScheduledAnnouncements(pool, logger) {
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
      await dispatchAnnouncement(pool, logger, announcement);
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

module.exports = (pool, logger) => {
  // Background poller to process scheduled announcements
  setInterval(() => {
    processScheduledAnnouncements(pool, logger).catch((error) =>
      logger.error('Scheduled announcement poller failed:', error),
    );
  }, SCHEDULE_POLL_INTERVAL_MS).unref();

  /**
   * Create a new announcement
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
        const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId, ['admin', 'animation']);
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
          await dispatchAnnouncement(pool, logger, announcement);
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
      const membership = await verifyOrganizationMembership(pool, payload.user_id, organizationId, ['admin', 'animation']);
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
