/**
 * Where the day's programme stands at a given moment: what is on now, what
 * comes next, and how long until it changes. Pure, so the bar and its tests
 * share one answer.
 *
 * @module spa/utils/ProgrammeTimeline
 */

const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})/;
const DATE_PART_WIDTH = 2;

/**
 * @typedef {Object} ProgrammeActivity
 * @property {number} id
 * @property {?string} time - "HH:MM", or null when it has no set time
 * @property {?number} duration_minutes
 * @property {string} name
 * @property {string} leader
 * @property {string} material
 */

/**
 * @typedef {Object} TimelineEntry
 * @property {ProgrammeActivity} activity
 * @property {number} start - Minutes since midnight
 * @property {number} end - Minutes since midnight
 * @property {'done'|'now'|'upcoming'} status
 */

/**
 * @typedef {Object} ProgrammeMoment
 * @property {'hidden'|'before'|'now'|'gap'} state - hidden: outside the
 *   programme; before: about to start; now: an activity is on; gap: between two
 * @property {?TimelineEntry} current - The activity on now
 * @property {?TimelineEntry} next - The next activity to start
 * @property {?number} minutesLeft - Until the current activity ends
 * @property {?number} minutesUntil - Until the next activity starts (before/gap)
 * @property {boolean} endingSoon - The current activity ends within the warning
 * @property {TimelineEntry[]} entries - Every timed activity, with its status
 */

/**
 * @param {string} time - "HH:MM"
 * @returns {?number} Minutes since midnight
 */
export function minutesOfDay(time) {
  const match = String(time || '').match(TIME_PATTERN);
  if (!match) {
    return null;
  }
  return (Number(match[1]) * MINUTES_PER_HOUR) + Number(match[2]);
}

/**
 * @param {Date} date - A moment
 * @returns {number} Minutes since that day's midnight, seconds included
 */
function exactMinutesOfDay(date) {
  return (date.getHours() * MINUTES_PER_HOUR)
    + date.getMinutes()
    + ((date.getSeconds() + (date.getMilliseconds() / MS_PER_SECOND)) / SECONDS_PER_MINUTE);
}

/**
 * @param {Date} date - A moment
 * @returns {string} Its day in the phone's own calendar, YYYY-MM-DD
 */
export function localDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(DATE_PART_WIDTH, '0');
  const day = String(date.getDate()).padStart(DATE_PART_WIDTH, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Lay the timed activities on the day. An activity without a duration lasts
 * until the next one starts; the last one, `defaultLastMinutes`.
 *
 * @param {ProgrammeActivity[]} activities - The day's activities
 * @param {number} defaultLastMinutes - Length of a last activity with no duration
 * @returns {{activity: ProgrammeActivity, start: number, end: number}[]} In start order
 */
function layOut(activities, defaultLastMinutes) {
  const timed = (activities || [])
    .map((activity) => ({ activity, start: minutesOfDay(activity.time) }))
    .filter((entry) => entry.start !== null)
    .sort((a, b) => a.start - b.start);

  return timed.map((entry, index) => {
    const following = timed[index + 1];
    const duration = Number(entry.activity.duration_minutes);
    let end;
    if (duration > 0) {
      end = entry.start + duration;
    } else if (following) {
      end = following.start;
    } else {
      end = entry.start + defaultLastMinutes;
    }
    return { ...entry, end };
  });
}

/**
 * Where the programme stands at `now`.
 *
 * Shown from `leadMinutes` before the first activity until the last one ends,
 * gaps included: a long break still says what comes next.
 *
 * @param {ProgrammeActivity[]} activities - The day's activities
 * @param {Date} now - The phone's current time
 * @param {Object} options
 * @param {number} options.leadMinutes - How early the bar appears
 * @param {number} options.endingSoonMinutes - When "ending soon" starts
 * @param {number} options.defaultLastMinutes - Length of a last activity with no duration
 * @returns {ProgrammeMoment}
 */
export function programmeMoment(activities, now, { leadMinutes, endingSoonMinutes, defaultLastMinutes }) {
  const laidOut = layOut(activities, defaultLastMinutes);
  const at = exactMinutesOfDay(now);

  // When activities overlap, the one that started last is "now".
  const current = [...laidOut].reverse().find((entry) => entry.start <= at && at < entry.end) || null;
  const next = laidOut.find((entry) => entry.start > at && entry !== current) || null;
  const entries = laidOut.map((entry) => {
    let status = 'upcoming';
    if (entry === current) {
      status = 'now';
    } else if (entry.end <= at || entry.start < (current?.start ?? -1)) {
      status = 'done';
    }
    return { ...entry, status };
  });
  const entryFor = (item) => (item ? entries[laidOut.indexOf(item)] : null);

  const hidden = {
    state: 'hidden', current: null, next: null, minutesLeft: null, minutesUntil: null, endingSoon: false, entries,
  };
  if (laidOut.length === 0) {
    return hidden;
  }
  const first = laidOut[0];
  const lastEnd = Math.max(...laidOut.map((entry) => entry.end));
  if (at < first.start - leadMinutes || at >= lastEnd) {
    return hidden;
  }

  if (current) {
    const minutesLeft = Math.ceil(current.end - at);
    return {
      state: 'now',
      current: entryFor(current),
      next: entryFor(next),
      minutesLeft,
      minutesUntil: null,
      endingSoon: minutesLeft <= endingSoonMinutes,
      entries,
    };
  }

  return {
    state: at < first.start ? 'before' : 'gap',
    current: null,
    next: entryFor(next),
    minutesLeft: null,
    minutesUntil: next ? Math.ceil(next.start - at) : null,
    endingSoon: false,
    entries,
  };
}

/**
 * Milliseconds until the next whole minute, so the bar changes as the clock does.
 *
 * @param {Date} now - The phone's current time
 * @returns {number}
 */
export function msUntilNextMinute(now) {
  const intoMinute = (now.getSeconds() * MS_PER_SECOND) + now.getMilliseconds();
  return (SECONDS_PER_MINUTE * MS_PER_SECOND) - intoMinute;
}
