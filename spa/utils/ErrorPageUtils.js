/**
 * The page shown in place of a screen that could not be drawn, and the
 * wording it falls back on when the app failed before its translations
 * arrived.
 *
 * @module spa/utils/ErrorPageUtils
 */

import { STARTUP_TEXTS } from '../config/startup-texts.js';
import {
  DEFAULT_FALLBACK_LANG,
  DEFAULT_LANG,
  OPTIONAL_LANGS,
  SUPPORTED_LANGS,
} from '../config/languages.js';
import { clearElement, createElement } from './DOMUtils.js';

/**
 * The core language to show built-in texts in: the reader's own when it is
 * French or English, else the fallback of their optional language.
 *
 * @param {?string} lang - Reader's language
 * @param {?string} fallbackLang - Fallback of an optional language
 * @returns {string} 'en' or 'fr'
 */
export function startupLanguage(lang, fallbackLang) {
  if (SUPPORTED_LANGS.includes(lang)) {
    return lang;
  }
  if (OPTIONAL_LANGS.includes(lang)) {
    return SUPPORTED_LANGS.includes(fallbackLang) ? fallbackLang : DEFAULT_FALLBACK_LANG;
  }
  return DEFAULT_LANG;
}

/**
 * A translate function over the built-in startup texts. A key it does not
 * hold comes back unchanged, as translate() does.
 *
 * @param {string} lang - 'en' or 'fr'
 * @returns {function(string): string} Lookup
 */
export function startupTranslator(lang) {
  const texts = STARTUP_TEXTS[lang] || STARTUP_TEXTS[DEFAULT_LANG];
  return (key) => texts[key] || key;
}

/**
 * Replace the container's content with an error page: a heading, the
 * message announced to screen readers, and ways forward.
 *
 * @param {HTMLElement} container - Usually #app
 * @param {Object} options
 * @param {string} options.title - Heading text
 * @param {string} options.message - What went wrong, in the reader's language
 * @param {function(string): string} options.text - Translate function for the labels
 * @param {boolean} [options.isLoggedIn=false] - Offer the way back to the dashboard
 * @param {boolean} [options.showReload=false] - Offer to reload the page
 * @param {?Array<{labelKey: string, href: string}>} [options.actions] - Links; signed out, defaults to home
 * @param {function(): void} [options.reload] - What the reload button does
 * @returns {void}
 */
export function renderErrorPage(container, {
  title,
  message,
  text,
  isLoggedIn = false,
  showReload = false,
  actions = null,
  reload = () => window.location.reload(),
}) {
  clearElement(container);

  // Signed in, the way back is the same link every screen opens with.
  if (isLoggedIn) {
    container.appendChild(createElement('a', {
      text: `← ${text('back')}`,
      className: 'button button--ghost',
      attributes: { href: '/dashboard' },
    }));
  }

  const page = createElement('div', { className: 'error-container' });
  page.appendChild(createElement('h1', { text: title }));
  page.appendChild(createElement('p', { text: message, attributes: { role: 'alert' } }));

  const links = actions || (isLoggedIn ? [] : [{ labelKey: 'back_to_home', href: '/' }]);
  if (links.length || showReload) {
    const wrapper = createElement('div', { className: 'error-actions' });
    if (showReload) {
      const reloadButton = createElement('button', {
        text: text('reload'),
        className: 'button button--primary',
        attributes: { type: 'button' },
      });
      reloadButton.addEventListener('click', () => reload());
      wrapper.appendChild(reloadButton);
    }
    links.forEach((action) => {
      wrapper.appendChild(createElement('a', {
        text: text(action.labelKey),
        className: 'button button--secondary',
        attributes: { href: action.href },
      }));
    });
    page.appendChild(wrapper);
  }

  container.appendChild(page);
}
