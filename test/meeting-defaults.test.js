/**
 * Tests for utils/meeting-defaults.js
 *
 * Covers the weekday normalization that keeps year-plan generation working for
 * organizations whose meeting_day was stored in French: consumers index into an
 * English weekday array, so an unnormalized 'Mercredi' resolved to -1 and the
 * plan was created with zero meetings and no error.
 */
const {
  getMeetingDefaults,
  computeEndTime,
  formatLocalDate,
  DEFAULT_MEETING_DURATION_MINUTES
} = require('../utils/meeting-defaults');

/**
 * Build a pool stub returning the given organization_settings rows.
 * @param {Array<Object>} rows - Rows to return from the settings query
 * @returns {Object} Pool-like object with a query method
 */
function poolWith(rows) {
  return { query: jest.fn(async () => ({ rows })) };
}

/**
 * Build a pool stub for a single organization_info payload.
 * @param {Object} orgInfo - organization_info setting value
 * @returns {Object} Pool-like object
 */
function poolWithOrgInfo(orgInfo) {
  return poolWith([{ setting_key: 'organization_info', setting_value: orgInfo }]);
}

describe('getMeetingDefaults - meeting day normalization', () => {
  const FRENCH_TO_ENGLISH = [
    ['dimanche', 'Sunday'],
    ['lundi', 'Monday'],
    ['mardi', 'Tuesday'],
    ['mercredi', 'Wednesday'],
    ['jeudi', 'Thursday'],
    ['vendredi', 'Friday'],
    ['samedi', 'Saturday']
  ];

  test.each(FRENCH_TO_ENGLISH)('resolves French %s to %s', async (french, english) => {
    const result = await getMeetingDefaults(poolWithOrgInfo({ meeting_day: french }), 1);
    expect(result.meetingDay).toBe(english);
  });

  test.each(['Mercredi', 'MERCREDI', '  mercredi  '])(
    'is case- and whitespace-insensitive for %s',
    async (value) => {
      const result = await getMeetingDefaults(poolWithOrgInfo({ meeting_day: value }), 1);
      expect(result.meetingDay).toBe('Wednesday');
    }
  );

  test('passes English day names through unchanged', async () => {
    const result = await getMeetingDefaults(poolWithOrgInfo({ meeting_day: 'Friday' }), 1);
    expect(result.meetingDay).toBe('Friday');
  });

  test('falls back to the default for an unrecognized value', async () => {
    const result = await getMeetingDefaults(poolWithOrgInfo({ meeting_day: 'jour de la marmotte' }), 1);
    expect(result.meetingDay).toBe('Wednesday');
  });

  test('falls back to the default when the setting is absent', async () => {
    const result = await getMeetingDefaults(poolWith([]), 1);
    expect(result.meetingDay).toBe('Wednesday');
  });

  test('always returns a day the English weekday lookup can find', async () => {
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const value of ['mercredi', 'Samedi', 'Monday', 'nonsense', null, '']) {
      const result = await getMeetingDefaults(poolWithOrgInfo({ meeting_day: value }), 1);
      expect(DAYS.indexOf(result.meetingDay)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('getMeetingDefaults - other fields', () => {
  test('parses a JSON string setting_value', async () => {
    const pool = poolWith([
      { setting_key: 'organization_info', setting_value: JSON.stringify({ meeting_day: 'samedi', meeting_time: '10:00' }) }
    ]);
    const result = await getMeetingDefaults(pool, 1);
    expect(result.meetingDay).toBe('Saturday');
    expect(result.meetingTime).toBe('10:00');
  });

  test('meeting_length wins over organization_info for duration', async () => {
    const pool = poolWith([
      { setting_key: 'organization_info', setting_value: { meeting_duration: 60 } },
      { setting_key: 'meeting_length', setting_value: { duration_minutes: 120 } }
    ]);
    const result = await getMeetingDefaults(pool, 1);
    expect(result.durationMinutes).toBe(120);
  });

  test('falls back to the default duration', async () => {
    const result = await getMeetingDefaults(poolWith([]), 1);
    expect(result.durationMinutes).toBe(DEFAULT_MEETING_DURATION_MINUTES);
  });
});

describe('computeEndTime', () => {
  test('adds the duration', () => {
    expect(computeEndTime('19:00', 90)).toBe('20:30');
  });

  test('wraps past midnight', () => {
    expect(computeEndTime('23:30', 60)).toBe('00:30');
  });
});

describe('formatLocalDate', () => {
  test('formats in local time, not UTC', () => {
    // A late-evening local date must not roll back a day the way toISOString would.
    expect(formatLocalDate(new Date(2025, 8, 10, 23, 30))).toBe('2025-09-10');
  });
});
