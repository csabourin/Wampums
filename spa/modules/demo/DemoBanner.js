/**
 * Demo Banner
 *
 * Tells a demo visitor, on every screen, what they may try and what stays
 * read-only, so a refused change reads as part of the demo rather than as a
 * fault. In the demo unit (demo_sign_in) the leader view may award points,
 * take attendance and award honors (middleware/demoSandbox.js), and all of it
 * is put back every night; anything written in words stays read-only.
 *
 * Like the scout-year banner, it lives just before `#app`, so it survives
 * every route change. Signing out reloads the page, which removes it.
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { hasAnyPermission, isDemoSandbox, isDemoUser } from '../../utils/PermissionUtils.js';

const ELEMENT_ID = 'demo-banner';

/** The writes the demo unit lets a visitor try; holding one makes the banner say so. */
const SANDBOX_PERMISSIONS = Object.freeze(['points.manage', 'attendance.manage', 'honors.create']);

/**
 * @returns {string} Translation key for what this visitor may do
 */
function noticeKey() {
  if (!isDemoSandbox()) {
    return 'demo_banner_read_only';
  }
  return hasAnyPermission(...SANDBOX_PERMISSIONS) ? 'demo_banner_sandbox' : 'demo_banner_parent';
}

/**
 * Find or create the host element, just before the app root.
 *
 * @returns {HTMLElement} Banner container
 */
function hostElement() {
  let element = document.getElementById(ELEMENT_ID);
  if (!element) {
    element = document.createElement('div');
    element.id = ELEMENT_ID;
    element.className = 'demo-banner';
    const appRoot = document.getElementById('app');
    if (appRoot && appRoot.parentNode) {
      appRoot.parentNode.insertBefore(element, appRoot);
    } else {
      document.body.insertBefore(element, document.body.firstChild);
    }
  }
  return element;
}

/**
 * Show the banner to a demo account, and clear it for anyone else.
 * Safe to call more than once.
 *
 * @returns {void}
 */
export function initDemoBanner() {
  if (!isDemoUser()) {
    document.getElementById(ELEMENT_ID)?.remove();
    return;
  }
  setContent(hostElement(), `
    <p class="demo-banner__text">
      <strong class="demo-banner__title">${translate('demo_banner_title')}</strong>
      ${translate(noticeKey())}
    </p>`);
}
