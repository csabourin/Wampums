/** @jest-environment jsdom */
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugError: jest.fn() }));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { DEFAULT_LANG: 'fr', TIME_FORMAT: { DEFAULT: '24h' } },
  getStorageKey: (key) => key,
}));

import { formatClockTime } from '../../spa/utils/DateUtils.js';
import { formatActivityDateRange } from '../../spa/utils/ActivityDateUtils.js';
import { getStorageKey } from '../../spa/config.js';

beforeEach(() => localStorage.clear());

test.each(['en', 'fr'])('clock times omit database seconds in %s', (lang) => {
  localStorage.setItem(getStorageKey('TIME_FORMAT'), '24h');
  expect(formatClockTime('09:05:00', lang)).toBe('09:05');
  expect(formatClockTime('09:05', lang)).toBe('09:05');
});

test('clock times respect a twelve-hour time preference', () => {
  localStorage.setItem(getStorageKey('TIME_FORMAT'), '12h');
  expect(formatClockTime('16:05:00', 'en')).toMatch(/4:05\s*PM/);
});

test.each(['', null, 'not a time', '24:00:00', '10:60:00'])('invalid clock time %s is not displayed as midnight', (value) => {
  expect(formatClockTime(value, 'en')).toBe('');
});

test('activity date ranges use the same readable times as carpool meeting details', () => {
  localStorage.setItem(getStorageKey('TIME_FORMAT'), '12h');
  const label = formatActivityDateRange({
    activity_start_date: '2026-11-20', activity_end_date: '2026-11-20',
    activity_start_time: '09:00:00', activity_end_time: '16:00:00',
  }, 'en');
  expect(label).toMatch(/9:00\s*AM/);
  expect(label).toMatch(/4:00\s*PM/);
  expect(label).not.toContain(':00:00');
});
