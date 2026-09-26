/**
 * Open an emailed link's page in the language its email was written in.
 *
 * The admin chose the invitation's language, or the other parent's language
 * chose the family-link email's. A parent who reads a French email and lands on
 * an English page -- because the browser, or the last person to use it, was set
 * to English -- has been told two different things in two languages about the
 * same decision. So the page adopts the email's language before it says
 * anything. The reader can still switch afterwards; this only picks where they
 * start.
 *
 * @module spa/modules/family-access/linkLanguage
 */

import { CONFIG } from '../../config.js';

/**
 * Switch the app to the link's language when it differs.
 *
 * Once the app has finished starting, changing language reloads the current
 * route, and that reload renders this page again from the start in the new
 * language. The caller must then stop, or two renders of the same page race.
 *
 * @param {Object} app - Application instance
 * @param {string|null|undefined} language - Language the email was written in
 * @returns {Promise<boolean>} True when the page is being re-rendered by a
 *   reload and the caller should stop rendering
 */
export async function adoptLinkLanguage(app, language) {
  if (!language || typeof app?.setLanguage !== 'function') {
    return false;
  }

  const normalized = String(language).slice(0, 2).toLowerCase();
  if (normalized === app.lang || !CONFIG.SUPPORTED_LANGS.includes(normalized)) {
    return false;
  }

  await app.setLanguage(normalized);
  return Boolean(app.router && app.initCompleted);
}
