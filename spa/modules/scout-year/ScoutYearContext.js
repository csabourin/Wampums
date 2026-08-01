/**
 * Scout Year Context
 *
 * Which season the interface is currently showing.
 *
 * Nothing is ever deleted when a year closes, so a leader can point the whole
 * app at an earlier one and find a participant or a parent who has since left.
 * That choice lives here, in one place, because it has to reach three things at
 * once: the header sent with every request, the cache key responses are stored
 * under, and the read-only guard that stops an archive from being edited.
 *
 * Deliberately free of imports from the API layer — `api-helpers.js` reads this
 * module to build its headers, and a cycle there would be a bootstrap problem.
 *
 * The selection is remembered per organization: carrying a year id across a unit
 * switch would ask the server for a year that belongs to somebody else.
 */

const STORAGE_KEY = 'selectedScoutYear';

/** Listeners notified when the selected year changes. */
const listeners = new Set();

/**
 * Read the stored selection.
 *
 * @returns {Object|null} `{ id, label, status, organizationId }` or null
 */
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && parsed.id ? parsed : null;
  } catch (error) {
    return null;
  }
}

/**
 * The organization the app is currently pointed at.
 *
 * Read straight from storage rather than through `api-helpers` to keep this
 * module free of API-layer imports.
 *
 * @returns {string|null} Organization ID
 */
function currentOrganizationId() {
  try {
    const raw = localStorage.getItem('currentOrganizationId')
      || localStorage.getItem('organizationId');
    return raw ? String(raw) : null;
  } catch (error) {
    return null;
  }
}

/**
 * The scout year currently being consulted, if it is an archived one.
 *
 * Returns null while the app is on the active year, which is the ordinary case:
 * no year header is sent and every endpoint answers for the current season,
 * exactly as it did before year selection existed.
 *
 * @returns {Object|null} `{ id, label, status }` of the archived year, or null
 */
export function getSelectedScoutYear() {
  const stored = readStored();
  if (!stored) {
    return null;
  }

  // A selection made in another unit means nothing here.
  const organizationId = currentOrganizationId();
  if (organizationId && stored.organizationId && String(stored.organizationId) !== organizationId) {
    return null;
  }

  return { id: stored.id, label: stored.label, status: stored.status };
}

/**
 * ID of the archived year being consulted.
 *
 * @returns {number|null} Scout year ID, or null on the active year
 */
export function getSelectedScoutYearId() {
  return getSelectedScoutYear()?.id ?? null;
}

/**
 * Whether the app is showing an archived season.
 *
 * @returns {boolean} True when a closed year is selected
 */
export function isArchiveMode() {
  return getSelectedScoutYear() !== null;
}

/**
 * Point the app at a scout year.
 *
 * Selecting the active year clears the selection rather than storing it: the
 * absence of a choice *is* "the current season", and keeping it that way means
 * the default path sends no extra header and reuses the existing cache entries.
 *
 * @param {Object|null} year - `{ id, label, status }`, or null to go back to now
 * @returns {void}
 */
export function setSelectedScoutYear(year) {
  const previous = getSelectedScoutYearId();

  if (!year || !year.id || year.status === 'active') {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      id: year.id,
      label: year.label,
      status: year.status,
      organizationId: currentOrganizationId()
    }));
  }

  if (getSelectedScoutYearId() !== previous) {
    notify();
  }
}

/**
 * Go back to the current season.
 *
 * @returns {void}
 */
export function clearSelectedScoutYear() {
  setSelectedScoutYear(null);
}

/**
 * Subscribe to year changes.
 *
 * @param {Function} listener - Called with the selected year (or null)
 * @returns {Function} Unsubscribe
 */
export function onScoutYearChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Tell every listener the selection moved.
 *
 * @returns {void}
 */
function notify() {
  const selected = getSelectedScoutYear();
  listeners.forEach((listener) => {
    try {
      listener(selected);
    } catch (error) {
      // A misbehaving listener must not stop the others from updating.
    }
  });
}
