// PlannerModel.js
// Pure transformation of a year plan payload into the shape the year-at-a-glance
// view renders. No DOM, no translation, no API: everything here is testable in
// isolation, and all date arithmetic happens once, here.

/**
 * Parse a YYYY-MM-DD string into a local Date at midnight.
 *
 * Never use `new Date('2025-09-10')` for this: that parses as UTC and shifts the
 * day backwards in every timezone west of Greenwich, which is exactly the class
 * of off-by-one this module exists to prevent.
 *
 * @param {string} dateString - Date in YYYY-MM-DD form
 * @returns {Date|null} Local midnight, or null when unparseable
 */
export function parseLocalDate(dateString) {
  if (!dateString) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateString));
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/**
 * Whole days between two YYYY-MM-DD strings, inclusive of both ends.
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @returns {number} Day count, minimum 1
 */
export function daySpan(startDate, endDate) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (!start || !end) {
    return 1;
  }
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  // Compare local midnights, so a DST boundary inside the span cannot round down.
  const diff = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
  return diff > 0 ? diff + 1 : 1;
}

/** Month key (YYYY-MM) a date belongs to. */
function monthKey(dateString) {
  return String(dateString).slice(0, 7);
}

/**
 * Colour for a period, taken from its settings blob.
 * @param {Object} period - year_plan_periods row
 * @param {number} index - Position, used to pick a stable fallback
 * @returns {string} CSS colour
 */
export function periodColor(period, index = 0) {
  const fromSettings = period?.settings?.color;
  if (typeof fromSettings === 'string' && /^#[0-9a-f]{3,8}$/i.test(fromSettings)) {
    return fromSettings;
  }
  return PERIOD_FALLBACK_COLORS[index % PERIOD_FALLBACK_COLORS.length];
}

/**
 * Fallback band colours. Deliberately desaturated: a band sits behind chips and
 * must never compete with the text on top of it.
 */
const PERIOD_FALLBACK_COLORS = [
  '#0f7a5a', '#0f6da3', '#8a5a2b', '#6d4c9f', '#a34343', '#3f7a2b'
];

/**
 * Build the renderable model of a year plan.
 *
 * @param {Object} plan - GET /plans/:id payload
 * @param {Object} [options] - { today: 'YYYY-MM-DD' }
 * @returns {{months: Array, periodsById: Object, seriesIds: string[], counts: Object}}
 */
export function buildYearModel(plan, options = {}) {
  const today = options.today || null;
  const meetings = Array.isArray(plan?.meetings) ? plan.meetings : [];
  const events = Array.isArray(plan?.activity_events) ? plan.activity_events : [];
  const periods = Array.isArray(plan?.periods) ? plan.periods : [];

  const periodsById = {};
  periods.forEach((period, index) => {
    periodsById[period.id] = { ...period, color: periodColor(period, index) };
  });

  // Outings are matched to their meeting so a camp renders once, as a span, and
  // not twice (a chip plus a floating event).
  const eventsByMeetingId = {};
  const unlinkedEvents = [];
  for (const event of events) {
    if (event.linked_meeting_id) {
      eventsByMeetingId[event.linked_meeting_id] = event;
    } else {
      unlinkedEvents.push(event);
    }
  }

  const chips = meetings.map((meeting) => buildChip(meeting, eventsByMeetingId[meeting.id], today));

  // An outing with no planned date of its own still deserves a chip: it is a
  // real commitment on the calendar.
  for (const event of unlinkedEvents) {
    chips.push(buildEventOnlyChip(event, today));
  }

  chips.sort((a, b) => a.date.localeCompare(b.date));

  const months = groupIntoMonths(chips, periodsById);

  return {
    months,
    periodsById,
    seriesIds: collectSeriesIds(meetings),
    counts: {
      meetings: chips.filter(c => !c.isEvent && !c.isCancelled).length,
      cancelled: chips.filter(c => c.isCancelled).length,
      camps: chips.filter(c => c.kind === 'camp').length,
      prepared: chips.filter(c => c.isPrepared).length
    }
  };
}

/**
 * @param {Object} meeting - Meeting row from the plan payload
 * @param {Object} [event] - Linked activities row, when any
 * @param {string|null} today - Today as YYYY-MM-DD
 * @returns {Object} Chip descriptor
 */
function buildChip(meeting, event, today) {
  const date = String(meeting.meeting_date).slice(0, 10);
  const spanEnd = meeting.span_end_date || event?.end_date || date;
  const spanDays = Number(meeting.span_days) || daySpan(date, spanEnd);
  const parsed = parseLocalDate(date);

  return {
    meetingId: meeting.id,
    date,
    isEvent: false,
    dayNum: parsed ? parsed.getDate() : null,
    weekday: parsed ? parsed.getDay() : null,
    kind: meeting.meeting_kind || (spanDays > 1 ? 'camp' : 'regular'),
    theme: meeting.theme || null,
    periodId: meeting.period_id || null,
    isCancelled: meeting.is_cancelled === true,
    isPrepared: meeting.is_prepared === true,
    activityCount: Number(meeting.activity_count) || 0,
    seriesIds: Array.isArray(meeting.series_ids) ? meeting.series_ids.filter(Boolean) : [],
    spanDays,
    spanEndDate: spanDays > 1 ? spanEnd : null,
    activityId: meeting.activity_id || null,
    location: meeting.location || null,
    isPast: Boolean(today) && date < today,
    isToday: Boolean(today) && date === today,
    consent: buildConsent(event),
    carpool: buildCarpool(event)
  };
}

/**
 * @param {Object} event - Unlinked activities row
 * @param {string|null} today - Today as YYYY-MM-DD
 * @returns {Object} Chip descriptor for an outing with no planned meeting
 */
function buildEventOnlyChip(event, today) {
  const date = String(event.start_date).slice(0, 10);
  const spanDays = daySpan(date, event.end_date || date);
  const parsed = parseLocalDate(date);

  return {
    meetingId: null,
    activityId: event.id,
    date,
    isEvent: true,
    dayNum: parsed ? parsed.getDate() : null,
    weekday: parsed ? parsed.getDay() : null,
    kind: spanDays > 1 ? 'camp' : 'weekend',
    theme: event.name || null,
    periodId: null,
    isCancelled: false,
    isPrepared: false,
    activityCount: 0,
    seriesIds: [],
    spanDays,
    spanEndDate: spanDays > 1 ? String(event.end_date).slice(0, 10) : null,
    location: event.location || null,
    isPast: Boolean(today) && date < today,
    isToday: Boolean(today) && date === today,
    consent: buildConsent(event),
    carpool: buildCarpool(event)
  };
}

/** @returns {?{pending: number, signed: number, declined: number}} Consent totals */
function buildConsent(event) {
  if (!event) {
    return null;
  }
  const pending = Number(event.pending_slip_count) || 0;
  const signed = Number(event.signed_slip_count) || 0;
  const declined = Number(event.declined_slip_count) || 0;
  if (pending + signed + declined === 0) {
    return null;
  }
  return { pending, signed, declined, total: pending + signed + declined };
}

/** @returns {?{offers: number, assigned: number}} Carpool totals */
function buildCarpool(event) {
  if (!event) {
    return null;
  }
  const offers = Number(event.carpool_offer_count) || 0;
  const assigned = Number(event.assigned_participant_count) || 0;
  if (offers + assigned === 0) {
    return null;
  }
  return { offers, assigned };
}

/** @returns {string[]} Distinct series ids across the plan */
function collectSeriesIds(meetings) {
  const seen = new Set();
  for (const meeting of meetings) {
    for (const id of (meeting.series_ids || [])) {
      if (id) {
        seen.add(id);
      }
    }
  }
  return Array.from(seen);
}

/**
 * Group chips into month rows and lay period bands over them.
 *
 * Bands are expressed as chip indices, never as dates or pixels: the renderer
 * places them on the same CSS grid track as the chips, so the two can never
 * drift apart.
 *
 * @param {Array} chips - Sorted chip descriptors
 * @param {Object} periodsById - Periods keyed by id, carrying colours
 * @returns {Array} Month rows
 */
function groupIntoMonths(chips, periodsById) {
  const byMonth = new Map();

  for (const chip of chips) {
    const key = monthKey(chip.date);
    if (!byMonth.has(key)) {
      byMonth.set(key, []);
    }
    byMonth.get(key).push(chip);
  }

  const months = [];
  for (const [key, monthChips] of byMonth) {
    months.push({
      key,
      // First day of the month, for the renderer to format in the user's locale.
      date: `${key}-01`,
      chips: monthChips,
      bands: buildBands(monthChips, periodsById)
    });
  }

  months.sort((a, b) => a.key.localeCompare(b.key));
  return months;
}

/**
 * Turn each run of consecutive chips sharing a period into one band.
 * Overlapping periods are stacked on separate rows.
 *
 * @param {Array} chips - Chips of a single month, in date order
 * @param {Object} periodsById - Periods keyed by id
 * @returns {Array} Band descriptors
 */
function buildBands(chips, periodsById) {
  const bands = [];
  let current = null;

  chips.forEach((chip, index) => {
    if (!chip.periodId || !periodsById[chip.periodId]) {
      current = null;
      return;
    }
    if (current && current.periodId === chip.periodId) {
      current.span += 1;
      return;
    }
    current = {
      periodId: chip.periodId,
      title: periodsById[chip.periodId].title,
      color: periodsById[chip.periodId].color,
      startIndex: index,
      span: 1,
      row: 0
    };
    bands.push(current);
  });

  assignBandRows(bands);
  return bands;
}

/**
 * Push overlapping bands onto separate rows so neither is hidden.
 * @param {Array} bands - Bands of one month, in start order
 * @returns {void}
 */
function assignBandRows(bands) {
  const rowEnds = [];
  for (const band of bands) {
    let row = 0;
    while (row < rowEnds.length && rowEnds[row] > band.startIndex) {
      row += 1;
    }
    band.row = row;
    rowEnds[row] = band.startIndex + band.span;
  }
}
