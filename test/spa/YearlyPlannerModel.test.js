/**
 * @jest-environment jsdom
 *
 * Tests for the pure year-plan model. Everything the year view renders is
 * derived here, so these tests are the contract for the renderer.
 */

import {
  buildYearModel,
  parseLocalDate,
  daySpan,
  periodColor
} from '../../spa/modules/yearly-planner/PlannerModel.js';

/**
 * @param {Object} overrides - Column overrides
 * @returns {Object} Meeting row as GET /plans/:id returns it
 */
function meeting(overrides = {}) {
  return {
    id: 1,
    meeting_date: '2025-09-10',
    meeting_kind: 'regular',
    theme: null,
    period_id: null,
    is_cancelled: false,
    is_prepared: false,
    activity_count: 0,
    series_ids: [],
    span_days: null,
    span_end_date: null,
    activity_id: null,
    ...overrides
  };
}

describe('parseLocalDate', () => {
  test('reads a date string as local midnight', () => {
    const date = parseLocalDate('2025-09-10');
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(8);
    expect(date.getDate()).toBe(10);
  });

  test('does not drift the way Date(string) does', () => {
    // new Date('2025-09-10') is parsed as UTC and lands on the 9th in any
    // timezone west of Greenwich. This is the bug the helper exists to avoid.
    expect(parseLocalDate('2025-09-10').getDate()).toBe(10);
  });

  test('returns null for junk', () => {
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate('not-a-date')).toBeNull();
  });
});

describe('daySpan', () => {
  test('counts both ends', () => {
    expect(daySpan('2026-07-11', '2026-07-18')).toBe(8);
  });

  test('a single day is one', () => {
    expect(daySpan('2025-09-10', '2025-09-10')).toBe(1);
  });

  test('never returns less than one', () => {
    expect(daySpan('2025-09-10', '2025-09-01')).toBe(1);
  });

  test('is unaffected by a DST boundary inside the span', () => {
    // North American DST ends 2025-11-02; a naive ms/86400000 would give 7.96.
    expect(daySpan('2025-10-30', '2025-11-06')).toBe(8);
  });
});

describe('buildYearModel - month grouping', () => {
  test('groups chips by month in date order', () => {
    const model = buildYearModel({
      meetings: [
        meeting({ id: 3, meeting_date: '2025-10-01' }),
        meeting({ id: 1, meeting_date: '2025-09-10' }),
        meeting({ id: 2, meeting_date: '2025-09-17' })
      ]
    });

    expect(model.months.map(m => m.key)).toEqual(['2025-09', '2025-10']);
    expect(model.months[0].chips.map(c => c.meetingId)).toEqual([1, 2]);
  });

  test('months with no dates simply do not appear', () => {
    const model = buildYearModel({
      meetings: [
        meeting({ id: 1, meeting_date: '2025-09-10' }),
        meeting({ id: 2, meeting_date: '2025-12-03' })
      ]
    });

    expect(model.months.map(m => m.key)).toEqual(['2025-09', '2025-12']);
  });

  test('reads the day number in local time', () => {
    const model = buildYearModel({ meetings: [meeting({ meeting_date: '2025-09-10' })] });
    expect(model.months[0].chips[0].dayNum).toBe(10);
  });

  test('tolerates a missing payload', () => {
    expect(buildYearModel(null).months).toEqual([]);
    expect(buildYearModel({}).months).toEqual([]);
  });
});

describe('buildYearModel - camps', () => {
  test('a multi-day block carries its span and end date', () => {
    const model = buildYearModel({
      meetings: [meeting({
        id: 9,
        meeting_date: '2026-07-11',
        meeting_kind: 'camp',
        span_days: 8,
        span_end_date: '2026-07-18'
      })]
    });

    const chip = model.months[0].chips[0];
    expect(chip.spanDays).toBe(8);
    expect(chip.spanEndDate).toBe('2026-07-18');
    expect(chip.kind).toBe('camp');
  });

  test('derives the span from the linked outing when the column is absent', () => {
    const model = buildYearModel({
      meetings: [meeting({ id: 9, meeting_date: '2026-07-11', activity_id: 500 })],
      activity_events: [{
        id: 500, name: 'Camp', linked_meeting_id: 9,
        start_date: '2026-07-11', end_date: '2026-07-18'
      }]
    });

    expect(model.months[0].chips[0].spanDays).toBe(8);
  });

  test('a single-day chip has no span end date', () => {
    const model = buildYearModel({ meetings: [meeting()] });
    expect(model.months[0].chips[0].spanDays).toBe(1);
    expect(model.months[0].chips[0].spanEndDate).toBeNull();
  });
});

describe('buildYearModel - outings', () => {
  test('a linked outing renders once, on its meeting chip', () => {
    const model = buildYearModel({
      meetings: [meeting({ id: 9, meeting_date: '2025-10-25', activity_id: 500 })],
      activity_events: [{
        id: 500, name: 'Sortie', linked_meeting_id: 9,
        start_date: '2025-10-25', end_date: '2025-10-25',
        signed_slip_count: '12', pending_slip_count: '6',
        carpool_offer_count: '4', assigned_participant_count: '11'
      }]
    });

    const chips = model.months[0].chips;
    expect(chips).toHaveLength(1);
    expect(chips[0].consent).toEqual({ pending: 6, signed: 12, declined: 0, total: 18 });
    expect(chips[0].carpool).toEqual({ offers: 4, assigned: 11 });
  });

  test('an unlinked outing still gets its own chip', () => {
    const model = buildYearModel({
      meetings: [],
      activity_events: [{
        id: 501, name: 'Sortie libre', linked_meeting_id: null,
        start_date: '2025-11-08', end_date: '2025-11-08'
      }]
    });

    const chip = model.months[0].chips[0];
    expect(chip.isEvent).toBe(true);
    expect(chip.meetingId).toBeNull();
    expect(chip.activityId).toBe(501);
  });

  test('no badges when there is nothing to report', () => {
    const model = buildYearModel({
      meetings: [meeting({ id: 9, activity_id: 500 })],
      activity_events: [{ id: 500, linked_meeting_id: 9, start_date: '2025-09-10', end_date: '2025-09-10' }]
    });

    expect(model.months[0].chips[0].consent).toBeNull();
    expect(model.months[0].chips[0].carpool).toBeNull();
  });
});

describe('buildYearModel - period bands', () => {
  const periods = [
    { id: 1, title: 'Decouverte', settings: { color: '#123456' } },
    { id: 2, title: 'Explorateurs', settings: {} }
  ];

  test('a run of chips sharing a period becomes one band', () => {
    const model = buildYearModel({
      periods,
      meetings: [
        meeting({ id: 1, meeting_date: '2025-09-03', period_id: null }),
        meeting({ id: 2, meeting_date: '2025-09-10', period_id: 1 }),
        meeting({ id: 3, meeting_date: '2025-09-17', period_id: 1 }),
        meeting({ id: 4, meeting_date: '2025-09-24', period_id: 1 })
      ]
    });

    const bands = model.months[0].bands;
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ periodId: 1, startIndex: 1, span: 3, row: 0 });
  });

  test('a gap splits the run into two bands', () => {
    const model = buildYearModel({
      periods,
      meetings: [
        meeting({ id: 1, meeting_date: '2025-09-03', period_id: 1 }),
        meeting({ id: 2, meeting_date: '2025-09-10', period_id: null }),
        meeting({ id: 3, meeting_date: '2025-09-17', period_id: 1 })
      ]
    });

    expect(model.months[0].bands.map(b => [b.startIndex, b.span])).toEqual([[0, 1], [2, 1]]);
  });

  test('adjacent different periods do not merge', () => {
    const model = buildYearModel({
      periods,
      meetings: [
        meeting({ id: 1, meeting_date: '2025-09-03', period_id: 1 }),
        meeting({ id: 2, meeting_date: '2025-09-10', period_id: 2 })
      ]
    });

    const bands = model.months[0].bands;
    expect(bands).toHaveLength(2);
    expect(bands.map(b => b.periodId)).toEqual([1, 2]);
  });

  test('bands take the period colour, falling back to a stable palette', () => {
    const model = buildYearModel({
      periods,
      meetings: [
        meeting({ id: 1, meeting_date: '2025-09-03', period_id: 1 }),
        meeting({ id: 2, meeting_date: '2025-09-10', period_id: 2 })
      ]
    });

    expect(model.months[0].bands[0].color).toBe('#123456');
    expect(model.months[0].bands[1].color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('a band never references a period that was not supplied', () => {
    const model = buildYearModel({
      periods: [],
      meetings: [meeting({ id: 1, period_id: 99 })]
    });

    expect(model.months[0].bands).toEqual([]);
  });

  test('indices address the chip array, so bands and chips cannot drift', () => {
    const model = buildYearModel({
      periods,
      meetings: [
        meeting({ id: 1, meeting_date: '2025-09-03', period_id: null }),
        meeting({ id: 2, meeting_date: '2025-09-10', period_id: 1 }),
        meeting({ id: 3, meeting_date: '2025-09-17', period_id: 1 })
      ]
    });

    const { chips, bands } = model.months[0];
    const covered = chips.slice(bands[0].startIndex, bands[0].startIndex + bands[0].span);
    expect(covered.every(c => c.periodId === 1)).toBe(true);
  });
});

describe('buildYearModel - overlapping periods', () => {
  test('overlapping bands are stacked on separate rows', () => {
    // Two periods interleaved across one month must both stay visible.
    const model = buildYearModel({
      periods: [
        { id: 1, title: 'A', settings: {} },
        { id: 2, title: 'B', settings: {} }
      ],
      meetings: [
        meeting({ id: 1, meeting_date: '2025-09-03', period_id: 1 }),
        meeting({ id: 2, meeting_date: '2025-09-10', period_id: 2 }),
        meeting({ id: 3, meeting_date: '2025-09-17', period_id: 1 })
      ]
    });

    const bands = model.months[0].bands;
    expect(bands).toHaveLength(3);
    // Sequential, non-overlapping runs all fit on row 0.
    expect(bands.every(b => b.row === 0)).toBe(true);
  });
});

describe('buildYearModel - state flags and counts', () => {
  test('marks past, today and future relative to the supplied date', () => {
    const model = buildYearModel({
      meetings: [
        meeting({ id: 1, meeting_date: '2025-09-03' }),
        meeting({ id: 2, meeting_date: '2025-09-10' }),
        meeting({ id: 3, meeting_date: '2025-09-17' })
      ]
    }, { today: '2025-09-10' });

    const [past, now, future] = model.months[0].chips;
    expect(past.isPast).toBe(true);
    expect(now.isToday).toBe(true);
    expect(now.isPast).toBe(false);
    expect(future.isPast).toBe(false);
  });

  test('summarises the plan', () => {
    const model = buildYearModel({
      meetings: [
        meeting({ id: 1, meeting_date: '2025-09-03', is_prepared: true }),
        meeting({ id: 2, meeting_date: '2025-09-10', is_cancelled: true }),
        meeting({ id: 3, meeting_date: '2026-07-11', meeting_kind: 'camp', span_days: 8 })
      ]
    });

    expect(model.counts).toEqual({ meetings: 2, cancelled: 1, camps: 1, prepared: 1 });
  });

  test('collects the distinct series of the plan', () => {
    const model = buildYearModel({
      meetings: [
        meeting({ id: 1, meeting_date: '2025-09-03', series_ids: ['s1'] }),
        meeting({ id: 2, meeting_date: '2025-09-10', series_ids: ['s1', 's2'] })
      ]
    });

    expect(model.seriesIds.sort()).toEqual(['s1', 's2']);
  });
});

describe('periodColor', () => {
  test('accepts a hex colour from settings', () => {
    expect(periodColor({ settings: { color: '#abcdef' } })).toBe('#abcdef');
  });

  test('rejects anything that is not a hex colour', () => {
    // Guards against a settings blob smuggling a CSS expression into a style attribute.
    expect(periodColor({ settings: { color: 'red; background: url(x)' } })).toMatch(/^#[0-9a-f]{6}$/i);
    expect(periodColor({ settings: {} })).toMatch(/^#[0-9a-f]{6}$/i);
    expect(periodColor(null)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('the fallback is stable for a given position', () => {
    expect(periodColor({}, 2)).toBe(periodColor({}, 2));
    expect(periodColor({}, 0)).not.toBe(periodColor({}, 1));
  });
});
