/**
 * @jest-environment jsdom
 *
 * A span of days fits one line on a phone (#1428): short weekday, day and month, the year only
 * when the span leaves the current year.
 */
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));

import { formatDateRange } from '../../spa/utils/DateUtils.js';

/** Intl uses thin and narrow no-break spaces; compare words, not space characters. */
const words = (text) => text.replace(/\s+/gu, ' ').replace(/ ?– ?/u, ' – ');
const year = new Date().getFullYear();
const day = (month, date, y = year) => `${y}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(new Date(year, 5, 15, 12));
});
afterAll(() => jest.useRealTimers());

describe.each(['fr', 'en'])('in %s', (lang) => {
  test('a span within one month is short and has no year', () => {
    const text = words(formatDateRange(day(11, 18), day(11, 20), lang));
    expect(text).toMatch(lang === 'fr' ? /^mer\. 18 nov\. – ven\. 20 nov\.$/ : /^Wed, Nov 18 – Fri, Nov 20$/);
    expect(text).not.toContain(String(year));
  });

  test('a span over two months names both months', () => {
    const text = words(formatDateRange(day(11, 30), day(12, 2), lang));
    expect(text).toContain(lang === 'fr' ? '30 nov.' : 'Nov 30');
    expect(text).toContain(lang === 'fr' ? '2 déc.' : 'Dec 2');
    expect(text).not.toContain(String(year));
  });

  test('a span outside the current year says the year', () => {
    expect(words(formatDateRange(day(1, 30, year + 1), day(2, 2, year + 1), lang))).toContain(String(year + 1));
    expect(words(formatDateRange(day(12, 30), day(1, 2, year + 1), lang))).toContain(String(year + 1));
  });

  test('one day, or no end, reads as that day alone', () => {
    const single = words(formatDateRange(day(11, 18), day(11, 18), lang));
    expect(single).not.toContain('–');
    expect(words(formatDateRange(day(11, 18), null, lang))).toBe(single);
  });
});

test('without a readable first day, nothing is written', () => {
  expect(formatDateRange('', '2026-11-20', 'fr')).toBe('');
});
