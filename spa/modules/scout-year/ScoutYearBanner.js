/**
 * Scout Year Banner
 *
 * The one control that lets a leader step back into an earlier season, and the
 * banner that makes it impossible to forget they have.
 *
 * It lives outside `#app` so it survives every route change: the pages render
 * into `#app` and would otherwise wipe it on each navigation. It only appears
 * for someone who can consult the year history, and only once the unit actually
 * has more than one year to look at — a unit in its first season has no reason
 * to see a year picker.
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { getScoutYears } from '../../api/api-scout-years.js';
import {
  getSelectedScoutYear,
  setSelectedScoutYear,
  clearSelectedScoutYear,
  onScoutYearChange
} from './ScoutYearContext.js';

const ELEMENT_ID = 'scout-year-banner';
/** A unit with a single year has nothing to switch between. */
const MIN_YEARS_TO_OFFER_SWITCH = 2;

let years = [];
let mounted = false;

/**
 * Find or create the host element, just after the app root.
 *
 * @returns {HTMLElement} Banner container
 */
function hostElement() {
  let element = document.getElementById(ELEMENT_ID);
  if (!element) {
    element = document.createElement('div');
    element.id = ELEMENT_ID;
    element.className = 'scout-year-banner';
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
 * Build the archive warning and its way out.
 *
 * @param {Object} selected - Year currently being consulted
 * @returns {string} Notice markup
 */
function archiveNoticeMarkup(selected) {
  return `<p class="scout-year-banner__notice" role="status">
         ${translate('scout_year_archive_notice').replace('{year}', escapeHTML(selected.label))}
         <button type="button" class="scout-year-banner__exit" id="scout-year-exit">
           ${translate('scout_year_back_to_current')}
         </button>
       </p>`;
}

/**
 * Draw the selector, plus the archive warning when one is in effect.
 *
 * @returns {void}
 */
function render() {
  const element = hostElement();
  const selected = getSelectedScoutYear();

  if (years.length < MIN_YEARS_TO_OFFER_SWITCH) {
    // With an archived year in effect, the list being short means the year
    // request failed — not that there is nothing to switch between. Read-only
    // mode and the write guard are still on, so clearing the banner here would
    // strand the user in an archive with no way back. The exit stays, without
    // the selector there is no list to fill.
    if (selected) {
      element.classList.add('is-archive');
      setContent(element, archiveNoticeMarkup(selected));
      return;
    }

    setContent(element, '');
    element.classList.remove('is-archive');
    return;
  }

  const activeYear = years.find(year => year.status === 'active');
  const selectedId = selected?.id ?? activeYear?.id ?? '';

  const options = years
    .map((year) => {
      const label = year.status === 'active'
        ? `${year.label} — ${translate('scout_year_status_active')}`
        : year.label;
      return `<option value="${year.id}" ${String(year.id) === String(selectedId) ? 'selected' : ''}>
          ${escapeHTML(label)}
        </option>`;
    })
    .join('');

  const archiveNotice = selected ? archiveNoticeMarkup(selected) : '';

  element.classList.toggle('is-archive', Boolean(selected));

  setContent(element, `
    <div class="scout-year-banner__bar">
      <label class="scout-year-banner__label" for="scout-year-select">
        ${translate('scout_year_selector_label')}
      </label>
      <select id="scout-year-select" class="scout-year-banner__select">${options}</select>
    </div>
    ${archiveNotice}`);
}

/**
 * Apply a year chosen in the selector.
 *
 * Everything on screen was fetched for the previous year, so the page is
 * reloaded rather than patched: half a screen showing 2024-2025 next to half a
 * screen showing today is worse than a blink.
 *
 * @param {string} value - Selected year id
 * @returns {void}
 */
function handleSelection(value) {
  const year = years.find(candidate => String(candidate.id) === String(value));
  if (!year) {
    return;
  }

  setSelectedScoutYear(year.status === 'active' ? null : year);
  window.location.reload();
}

/**
 * Mount the banner. Safe to call more than once.
 *
 * @returns {Promise<void>}
 */
export async function initScoutYearBanner() {
  if (!hasPermission('scout_year.view')) {
    return;
  }

  try {
    years = await getScoutYears({ forceRefresh: true });
  } catch (error) {
    debugError('Failed to load scout years for the selector:', error);
    // A selection already in effect must still be visible and escapable, even
    // if the list could not be refreshed.
    const selected = getSelectedScoutYear();
    years = selected ? [{ ...selected }] : [];
  }

  render();

  if (mounted) {
    return;
  }
  mounted = true;

  const element = hostElement();
  element.addEventListener('change', (event) => {
    if (event.target.id === 'scout-year-select') {
      handleSelection(event.target.value);
    }
  });
  element.addEventListener('click', (event) => {
    if (event.target.closest('#scout-year-exit')) {
      clearSelectedScoutYear();
      window.location.reload();
    }
  });

  onScoutYearChange(render);
}
