/**
 * Body scroll locking for modal-style overlays.
 *
 * Screens used to set `document.body.style.overflow = 'hidden'` directly and
 * restore it in their own close handler. Any exit path that did not go through
 * that handler (SPA navigation, a report that redirects to a full page, a module
 * torn down by the router) left the body permanently unscrollable.
 *
 * Locks are reference counted by owner key so nested or concurrent overlays do
 * not release each other's lock, and `releaseAllScrollLocks()` gives the router
 * a single, safe way to guarantee a usable page after navigation.
 *
 * @module utils/ScrollLockUtils
 */

const BODY_LOCK_CLASS = 'modal-open';

/** @type {Set<string>} Owner keys currently holding a lock. */
const activeLocks = new Set();

/** @type {string|null} Inline overflow value captured before the first lock. */
let previousBodyOverflow = null;

/**
 * @returns {HTMLElement|null} The document body, when a DOM is available
 */
function getBody() {
  return typeof document === 'undefined' ? null : document.body;
}

/**
 * Prevent the page behind an overlay from scrolling.
 *
 * @param {string} ownerKey - Stable identifier for the overlay holding the lock
 * @returns {void}
 */
export function lockBodyScroll(ownerKey) {
  const body = getBody();
  if (!body || !ownerKey) {
    return;
  }

  if (activeLocks.size === 0) {
    previousBodyOverflow = body.style.overflow;
  }

  activeLocks.add(ownerKey);
  body.style.overflow = 'hidden';
  body.classList.add(BODY_LOCK_CLASS);
}

/**
 * Release one overlay's lock. Scrolling is restored once no overlay holds a lock.
 *
 * @param {string} ownerKey - The identifier passed to lockBodyScroll
 * @returns {void}
 */
export function unlockBodyScroll(ownerKey) {
  if (!ownerKey || !activeLocks.has(ownerKey)) {
    return;
  }

  activeLocks.delete(ownerKey);
  if (activeLocks.size === 0) {
    restoreBodyScroll();
  }
}

/**
 * Drop every outstanding lock and restore scrolling.
 *
 * Called by the router on navigation: whatever overlay was open belongs to the
 * screen being torn down, so its lock must not outlive it.
 *
 * @returns {void}
 */
export function releaseAllScrollLocks() {
  activeLocks.clear();
  restoreBodyScroll();
}

/**
 * @returns {boolean} True while any overlay holds a scroll lock
 */
export function isBodyScrollLocked() {
  return activeLocks.size > 0;
}

/**
 * Put the body back the way it was before the first lock was taken.
 * @returns {void}
 */
function restoreBodyScroll() {
  const body = getBody();
  if (!body) {
    return;
  }

  // Restore the inline value the page had before locking rather than forcing
  // `auto`, so screens that legitimately set their own overflow keep it.
  if (previousBodyOverflow) {
    body.style.overflow = previousBodyOverflow;
  } else {
    body.style.removeProperty('overflow');
  }
  previousBodyOverflow = null;
  body.classList.remove(BODY_LOCK_CLASS);
}
