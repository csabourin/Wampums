/**
 * Recipient checkboxes for the push notification form.
 *
 * @module modules/push/pushRecipients
 */

import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';

/**
 * One checkbox per member, whatever the number of browsers or devices they
 * registered. Each checkbox's value is the member's user id.
 *
 * @param {Array<{user_id: string, email: string, full_name?: string, device_count?: number}>} subscribers
 * @returns {string} HTML
 */
export function renderPushRecipients(subscribers) {
  if (!subscribers.length) {
    return `<p>${translate('no_subscribers_found')}</p>`;
  }

  return subscribers
    .map((subscriber, index) => {
      const email = escapeHTML(subscriber.email || '');
      const name = subscriber.full_name ? `${escapeHTML(subscriber.full_name)} – ${email}` : email;
      const devices = subscriber.device_count > 1
        ? ` (${escapeHTML(translate('push_device_count').replace('{count}', subscriber.device_count))})`
        : '';
      return `
        <div class="subscriber-option">
          <input type="checkbox" id="subscriber-${index}" name="subscribers" value="${escapeHTML(subscriber.user_id)}">
          <label for="subscriber-${index}">${name}${devices}</label>
        </div>`;
    })
    .join('');
}

/**
 * Translation key describing the outcome of a send. A send that reached no
 * device is not reported as a success.
 *
 * @param {{success?: boolean, queued?: boolean, data?: {sent?: number}}} result
 * @returns {string}
 */
export function pushSendResultKey(result) {
  if (result?.queued) {
    return 'notification_queued_offline';
  }
  if (!result?.success) {
    return 'failed_to_send_notification';
  }
  if (result.data?.sent === 0) {
    return 'push_nobody_reached';
  }
  return 'notification_sent_successfully';
}

/**
 * The outcome of a send, in the page's language. A send that some devices
 * refused says how many were reached and how many refused.
 *
 * @param {{success?: boolean, queued?: boolean, data?: {sent?: number, failed?: number, removed?: number}}} result
 * @returns {string}
 */
export function describePushSendResult(result) {
  const key = pushSendResultKey(result);
  const { sent = 0, failed = 0, removed = 0 } = result?.data || {};
  const refused = failed - removed;
  if (key === 'notification_sent_successfully' && refused > 0) {
    return translate('push_sent_partial')
      .replace('{sent}', String(sent))
      .replace('{refused}', String(refused));
  }
  return translate(key);
}
