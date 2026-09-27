/**
 * The link back to the dashboard that opens every screen.
 *
 * Most screens write this markup by hand; new screens call this so the link
 * keeps the same look and the same place -- first in the page, above the
 * title. `/dashboard` sends a parent to the parent dashboard, so one address
 * serves everyone.
 *
 * @module spa/utils/BackLinkUtils
 */

import { translate } from '../app.js';
import { escapeHTML } from './SecurityUtils.js';

/**
 * Markup for the back link.
 *
 * @param {string} [href='/dashboard'] - Where it leads
 * @returns {string} HTML
 */
export function renderBackLink(href = '/dashboard') {
  return `<a href="${escapeHTML(href)}" class="button button--ghost">← ${escapeHTML(translate('back'))}</a>`;
}
