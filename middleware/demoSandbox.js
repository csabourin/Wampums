/**
 * What a visitor may change in the demo unit.
 *
 * The demo unit (the one whose `demo_sign_in` setting is on) is open to anyone
 * without a password, so it stays read-only for anything a visitor could use
 * to publish words: names, messages, notes, reasons. A few actions carry no
 * text at all — awarding points, taking attendance, awarding an honor without
 * a reason — and those are what make the demo worth trying. They are let
 * through when every field of the request is an id, a date close to today, a
 * small number or a short lowercase code the route itself validates. The night
 * reset (`scripts/demo/reset-demo-sandbox.js`) puts everything back.
 *
 * A demo account in an ordinary unit stays read-only: only a unit with
 * `demo_sign_in` is a sandbox.
 *
 * @module middleware/demoSandbox
 */

/** Points one demo click may add or remove; enough for any button the screen offers. */
const DEMO_POINTS_LIMIT = 100;
/** Entries one demo request may carry: a whole unit at once, not a flood. */
const DEMO_BATCH_LIMIT = 200;
/** How far from today a demo write may be dated. */
const DEMO_DATE_WINDOW_DAYS = 366;
const MS_PER_DAY = 86400000;
/** Largest PostgreSQL integer, the type of every id these routes write. */
const POSTGRES_INTEGER_MAX = 2147483647;

const ID_PATTERN = /^\d{1,10}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** An ISO 8601 instant, as `new Date().toISOString()` writes it. */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** A status or a type the route checks against its own list; never prose. */
const CODE_PATTERN = /^[a-z_]{1,32}$/;

/**
 * @param {*} value - Candidate id, as a number or a string of digits
 * @returns {boolean} Whether it is a positive PostgreSQL integer
 */
function isId(value) {
  const number = typeof value === 'string' && ID_PATTERN.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 1 && number <= POSTGRES_INTEGER_MAX;
}

/**
 * @param {*} value - Candidate code
 * @returns {boolean} Whether it is a short lowercase code
 */
function isCode(value) {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}

/**
 * @param {*} value - Candidate date
 * @param {number} now - Current time in milliseconds
 * @returns {boolean} Whether it is a calendar date within the demo window
 */
function isNearDate(value, now) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && Math.abs(time - now) <= DEMO_DATE_WINDOW_DAYS * MS_PER_DAY;
}

/** How each kind of field is checked. */
const FIELD_CHECKS = Object.freeze({
  id: isId,
  ids: (value) => (Array.isArray(value)
    ? value.length >= 1 && value.length <= DEMO_BATCH_LIMIT && value.every(isId)
    : isId(value)),
  code: isCode,
  optionalCode: (value) => value === undefined || value === null || isCode(value),
  date: isNearDate,
  timestamp: (value) => typeof value === 'string' && TIMESTAMP_PATTERN.test(value),
  points: (value) => Number.isInteger(value) && Math.abs(value) <= DEMO_POINTS_LIMIT,
  // A text field a visitor may leave out but never fill.
  blank: (value) => value === undefined || value === null || value === '',
});

/**
 * The requests a visitor may send in the demo unit, by route. Each names the
 * only fields the request may hold and what each must be; any other field,
 * or any value outside its kind, keeps the request read-only.
 */
const DEMO_SANDBOX = Object.freeze({
  /** POST /api/v1/points: `[{ type, id, points, timestamp, date? }]`, as the points screen sends it */
  points: Object.freeze({
    list: 'required',
    shape: { type: 'code', id: 'id', points: 'points', timestamp: 'timestamp', date: 'date' },
  }),
  /** POST /api/v1/attendance: one child, one date */
  attendanceMark: Object.freeze({
    shape: { participant_id: 'id', date: 'date', status: 'code', previous_status: 'optionalCode' },
  }),
  /** POST /api/v1/attendance/update-attendance: several children, one date */
  attendanceBatch: Object.freeze({
    shape: { participant_id: 'ids', date: 'date', status: 'code', previous_status: 'optionalCode' },
  }),
  /** POST /api/v1/attendance/carry-forward */
  attendanceCarryForward: Object.freeze({ shape: { fromDate: 'date', toDate: 'date' } }),
  /** POST /api/v1/honors: an honor, but no reason */
  honorAward: Object.freeze({
    list: 'optional',
    shape: { participantId: 'id', participant_id: 'id', date: 'date', reason: 'blank' },
  }),
});

/**
 * @param {*} entry - One request object
 * @param {Object<string, string>} shape - Allowed fields and their kind
 * @param {number} now - Current time in milliseconds
 * @returns {boolean} Whether every field is allowed and holds no free text
 */
function matchesShape(entry, shape, now) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return false;
  }
  return Object.entries(entry).every(([key, value]) => (
    Object.prototype.hasOwnProperty.call(shape, key) && FIELD_CHECKS[shape[key]](value, now)
  ));
}

/**
 * Whether a request body is one a demo visitor may send.
 *
 * @param {Object} policy - One of `DEMO_SANDBOX`
 * @param {*} body - Parsed request body
 * @param {number} [now=Date.now()] - Current time in milliseconds
 * @returns {boolean} True when the body carries no free text and stays small
 */
function isHarmlessDemoWrite(policy, body, now = Date.now()) {
  if (!policy) {
    return false;
  }
  if (Array.isArray(body)) {
    return Boolean(policy.list)
      && body.length >= 1
      && body.length <= DEMO_BATCH_LIMIT
      && body.every((entry) => matchesShape(entry, policy.shape, now));
  }
  return policy.list !== 'required' && matchesShape(body, policy.shape, now);
}

module.exports = {
  DEMO_SANDBOX,
  DEMO_POINTS_LIMIT,
  DEMO_BATCH_LIMIT,
  DEMO_DATE_WINDOW_DAYS,
  isHarmlessDemoWrite,
};
