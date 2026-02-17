/**
 * Medication Reminder Service
 *
 * Runs a background interval that checks for scheduled medication distributions
 * due within the next REMINDER_WINDOW_MINUTES and sends a real Web Push
 * notification to every subscriber in that organisation who holds the
 * `medication.view` permission.
 *
 * A `reminder_sent_at` timestamp on each distribution row prevents duplicate
 * notifications for the same dose.
 */

'use strict';

const REMINDER_WINDOW_MINUTES = 15; // notify this many minutes before a dose is due
const POLL_INTERVAL_MS = 60_000;    // check every 60 seconds

/**
 * Format a scheduled_for Date into a short HH:MM string.
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  return date.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

class MedicationReminderService {
  /**
   * @param {import('pg').Pool} pool
   * @param {import('winston').Logger} logger
   */
  constructor(pool, logger) {
    this.pool = pool;
    this.logger = logger;
    this._intervalId = null;
    this._running = false;
  }

  /** Start the polling interval. Safe to call multiple times. */
  start() {
    if (this._intervalId) return;
    this.logger.info('[MedicationReminders] Service started (poll every 60s, window: 15 min)');
    // Run immediately, then on each interval tick
    this._tick();
    this._intervalId = setInterval(() => this._tick(), POLL_INTERVAL_MS);
  }

  /** Stop the polling interval on graceful shutdown. */
  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      this.logger.info('[MedicationReminders] Service stopped');
    }
  }

  /** Single poll cycle – wrapped so errors never crash the interval. */
  async _tick() {
    if (this._running) return; // skip if previous tick is still processing
    this._running = true;
    try {
      await this._checkAndSendReminders();
    } catch (err) {
      this.logger.error('[MedicationReminders] Unhandled error in tick:', err);
    } finally {
      this._running = false;
    }
  }

  /**
   * Core logic:
   * 1. Find distributions due in the next REMINDER_WINDOW_MINUTES that have not
   *    yet had a reminder sent.
   * 2. For each unique organisation, fetch push subscribers who hold
   *    `medication.view` permission.
   * 3. Send a Web Push notification to each eligible subscriber.
   * 4. Mark the distribution as notified.
   */
  async _checkAndSendReminders() {
    const { pool, logger } = this;

    // ------------------------------------------------------------------ //
    // 1. Find upcoming distributions needing a reminder
    // ------------------------------------------------------------------ //
    const upcomingResult = await pool.query(
      `SELECT
         md.id,
         md.organization_id,
         md.participant_id,
         md.medication_requirement_id,
         md.scheduled_for,
         md.activity_name,
         mr.medication_name,
         p.first_name,
         p.last_name
       FROM medication_distributions md
       JOIN medication_requirements mr
         ON mr.id = md.medication_requirement_id
       JOIN participants p
         ON p.id = md.participant_id
       WHERE md.status = 'scheduled'
         AND md.reminder_sent_at IS NULL
         AND md.scheduled_for > NOW()
         AND md.scheduled_for <= NOW() + ($1 || ' minutes')::INTERVAL
       ORDER BY md.organization_id, md.scheduled_for`,
      [REMINDER_WINDOW_MINUTES]
    );

    if (upcomingResult.rows.length === 0) return;

    logger.info(`[MedicationReminders] ${upcomingResult.rows.length} distribution(s) need reminders`);

    // ------------------------------------------------------------------ //
    // 2. Load web-push – bail gracefully if VAPID keys not configured
    // ------------------------------------------------------------------ //
    let webpush;
    try {
      webpush = require('web-push');
    } catch {
      logger.warn('[MedicationReminders] web-push not installed – skipping');
      return;
    }

    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE;

    if (!vapidPublicKey || !vapidPrivateKey) {
      logger.warn('[MedicationReminders] VAPID keys not configured – skipping push notifications');
      return;
    }

    webpush.setVapidDetails('mailto:info@wampums.app', vapidPublicKey, vapidPrivateKey);

    // ------------------------------------------------------------------ //
    // 3. Group distributions by organisation
    // ------------------------------------------------------------------ //
    const byOrg = new Map();
    for (const row of upcomingResult.rows) {
      const orgId = row.organization_id;
      if (!byOrg.has(orgId)) byOrg.set(orgId, []);
      byOrg.get(orgId).push(row);
    }

    for (const [orgId, distributions] of byOrg) {
      // ---------------------------------------------------------------- //
      // 4. Find subscribers with medication.view permission in this org
      // ---------------------------------------------------------------- //
      const subscriberResult = await pool.query(
        `SELECT DISTINCT s.endpoint, s.p256dh, s.auth, s.user_id
         FROM subscribers s
         JOIN user_organizations uo ON uo.user_id = s.user_id AND uo.organization_id = s.organization_id
         CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
         JOIN role_permissions rp ON rp.role_id = role_id_text::integer
         JOIN permissions perm ON perm.id = rp.permission_id
         WHERE s.organization_id = $1
           AND perm.permission_key = 'medication.view'`,
        [orgId]
      );

      const subscribers = subscriberResult.rows;
      if (subscribers.length === 0) {
        logger.debug(`[MedicationReminders] No eligible subscribers for org ${orgId}`);
        // Still mark as sent so we don't retry forever
        await this._markSent(distributions.map(d => d.id));
        continue;
      }

      // ---------------------------------------------------------------- //
      // 5. Send one notification per distribution to all subscribers
      // ---------------------------------------------------------------- //
      for (const dist of distributions) {
        const scheduledAt = new Date(dist.scheduled_for);
        const timeStr = formatTime(scheduledAt);
        const participantName = `${dist.first_name} ${dist.last_name}`.trim();
        const minutesUntil = Math.round((scheduledAt - Date.now()) / 60_000);

        const title = 'Medication reminder / Rappel de médicament';
        const body = minutesUntil <= 1
          ? `${participantName} – ${dist.medication_name} (now / maintenant)`
          : `${participantName} – ${dist.medication_name} @ ${timeStr} (${minutesUntil} min)`;

        const payload = JSON.stringify({
          title,
          body,
          tag: `medication-${dist.id}`,
          requireInteraction: true,
          vibrate: [200, 100, 200],
          data: { url: '/medication-dispensing' },
        });

        const sendResults = await Promise.allSettled(
          subscribers.map(sub =>
            webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload
            )
          )
        );

        const failures = sendResults.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
          logger.warn(
            `[MedicationReminders] ${failures.length}/${subscribers.length} push(es) failed for dist ${dist.id}`,
            failures.map(f => f.reason?.message)
          );
          // Clean up expired subscriptions (410 Gone)
          await this._removeExpiredSubscriptions(failures, subscribers);
        }

        await this._markSent([dist.id]);
        logger.info(`[MedicationReminders] Reminder sent for dist ${dist.id} (${participantName} – ${dist.medication_name})`);
      }
    }
  }

  /**
   * Set reminder_sent_at = NOW() on the given distribution IDs.
   * @param {number[]} ids
   */
  async _markSent(ids) {
    if (ids.length === 0) return;
    await this.pool.query(
      `UPDATE medication_distributions
       SET reminder_sent_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
  }

  /**
   * Remove push subscriptions that returned HTTP 410 (subscription expired/unsubscribed).
   * @param {PromiseSettledResult[]} failures - rejected send results
   * @param {object[]} subscribers - subscriber rows (same order as sendResults)
   */
  async _removeExpiredSubscriptions(failures, subscribers) {
    const expiredEndpoints = [];

    for (const failure of failures) {
      if (failure.reason?.statusCode === 410) {
        // Match endpoint by position – web-push throws with statusCode on 410
        const endpoint = failure.reason?.endpoint;
        if (endpoint) expiredEndpoints.push(endpoint);
      }
    }

    if (expiredEndpoints.length === 0) return;

    try {
      await this.pool.query(
        `DELETE FROM subscribers WHERE endpoint = ANY($1::text[])`,
        [expiredEndpoints]
      );
      this.logger.info(`[MedicationReminders] Removed ${expiredEndpoints.length} expired subscription(s)`);
    } catch (err) {
      this.logger.error('[MedicationReminders] Error removing expired subscriptions:', err);
    }
  }
}

module.exports = MedicationReminderService;
