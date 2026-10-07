/**
 * The oldest a participant can plausibly be at registration, matching the
 * server. The Rover section ends at 25.
 */
const MAX_PARTICIPANT_AGE_YEARS = 26;
const DATE_PART_WIDTH = 2;

/**
 * Today and the earliest plausible birth date, as ISO dates in local time.
 *
 * @param {Date} [now] - Clock reading, for tests
 * @returns {{today: string, earliest: string}} Date bounds
 */
export function birthDateBounds(now = new Date()) {
  const iso = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(DATE_PART_WIDTH, '0'),
    String(date.getDate()).padStart(DATE_PART_WIDTH, '0'),
  ].join('-');
  const earliest = new Date(now);
  earliest.setFullYear(earliest.getFullYear() - MAX_PARTICIPANT_AGE_YEARS);
  return { today: iso(now), earliest: iso(earliest) };
}

/**
 * Check a child's details the way the server will, so the parent hears about a
 * problem before submitting.
 *
 * @param {Object} child - `first_name`, `last_name`, `date_naissance`
 * @param {Date} [now] - Clock reading, for tests
 * @returns {string|null} Translation key of the first problem, or null
 */
export function childProblem(child, now = new Date()) {
  if (!child.first_name || !child.last_name) {
    return 'onboarding_error_name_required';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(child.date_naissance || '')) {
    return 'onboarding_error_dob_required';
  }
  const { today, earliest } = birthDateBounds(now);
  if (child.date_naissance > today) {
    return 'onboarding_error_dob_future';
  }
  if (child.date_naissance < earliest) {
    return 'onboarding_error_dob_too_old';
  }
  return null;
}
