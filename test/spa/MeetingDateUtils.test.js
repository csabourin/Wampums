/**
 * @jest-environment jsdom
 *
 * MeetingDateUtils & BirthdayUtils Test Suite
 *
 * Covers the shared meeting-date arithmetic and birthday-range logic that
 * replaced the per-page implementations (FormManager/DateManager and the
 * duplicated birthday code in the prep + upcoming meeting views).
 *
 * @module test/spa/MeetingDateUtils
 */

// Mock DateUtils to keep the test hermetic (no config/storage dependencies)
jest.mock('../../spa/utils/DateUtils.js', () => ({
  parseDate: jest.fn((dateString) => {
    if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }),
  isoToDateString: jest.fn((value) => {
    if (!value) return '';
    if (value instanceof Date) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(value).includes('T') ? String(value).split('T')[0] : String(value);
  })
}));

import {
  toLocalDateString,
  normalizeDateString,
  getNextWeekdayDate,
  nextDateAfter,
  previousDateBefore,
  addOneWeek
} from '../../spa/utils/MeetingDateUtils.js';
import { getUpcomingBirthdays } from '../../spa/utils/BirthdayUtils.js';

describe('MeetingDateUtils', () => {
  describe('toLocalDateString', () => {
    test('formats a Date as local YYYY-MM-DD', () => {
      expect(toLocalDateString(new Date(2026, 8, 9))).toBe('2026-09-09');
    });

    test('pads single-digit months and days', () => {
      expect(toLocalDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    });
  });

  describe('normalizeDateString', () => {
    test('strips the time part from ISO strings', () => {
      expect(normalizeDateString('2026-09-09T00:00:00.000Z')).toBe('2026-09-09');
    });

    test('returns plain dates unchanged', () => {
      expect(normalizeDateString('2026-09-09')).toBe('2026-09-09');
    });

    test('returns empty string for falsy input', () => {
      expect(normalizeDateString(null)).toBe('');
      expect(normalizeDateString('')).toBe('');
    });
  });

  describe('getNextWeekdayDate', () => {
    test('finds the next occurrence of the meeting day', () => {
      // 2026-09-07 is a Monday; next Wednesday is 2026-09-09
      const from = new Date(2026, 8, 7, 12, 0, 0);
      expect(getNextWeekdayDate('Wednesday', from)).toBe('2026-09-09');
    });

    test('returns the same day when it is meeting day before the evening cutoff', () => {
      // 2026-09-09 is a Wednesday, at noon
      const from = new Date(2026, 8, 9, 12, 0, 0);
      expect(getNextWeekdayDate('Wednesday', from)).toBe('2026-09-09');
    });

    test('rolls to next week when it is meeting day after 8 PM', () => {
      const from = new Date(2026, 8, 9, 21, 0, 0);
      expect(getNextWeekdayDate('Wednesday', from)).toBe('2026-09-16');
    });

    test('falls back to the reference date for unknown day names', () => {
      const from = new Date(2026, 8, 7, 12, 0, 0);
      expect(getNextWeekdayDate('Notaday', from)).toBe('2026-09-07');
    });
  });

  describe('nextDateAfter / previousDateBefore', () => {
    const dates = ['2026-09-02', '2026-09-09T00:00:00Z', '2026-09-16', '2026-09-23'];

    test('finds the first date strictly after the reference', () => {
      expect(nextDateAfter(dates, '2026-09-09')).toBe('2026-09-16');
    });

    test('normalizes ISO entries when comparing', () => {
      expect(nextDateAfter(dates, '2026-09-02')).toBe('2026-09-09');
    });

    test('returns null when no later date exists', () => {
      expect(nextDateAfter(dates, '2026-09-23')).toBeNull();
    });

    test('finds the last date strictly before the reference', () => {
      expect(previousDateBefore(dates, '2026-09-16')).toBe('2026-09-09');
    });

    test('returns null when no earlier date exists', () => {
      expect(previousDateBefore(dates, '2026-09-02')).toBeNull();
    });

    test('returns null for empty references', () => {
      expect(nextDateAfter(dates, '')).toBeNull();
      expect(previousDateBefore(dates, null)).toBeNull();
    });
  });

  describe('addOneWeek', () => {
    test('adds seven days', () => {
      expect(addOneWeek('2026-09-09')).toBe('2026-09-16');
    });

    test('crosses month boundaries', () => {
      expect(addOneWeek('2026-09-28')).toBe('2026-10-05');
    });

    test('returns null for invalid input', () => {
      expect(addOneWeek('')).toBeNull();
      expect(addOneWeek('not-a-date')).toBeNull();
    });
  });
});

describe('BirthdayUtils.getUpcomingBirthdays', () => {
  const participants = [
    { id: 1, first_name: 'Alice', last_name: 'Tremblay', date_naissance: '2016-09-10' },
    { id: 2, first_name: 'Benoit', last_name: 'Roy', date_of_birth: '2015-09-14' },
    { id: 3, first_name: 'Chloe', last_name: 'Gagnon', date_naissance: '2016-01-02' },
    { id: 4, first_name: 'Dario', last_name: 'Cote' } // no birthdate
  ];

  test('returns birthdays within [start, end), sorted by date', () => {
    const result = getUpcomingBirthdays(participants, '2026-09-09', '2026-09-16');
    expect(result.entries.map(e => e.id)).toEqual([1, 2]);
    expect(result.entries[0]).toMatchObject({ name: 'Alice Tremblay', date: '2026-09-10' });
  });

  test('excludes the end date (next meeting day)', () => {
    const result = getUpcomingBirthdays(participants, '2026-09-09', '2026-09-14');
    expect(result.entries.map(e => e.id)).toEqual([1]);
  });

  test('handles ranges crossing a year boundary', () => {
    const result = getUpcomingBirthdays(participants, '2025-12-30', '2026-01-06');
    expect(result.entries.map(e => e.id)).toEqual([3]);
    expect(result.entries[0].date).toBe('2026-01-02');
  });

  test('skips participants without a birthdate', () => {
    const result = getUpcomingBirthdays(participants, '2026-09-01', '2026-09-30');
    expect(result.entries.some(e => e.id === 4)).toBe(false);
  });

  test('returns empty entries when the range is incomplete', () => {
    expect(getUpcomingBirthdays(participants, '2026-09-09', null).entries).toEqual([]);
    expect(getUpcomingBirthdays(participants, null, '2026-09-16').entries).toEqual([]);
  });

  test('tolerates a non-array participants argument', () => {
    expect(getUpcomingBirthdays(null, '2026-09-09', '2026-09-16').entries).toEqual([]);
  });
});
