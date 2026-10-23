/**
 * Demo Banner
 *
 * Tells a demo visitor, on every screen, what they may try and what stays
 * read-only, so a refused change reads as part of the demo rather than as a
 * fault. In the demo unit (demo_sign_in) the leader view may award points,
 * take attendance and award honors (middleware/demoSandbox.js), and all of it
 * is put back every night; anything written in words stays read-only.
 *
 * In the demo unit it also holds the demo's missions: a short, collapsible
 * tour of Saint-Bivouac, one list for the leader view and one for the parent
 * view, each mission a link to the screen it is about. Which missions a
 * visitor ticked, and whether the list is open, stay in this browser
 * (`demo_missions`, kept across sign-out so switching views keeps them).
 *
 * Like the scout-year banner, it lives just before `#app`, so it survives
 * every route change. Signing out reloads the page, which removes it.
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { getStorageJSON, setStorage } from '../../utils/StorageUtils.js';
import {
  canAccessParentTools,
  canFollowPermissionSlips,
  canManagePoints,
  canViewActivities,
  canViewAttendance,
  canViewBadges,
  canViewCarpools,
  hasAnyPermission,
  holdsFamilyRole,
  isDemoSandbox,
  isDemoUser,
} from '../../utils/PermissionUtils.js';

const ELEMENT_ID = 'demo-banner';
/** Browser storage key; also listed in StorageUtils' keys kept across sign-out. */
export const DEMO_MISSIONS_STORAGE_KEY = 'demo_missions';

/** Wide enough for the open mission list to sit beside the page rather than bury it. */
const WIDE_SCREEN_QUERY = '(min-width: 768px)';

/** The writes the demo unit lets a visitor try; holding one makes the banner say so. */
const SANDBOX_PERMISSIONS = Object.freeze(['points.manage', 'attendance.manage', 'honors.create']);

/**
 * The tour, by view. `key` names the `demo_mission_<key>_title` and
 * `_text` strings; a mission whose screen this account cannot open is left out.
 */
const LEADER_MISSIONS = Object.freeze([
  { key: 'points', href: '/manage-points', available: canManagePoints },
  { key: 'attendance', href: '/attendance', available: canViewAttendance },
  { key: 'honors', href: '/manageHonors', available: canManagePoints },
  { key: 'badges', href: '/badge-tracker', available: canViewBadges },
  { key: 'activities', href: '/activities', available: canViewActivities },
  { key: 'parent_view', href: '/logout', available: () => true },
]);

const PARENT_MISSIONS = Object.freeze([
  { key: 'family', href: '/parent-dashboard', available: canAccessParentTools },
  { key: 'slips', href: '/permission-slips', available: canFollowPermissionSlips },
  { key: 'carpool', href: '/carpool', available: () => holdsFamilyRole() || canViewCarpools() },
  { key: 'calendar', href: '/activities', available: canViewActivities },
  { key: 'leader_view', href: '/logout', available: () => true },
]);

/**
 * @returns {boolean} Whether this account may try the sandboxed writes
 */
function canTrySandbox() {
  return hasAnyPermission(...SANDBOX_PERMISSIONS);
}

/**
 * @returns {string} Translation key for what this visitor may do
 */
function noticeKey() {
  if (!isDemoSandbox()) {
    return 'demo_banner_read_only';
  }
  return canTrySandbox() ? 'demo_banner_sandbox' : 'demo_banner_parent';
}

/**
 * @returns {Array<{key: string, href: string, id: string}>} This view's missions
 */
function missionsForView() {
  const view = canTrySandbox() ? 'leader' : 'parent';
  const missions = view === 'leader' ? LEADER_MISSIONS : PARENT_MISSIONS;
  return missions
    .filter((mission) => mission.available())
    .map((mission) => ({ ...mission, id: `${view}_${mission.key}` }));
}

/**
 * @returns {{done: string[], open: boolean|null}} What this browser remembers
 */
function readProgress() {
  const stored = getStorageJSON(DEMO_MISSIONS_STORAGE_KEY, false, null);
  return {
    done: Array.isArray(stored?.done) ? stored.done.filter((id) => typeof id === 'string') : [],
    open: typeof stored?.open === 'boolean' ? stored.open : null,
  };
}

/**
 * @param {{done: string[], open: boolean|null}} progress - What to remember
 * @returns {void}
 */
function writeProgress(progress) {
  setStorage(DEMO_MISSIONS_STORAGE_KEY, progress);
}

/**
 * @param {number} done - Missions ticked
 * @param {number} total - Missions offered
 * @returns {string} The count shown in the summary and announced on change
 */
function progressText(done, total) {
  if (total > 0 && done >= total) {
    return translate('demo_missions_complete');
  }
  return translate('demo_missions_progress')
    .replace('{done}', String(done))
    .replace('{total}', String(total));
}

/**
 * @param {Array<Object>} missions - This view's missions
 * @param {{done: string[], open: boolean|null}} progress - Remembered state
 * @returns {string} Markup of the collapsible mission list
 */
function missionsMarkup(missions, progress) {
  const doneSet = new Set(progress.done);
  const doneCount = missions.filter((mission) => doneSet.has(mission.id)).length;
  // Open on a first visit to a wide screen, so the tour is found; on a phone
  // the open list would push the page below the fold. Then as the visitor left it.
  const open = progress.open ?? Boolean(window.matchMedia?.(WIDE_SCREEN_QUERY).matches);
  const items = missions.map((mission) => {
    const checkboxId = `demo-mission-${mission.id}`;
    return `
      <li class="demo-missions__item">
        <div class="demo-missions__check">
          <input type="checkbox" id="${checkboxId}" data-demo-mission="${mission.id}"
                 aria-describedby="${checkboxId}-text" ${doneSet.has(mission.id) ? 'checked' : ''}>
          <label for="${checkboxId}">${translate(`demo_mission_${mission.key}_title`)}</label>
        </div>
        <p class="demo-missions__text" id="${checkboxId}-text">${translate(`demo_mission_${mission.key}_text`)}</p>
        <a class="demo-missions__go" href="${mission.href}">
          ${translate('demo_missions_go')}<span class="visually-hidden"> — ${translate(`demo_mission_${mission.key}_title`)}</span>
        </a>
      </li>`;
  }).join('');
  return `
    <details class="demo-missions" id="demo-missions" ${open ? 'open' : ''}>
      <summary class="demo-missions__summary">
        ${translate('demo_missions_title')}
        <span class="demo-missions__count" id="demo-missions-count">${doneCount}/${missions.length}</span>
      </summary>
      <p class="demo-missions__intro">${translate('demo_missions_intro')}</p>
      <ol class="demo-missions__list">${items}</ol>
      <p class="demo-missions__progress" id="demo-missions-progress" role="status">${progressText(doneCount, missions.length)}</p>
    </details>`;
}

/**
 * Remember a ticked mission or the list being opened, and update the counts
 * in place so focus stays where the visitor is.
 *
 * @param {HTMLElement} element - Banner container
 * @returns {void}
 */
function attachListeners(element) {
  if (element.dataset.demoListeners === 'true') {
    return;
  }
  element.dataset.demoListeners = 'true';

  element.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-demo-mission]');
    if (!checkbox) {
      return;
    }
    const progress = readProgress();
    const done = new Set(progress.done);
    if (checkbox.checked) {
      done.add(checkbox.dataset.demoMission);
    } else {
      done.delete(checkbox.dataset.demoMission);
    }
    writeProgress({ ...progress, done: [...done] });

    const boxes = Array.from(element.querySelectorAll('[data-demo-mission]'));
    const doneCount = boxes.filter((box) => box.checked).length;
    const count = element.querySelector('#demo-missions-count');
    const status = element.querySelector('#demo-missions-progress');
    if (count) {
      count.textContent = `${doneCount}/${boxes.length}`;
    }
    if (status) {
      status.textContent = progressText(doneCount, boxes.length);
    }
  });

  // `toggle` does not bubble; capture it on the way down.
  element.addEventListener('toggle', (event) => {
    if (event.target.id === 'demo-missions') {
      writeProgress({ ...readProgress(), open: event.target.open });
    }
  }, true);
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
  const missions = isDemoSandbox() ? missionsForView() : [];
  const element = hostElement();
  setContent(element, `
    <div class="demo-banner__inner">
      <p class="demo-banner__text">
        <strong class="demo-banner__title">${translate('demo_banner_title')}</strong>
        ${translate(noticeKey())}
      </p>
      ${missions.length ? missionsMarkup(missions, readProgress()) : ''}
    </div>`);
  attachListeners(element);
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
