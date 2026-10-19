/**
 * Where a page starts, for people who cannot see it change.
 *
 * The SPA replaces #app on every navigation. Without help, the browser tab
 * keeps the same title on every screen and keyboard focus falls back to
 * <body> when the link that was pressed disappears, so a screen reader says
 * nothing about the new page and the next Tab starts again from the top.
 *
 * - The document title names the screen, from its <h1> (WCAG 2.4.2).
 * - After a navigation, focus moves to that <h1>, which a screen reader then
 *   announces (WCAG 2.4.3). If the screen draws its heading again while it
 *   loads, focus follows the new heading until the person acts.
 * - The skip link at the top of index.html goes to the same place (WCAG 2.4.1).
 *
 * @module spa/utils/PageFocusUtils
 */

/** Product name closing every document title. */
export const APP_NAME = 'Wampums';

const APP_ROOT_ID = 'app';
const SKIP_LINK_SELECTOR = '.skip-link';
const STOP_FOLLOWING_EVENTS = ['keydown', 'pointerdown'];

let followObserver = null;
let titleObserver = null;

/**
 * @param {Document} [doc=document]
 * @returns {HTMLElement|null} The element every screen renders into
 */
function appRoot(doc = document) {
  return doc.getElementById(APP_ROOT_ID);
}

/**
 * @param {HTMLElement|null} root - Page root
 * @returns {HTMLElement|null} The screen's main heading
 */
function pageHeading(root) {
  return root ? root.querySelector('h1') : null;
}

/**
 * Title for the browser tab and the screen reader's window list.
 *
 * @param {string} [heading] - Text of the screen's main heading
 * @returns {string} "Heading - Wampums", or the product name alone
 */
export function composeDocumentTitle(heading) {
  const text = (heading || '').replace(/\s+/g, ' ').trim();
  return text ? `${text} - ${APP_NAME}` : APP_NAME;
}

/**
 * Name the browser tab after the screen on display.
 *
 * @param {string} fallbackHeading - Used when the screen has no <h1>
 * @param {Document} [doc=document]
 * @returns {string} The title set
 */
export function updateDocumentTitle(fallbackHeading, doc = document) {
  const heading = pageHeading(appRoot(doc));
  const title = composeDocumentTitle(heading?.textContent || fallbackHeading);
  if (doc.title !== title) {
    doc.title = title;
  }
  return title;
}

/**
 * Keep the document title in step with the screen's heading, however late
 * the screen draws it. Called once at start-up.
 *
 * @param {() => string} getFallbackHeading - Title part when a screen has no <h1>
 * @param {Document} [doc=document]
 * @returns {void}
 */
export function initPageTitleSync(getFallbackHeading, doc = document) {
  const root = appRoot(doc);
  if (!root || titleObserver) {
    return;
  }
  const sync = () => updateDocumentTitle(getFallbackHeading(), doc);
  titleObserver = new MutationObserver(sync);
  titleObserver.observe(root, { childList: true, subtree: true, characterData: true });
  sync();
}

/**
 * Focus an element that is not normally focusable, without adding it to the
 * Tab order.
 *
 * @param {HTMLElement} element
 * @param {{preventScroll?: boolean}} [options]
 */
function focusTarget(element, { preventScroll = true } = {}) {
  if (!element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '-1');
  }
  element.focus({ preventScroll });
}

/** Stop moving focus to a redrawn heading. */
export function stopFollowingHeading() {
  if (followObserver) {
    followObserver.disconnect();
    followObserver = null;
  }
  STOP_FOLLOWING_EVENTS.forEach((type) => {
    document.removeEventListener(type, stopFollowingHeading, true);
  });
}

/**
 * Keep focus on the heading while the screen finishes drawing. A screen first
 * draws its loading state, then its content; each replaces the heading focus
 * was moved to, which drops focus to <body>. Following stops as soon as the
 * person presses a key or the pointer, or focus is elsewhere.
 *
 * @param {HTMLElement} root - Page root
 */
function followHeading(root) {
  followObserver = new MutationObserver(() => {
    const active = document.activeElement;
    if (active && active !== document.body) {
      if (!root.contains(active)) {
        stopFollowingHeading();
      }
      return;
    }
    const heading = pageHeading(root);
    if (heading) {
      focusTarget(heading);
    }
  });
  followObserver.observe(root, { childList: true, subtree: true });
  STOP_FOLLOWING_EVENTS.forEach((type) => {
    document.addEventListener(type, stopFollowingHeading, true);
  });
}

/**
 * Move focus to the start of the screen: its <h1>, or #app itself.
 *
 * Focus the new screen placed inside #app itself (a sign-in field, for
 * instance) is left where it is. Focus still on `previousFocus`, the element
 * that had it when the navigation began, is not the screen's choice.
 *
 * @param {{preventScroll?: boolean, follow?: boolean, previousFocus?: Element|null}} [options]
 *   `follow`: keep focus on the heading while the screen redraws it
 * @returns {boolean} Whether focus moved to the start of the screen
 */
export function focusPageStart({ preventScroll = true, follow = true, previousFocus = null } = {}) {
  stopFollowingHeading();
  const root = appRoot();
  if (!root) {
    return false;
  }
  const active = document.activeElement;
  if (active && active !== root && active !== previousFocus && root.contains(active)) {
    return false;
  }
  const target = pageHeading(root) || root;
  focusTarget(target, { preventScroll });
  if (follow) {
    followHeading(root);
  }
  return document.activeElement === target;
}

/**
 * Make the skip link land on the screen's heading rather than only scroll:
 * #app's content changes on every navigation, the link's target does not.
 *
 * @param {Document} [doc=document]
 * @returns {void}
 */
export function initSkipLink(doc = document) {
  const link = doc.querySelector(SKIP_LINK_SELECTOR);
  if (!link || link.dataset.skipLinkReady === 'true') {
    return;
  }
  link.dataset.skipLinkReady = 'true';
  link.addEventListener('click', (event) => {
    event.preventDefault();
    focusPageStart({ preventScroll: false, follow: false });
  });
}
