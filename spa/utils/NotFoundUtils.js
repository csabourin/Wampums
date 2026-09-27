/**
 * NotFoundUtils.js
 *
 * Shared helper for consistent "resource not found" UI states.
 *
 * @module utils/NotFoundUtils
 */

import { translate } from '../app.js';
import { escapeHTML } from './SecurityUtils.js';
import { renderBackLink } from './BackLinkUtils.js';

/**
 * Build a consistent "not found" state markup.
 * @param {Object} options
 * @param {string} [options.titleKey] - Translation key for the title.
 * @param {string} [options.messageKey] - Translation key for the message body.
 * @param {string} [options.resourceLabel] - Optional resource label to display.
 * @param {string} [options.backHref] - Where the back link leads.
 * @returns {string} HTML string for the not found state.
 */
export function buildNotFoundMarkup({
  titleKey = 'resource_not_found_title',
  messageKey = 'resource_not_found_message',
  resourceLabel = '',
  backHref = '/dashboard'
} = {}) {
  const safeLabel = resourceLabel ? escapeHTML(resourceLabel) : '';

  return `
    ${renderBackLink(backHref)}
    <section class="page not-found-state">
      <div class="not-found-state__card">
        <h2>${translate(titleKey)}</h2>
        <p class="not-found-state__message">${translate(messageKey)}</p>
        ${safeLabel ? `<p class="not-found-state__detail">${safeLabel}</p>` : ''}
      </div>
    </section>
  `;
}

export default {
  buildNotFoundMarkup
};
