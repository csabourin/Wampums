/**
 * The delivery log of one announcement: every email and push it sent, to
 * whom, and why a failed one failed. Push rows name the account whose device
 * it was, so a sender can see that a push went only to the people chosen and
 * which of their devices no longer receive.
 *
 * @module spa/modules/announcements/deliveryLog
 */

import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';

/**
 * One log row as a list item.
 *
 * @param {Object} log - Row from GET /api/v1/announcements
 * @returns {string} HTML
 */
function renderLogRow(log) {
  const channel = log.channel === 'push'
    ? translate('delivery_log_push')
    : translate(log.channel) || log.channel;
  const recipient = log.recipient_name || log.recipient_email || translate('delivery_log_unknown_recipient');
  const status = translate(log.status) || log.status;
  const device = log.push_service
    ? ` · ${escapeHTML(translate('delivery_log_device').replace('{service}', log.push_service))}`
    : '';
  const reason = log.error_message ? ` : ${escapeHTML(log.error_message)}` : '';
  return `
    <li class="delivery-log__row delivery-log__row--${log.status === 'failed' ? 'failed' : 'sent'}">
      <span class="delivery-log__what">${escapeHTML(channel)} — ${escapeHTML(status)}</span>
      <span class="delivery-log__who">${escapeHTML(recipient)}${device}${reason}</span>
    </li>
  `;
}

/**
 * The collapsible delivery log, failures first.
 *
 * @param {Object[]} logs - The announcement's log rows
 * @returns {string} HTML, empty without rows
 */
export function renderDeliveryLog(logs) {
  if (!logs.length) {
    return '';
  }
  const ordered = [...logs].sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'));
  return `
    <details class="delivery-log">
      <summary>${escapeHTML(translate('delivery_logs'))} (${logs.length})</summary>
      <ul class="delivery-log__list">${ordered.map(renderLogRow).join('')}</ul>
    </details>
  `;
}
