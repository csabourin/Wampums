/**
 * Medication Reminder Service
 *
 * Runs a background interval that checks for scheduled medication distributions
 * due within the next REMINDER_WINDOW_MINUTES and sends a real Web Push
 * notification to every subscriber in that organisation who holds the
 * `medication.view` permission.
 *
 * Reminders are only dispatched while an activity is actively running in the
 * organisation (guards against waking people up outside of camp hours).
 *
 * A `reminder_sent_at` timestamp on each distribution row prevents duplicate
 * notifications for the same dose.
 */

'use strict';

const { getTranslationsByCode } = require('../utils/index');

const REMINDER_WINDOW_MINUTES = 15; // notify this many minutes before a dose is due
const POLL_INTERVAL_MS = 60_000;    // check every 60 seconds

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
   * 1. Find distributions due in the next REMINDER_WINDOW_MINUTES that:
   *    - are still 'scheduled' with no reminder sent yet, AND
   *    - have a currently-running activity in their organisation (so we
   *      never notify outside of camp/activity hours).
   * 2. For each unique organisation, fetch push subscribers who hold
   *    `medication.view` permission.
   * 3. Send a Web Push notification to each eligible subscriber.
   * 4. Mark the distribution as notified.
   */
  async _checkAndSendReminders() {
    const { pool, logger } = this;

    // ------------------------------------------------------------------ //
    // 1. Find upcoming distributions needing a reminder.
    //
    //    The EXISTS sub-query enforces "only during an active activity":
    //    activities store date and time as separate columns without timezone
    //    context, so we compare against NOW()::timestamp (server-local).
    //    This works correctly when the server runs in the same civil timezone
    //    as the organisations it serves.
    // ------------------------------------------------------------------ //
    const upcomingResult = await pool.query(
      `SELECT
         md.id,
         md.organization_id,
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
         AND EXISTS (
           SELECT 1
           FROM activities a
           WHERE a.organization_id = md.organization_id
             AND (a.activity_start_date + a.activity_start_time)::timestamp <= NOW()::timestamp
             AND (a.activity_end_date   + a.activity_end_time  )::timestamp >= NOW()::timestamp
         )
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
      //    Include user language preference for localized notifications
      // ---------------------------------------------------------------- //
      const subscriberResult = await pool.query(
        `SELECT DISTINCT s.endpoint, s.p256dh, s.auth, s.user_id, u.language_preference
         FROM subscribers s
         JOIN users u ON u.id = s.user_id
         JOIN user_organizations uo
           ON uo.user_id = s.user_id AND uo.organization_id = s.organization_id
         CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
         JOIN role_permissions rp ON rp.role_id = role_id_text::integer
         JOIN permissions perm ON perm.id = rp.permission_id
         WHERE s.organization_id = $1
           AND perm.permission_key = 'medication.view'`,
        [orgId]
      );

      const subscribers = subscriberResult.rows;
      if (subscribers.length === 0) {
        // Do NOT mark as sent – a subscriber might register before the dose
        // window closes, and we should still notify them.
        logger.debug(`[MedicationReminders] No eligible subscribers for org ${orgId}, will retry`);
        continue;
      }

      // ---------------------------------------------------------------- //
      // 5. Send one notification per distribution to all subscribers.
      //
      //    Each notification is personalized with the subscriber's language
      //    preference using the translation system.
      //
      //    The payload passes `scheduledFor` as an ISO string so the
      //    service worker can format the time in the *device's* local
      //    timezone rather than the server's timezone.
      // ---------------------------------------------------------------- //
      for (const dist of distributions) {
        const scheduledAt = new Date(dist.scheduled_for);
        const minutesUntil = Math.round((scheduledAt - Date.now()) / 60_000);
        const participantName = `${dist.first_name} ${dist.last_name}`.trim();

        const sendResults = await Promise.allSettled(
          subscribers.map(sub => {
            // Get translations for this subscriber's language
            const userLang = (sub.language_preference || 'en').toLowerCase();
            const translations = getTranslationsByCode(userLang);
            
            // Use translation keys or fallback to English
            const title = translations.medication_reminder_push_title || 'Medication reminder';
            
            // Note: The service worker appends @ {time} to the body automatically
            // when scheduledFor is present in the data payload
            const body = minutesUntil <= 1
              ? (translations.medication_reminder_push_body_due_now || '{participant} – {medication} is due now')
                  .replace('{participant}', participantName)
                  .replace('{medication}', dist.medication_name)
              : (translations.medication_reminder_push_body_due_soon || '{participant} – {medication} ({minutes} min)')
                  .replace('{participant}', participantName)
                  .replace('{medication}', dist.medication_name)
                  .replace('{minutes}', minutesUntil);

            const payload = JSON.stringify({
              title,
              body,
              tag: `medication-${dist.id}`,
              requireInteraction: true,
              vibrate: [200, 100, 200],
              data: {
                type: 'medication',
                scheduledFor: scheduledAt.toISOString(), // client formats in its own timezone
                url: '/medication-dispensing',
              },
            });

            return webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload
            );
          })
        );

        const failures = sendResults.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
          logger.warn(
            `[MedicationReminders] ${failures.length}/${subscribers.length} push(es) failed for dist ${dist.id}`,
            failures.map(f => f.reason?.message)
          );
          await this._removeExpiredSubscriptions(failures);
        }

        await this._markSent([dist.id]);
        logger.info(
          `[MedicationReminders] Reminder sent for dist ${dist.id} (${participantName} – ${dist.medication_name})`
        );
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
   */
  async _removeExpiredSubscriptions(failures) {
    const expiredEndpoints = failures
      .filter(f => f.reason?.statusCode === 410 && f.reason?.endpoint)
      .map(f => f.reason.endpoint);

    if (expiredEndpoints.length === 0) return;

    try {
      // Derive the affected organization_ids for explicit multi-tenant isolation.
      const { rows } = await this.pool.query(
        `SELECT DISTINCT organization_id
           FROM subscribers
          WHERE endpoint = ANY($1::text[])`,
        [expiredEndpoints]
      );

      const organizationIds = rows.map(row => row.organization_id);
      if (organizationIds.length === 0) {
        return;
      }

      await this.pool.query(
        `DELETE FROM subscribers
          WHERE endpoint = ANY($1::text[])
            AND organization_id = ANY($2::int[])`,
        [expiredEndpoints, organizationIds]
      );
      this.logger.info(`[MedicationReminders] Removed ${expiredEndpoints.length} expired subscription(s)`);
    } catch (err) {
      this.logger.error('[MedicationReminders] Error removing expired subscriptions:', err);
    }
  }
}

module.exports = MedicationReminderService;
