/**
 * The loading and error states every screen shows while its data is not there.
 *
 * CLAUDE.md §7: a screen opens with the way back above its title in every
 * state; loading is announced politely (role="status") with the page marked
 * busy, and a failed load is an alert with a retry button, never an empty list.
 *
 * @module spa/utils/PageStateUtils
 */

import { translate } from '../app.js';
import { escapeHTML } from './SecurityUtils.js';
import { renderBackLink } from './BackLinkUtils.js';
import { setContent } from './DOMUtils.js';

/**
 * @typedef {Object} PageStateOptions
 * @property {string} title - The page title, already translated (escaped here)
 * @property {string} [className] - The screen's own class on the page section
 * @property {string} [backHref='/dashboard'] - Where the back link leads
 * @property {boolean} [embedded=false] - Drawn inside a page that already shows
 *   the way back and the title (a tab of a tabbed page): only the state itself
 */

/**
 * @param {string} className - Extra classes
 * @returns {string} The section's class attribute value
 */
function sectionClass(className) {
  return `page${className ? ` ${escapeHTML(className)}` : ''}`;
}

/**
 * Markup for a page still loading.
 *
 * @param {PageStateOptions} options
 * @returns {string} HTML
 */
export function pageLoadingMarkup({ title, className = '', backHref = '/dashboard', embedded = false }) {
  if (embedded) {
    return `
    <div class="${escapeHTML(className)}" aria-busy="true">
      <p role="status">${escapeHTML(translate('loading'))}</p>
    </div>`;
  }
  return `
    <section class="${sectionClass(className)}" aria-busy="true">
      ${renderBackLink(backHref)}
      <h1>${escapeHTML(title)}</h1>
      <p role="status">${escapeHTML(translate('loading'))}</p>
    </section>`;
}

/**
 * Markup for a page whose data could not be loaded.
 *
 * @param {PageStateOptions & {message?: string, retryId?: string}} options -
 *   `message` is shown as text (default error_loading_data); `retryId` names the
 *   retry button, which is left out when there is none.
 * @returns {string} HTML
 */
export function pageErrorMarkup({
  title, className = '', backHref = '/dashboard', message = translate('error_loading_data'), retryId = '', embedded = false,
}) {
  const retry = retryId
    ? `<button type="button" class="button button--primary" id="${escapeHTML(retryId)}">${escapeHTML(translate('retry'))}</button>`
    : '';
  if (embedded) {
    return `
    <div class="${escapeHTML(className)}">
      <p class="status-message error" role="alert">${escapeHTML(message)}</p>
      ${retry}
    </div>`;
  }
  return `
    <section class="${sectionClass(className)}">
      ${renderBackLink(backHref)}
      <h1>${escapeHTML(title)}</h1>
      <p class="status-message error" role="alert">${escapeHTML(message)}</p>
      ${retry}
    </section>`;
}

/**
 * Show the loading state in a container.
 *
 * @param {HTMLElement|null} root - Usually #app
 * @param {PageStateOptions} options
 * @returns {void}
 */
export function showPageLoading(root, options) {
  if (root) {
    setContent(root, pageLoadingMarkup(options));
  }
}

/**
 * Show the error state in a container, with a retry button when `onRetry` is given.
 *
 * @param {HTMLElement|null} root - Usually #app
 * @param {PageStateOptions & {message?: string, retryId?: string}} options
 * @param {Function} [onRetry] - Called when the person asks to try again
 * @returns {void}
 */
export function showPageError(root, options, onRetry) {
  if (!root) {
    return;
  }
  const retryId = onRetry ? (options.retryId || 'page-retry') : '';
  setContent(root, pageErrorMarkup({ ...options, retryId }));
  if (onRetry) {
    root.querySelector(`#${retryId}`)?.addEventListener('click', () => onRetry());
  }
}
