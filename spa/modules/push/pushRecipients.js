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
