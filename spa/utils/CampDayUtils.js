/**
 * Whether today is a day of one of the unit's camps, and which one.
 *
 * Decided by dates only, never by an activity's name: a camp planned in the
 * year plan (`meeting_kind = 'camp'`), whose day programme the server answers
 * for any of its days, or an activity marked as a camp (`is_camp`) whose dates
 * cover today. Both sources are cached on the device by camp preparation, so
 * the answer holds without a connection.
 *
 * @module spa/utils/CampDayUtils
 */

const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;
const MS_PER_DAY = 86400000;

/**
 * @typedef {Object} CampDay
 * @property {'camp'|'outing'} kind - A camp day, or an outing that replaces today's meeting
 * @property {string} title - The day's title, else the camp's theme or name ('' when none)
 * @property {string} campName - The camp activity's own name, '' when unknown (a day title is not one)
 * @property {number} dayNumber - 1 on the first day
 * @property {number} dayCount - Days the camp lasts
 * @property {?number} meetingId - The planned camp, when the year plan schedules it
 * @property {?number} activityId - The camp's activity, when known
 */

/**
 * @param {*} value - A date or date-time
 * @returns {string} Its YYYY-MM-DD part, '' when there is none
 */
function dateOnly(value) {
  const text = String(value || '').slice(0, ISO_DATE_LENGTH);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

/**
 * @param {string} from - YYYY-MM-DD
 * @param {string} to - YYYY-MM-DD
 * @returns {number} Whole days from one to the other
 */
function daysBetween(from, to) {
  return Math.round((Date.UTC(...splitDate(to)) - Date.UTC(...splitDate(from))) / MS_PER_DAY);
}

/**
 * @param {string} date - YYYY-MM-DD
 * @returns {[number, number, number]} Year, month index, day
 */
function splitDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return [year, month - 1, day];
}

/**
 * @param {?Object} programme - `data` of GET /v1/meetings/programme for `today`
 * @param {string} today - The phone's day, YYYY-MM-DD
 * @returns {?CampDay} The camp day the programme describes, or null for a meeting or nothing
 */
export function campDayFromProgramme(programme, today) {
  if (programme?.kind !== 'camp' || dateOnly(programme.date) !== today) {
    return null;
  }
  const dayNumber = Number(programme.day_number) || 1;
  return {
    kind: 'camp',
    title: String(programme.title || ''),
    campName: '',
    dayNumber,
    dayCount: Math.max(Number(programme.day_count) || 1, dayNumber),
    meetingId: Number(programme.meeting_id) > 0 ? Number(programme.meeting_id) : null,
    activityId: null,
  };
}

/**
 * @param {Array<Object>} activities - The unit's activities (GET /v1/activities)
 * @param {string} today - The phone's day, YYYY-MM-DD
 * @returns {?CampDay} The camp activity covering today, the earliest started first
 */
export function campDayFromActivities(activities, today) {
  const covering = (Array.isArray(activities) ? activities : [])
    .filter((activity) => activity?.is_camp === true)
    .map((activity) => {
      const start = dateOnly(activity.activity_start_date || activity.activity_date);
      const end = dateOnly(activity.activity_end_date) || start;
      return { activity, start, end };
    })
    .filter(({ start, end }) => start && start <= today && today <= end)
    .sort((a, b) => a.start.localeCompare(b.start));
  const found = covering[0];
  if (!found) {
    return null;
  }
  const meetingId = Number(found.activity.linked_year_plan_meeting_id);
  return {
    kind: 'camp',
    title: String(found.activity.name || ''),
    campName: String(found.activity.name || ''),
    dayNumber: daysBetween(found.start, today) + 1,
    dayCount: daysBetween(found.start, found.end) + 1,
    meetingId: meetingId > 0 ? meetingId : null,
    activityId: Number(found.activity.id) > 0 ? Number(found.activity.id) : null,
  };
}

/**
 * The day programme speaks for the planned camp (its day titles, its
 * schedule); the activity adds its id, or answers alone when the camp is not
 * in the year plan.
 *
 * @param {?CampDay} fromProgramme
 * @param {?CampDay} fromActivities
 * @returns {?CampDay}
 */
export function mergeCampDays(fromProgramme, fromActivities) {
  if (!fromProgramme) {
    return fromActivities || null;
  }
  const sameCamp = fromActivities
    && (!fromActivities.meetingId || fromActivities.meetingId === fromProgramme.meetingId);
  return sameCamp
    ? { ...fromProgramme, activityId: fromActivities.activityId, campName: fromActivities.campName }
    : fromProgramme;
}

/** @param {*} value - "HH:MM" or "HH:MM:SS" @returns {string} "HH:MM", '' when none */
function clockTime(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '';
}

/**
 * Today's outing, when it replaces today's meeting (the server says so with
 * `replaces_meeting_date`): the day follows the outing, as a camp day follows the camp.
 *
 * @param {Array<Object>} activities - The unit's activities (GET /v1/activities)
 * @param {string} today - The phone's day, YYYY-MM-DD
 * @returns {?CampDay} With `outing`: where and when it leaves and comes back
 */
export function outingDayFromActivities(activities, today) {
  const found = (Array.isArray(activities) ? activities : [])
    .find((activity) => dateOnly(activity?.replaces_meeting_date) === today && activity.is_camp !== true);
  if (!found) {
    return null;
  }
  const name = String(found.name || '');
  return {
    kind: 'outing',
    title: name,
    campName: name,
    dayNumber: 1,
    dayCount: 1,
    meetingId: null,
    activityId: Number(found.id) > 0 ? Number(found.id) : null,
    outing: {
      departureTime: clockTime(found.meeting_time_going || found.departure_time_going),
      departurePlace: String(found.meeting_location_going || ''),
      returnTime: clockTime(found.meeting_time_return || found.departure_time_return),
      returnPlace: String(found.meeting_location_return || ''),
    },
  };
}
