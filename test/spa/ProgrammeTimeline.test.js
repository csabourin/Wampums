/**
 * Where the day's programme stands at a given minute: the answer the leaders'
 * bar shows. Times are the phone's local clock.
 *
 * @module test/spa/ProgrammeTimeline
 */

import { programmeMoment, localDateKey, msUntilNextMinute, minutesOfDay } from '../../spa/utils/ProgrammeTimeline.js';

const OPTIONS = { leadMinutes: 15, endingSoonMinutes: 5, defaultLastMinutes: 15 };
const MEETING = [
  { id: 1, time: '18:45', duration_minutes: 15, name: 'Accueil', leader: 'Bagheera', material: '' },
  { id: 2, time: '19:00', duration_minutes: 25, name: 'Jeu de la tanière', leader: 'Baloo', material: 'Foulards' },
  { id: 3, time: '19:25', duration_minutes: 20, name: 'Histoire de la jungle', leader: 'Akela', material: '' },
  { id: 4, time: '19:45', duration_minutes: null, name: 'Conseil', leader: 'Akela', material: '' },
];

/** @returns {Date} 16 October 2026 at that local time */
const at = (hours, minutes, seconds = 0) => new Date(2026, 9, 16, hours, minutes, seconds);
const moment = (time, activities = MEETING) => programmeMoment(activities, time, OPTIONS);

describe('where the programme stands', () => {
  test('nothing shows earlier than fifteen minutes before the first activity', () => {
    expect(moment(at(18, 29, 59)).state).toBe('hidden');
  });

  test('just before the start, it counts down to the first activity', () => {
    const now = moment(at(18, 35));
    expect(now.state).toBe('before');
    expect(now.next.activity.name).toBe('Accueil');
    expect(now.minutesUntil).toBe(10);
  });

  test('during an activity, it says how long is left and what comes next', () => {
    const now = moment(at(19, 13));
    expect(now.state).toBe('now');
    expect(now.current.activity.name).toBe('Jeu de la tanière');
    expect(now.minutesLeft).toBe(12);
    expect(now.endingSoon).toBe(false);
    expect(now.next.activity.name).toBe('Histoire de la jungle');
  });

  test('a part-minute left still counts as a minute, so it never shows 0 min', () => {
    expect(moment(at(19, 24, 30)).minutesLeft).toBe(1);
  });

  test('the last five minutes are "ending soon"', () => {
    expect(moment(at(19, 20)).endingSoon).toBe(true);
    expect(moment(at(19, 19)).endingSoon).toBe(false);
  });

  test('a last activity with no duration is given the default length, then the bar goes', () => {
    const last = moment(at(19, 50));
    expect(last.state).toBe('now');
    expect(last.next).toBeNull();
    expect(last.minutesLeft).toBe(10);
    expect(moment(at(20, 0)).state).toBe('hidden');
  });

  test('an activity with no duration lasts until the next one starts', () => {
    const activities = [
      { id: 1, time: '09:00', duration_minutes: null, name: 'Lever' },
      { id: 2, time: '09:30', duration_minutes: 30, name: 'Déjeuner' },
    ];
    expect(moment(at(9, 20), activities).minutesLeft).toBe(10);
  });

  test('a gap between activities, however long, still says what comes next', () => {
    const camp = [
      { id: 1, time: '09:30', duration_minutes: 150, name: 'Grand jeu' },
      { id: 2, time: '14:00', duration_minutes: 60, name: 'Baignade' },
    ];
    const now = moment(at(12, 30), camp);
    expect(now.state).toBe('gap');
    expect(now.next.activity.name).toBe('Baignade');
    expect(now.minutesUntil).toBe(90);
  });

  test('every timed activity is marked done, now or upcoming; untimed ones are left out', () => {
    const now = moment(at(19, 13), [...MEETING, { id: 9, time: null, name: 'Rangement' }]);
    expect(now.entries.map((entry) => [entry.activity.id, entry.status])).toEqual([
      [1, 'done'], [2, 'now'], [3, 'upcoming'], [4, 'upcoming'],
    ]);
  });

  test('activities typed out of order are put in time order', () => {
    const now = moment(at(19, 13), [MEETING[2], MEETING[0], MEETING[1]]);
    expect(now.entries.map((entry) => entry.activity.id)).toEqual([1, 2, 3]);
  });

  test('a day with no timed activity shows nothing', () => {
    expect(moment(at(19, 0), [{ id: 1, time: null, name: 'Libre' }]).state).toBe('hidden');
    expect(moment(at(19, 0), []).state).toBe('hidden');
  });
});

describe('clock helpers', () => {
  test('the day is the phone\'s own, not UTC\'s', () => {
    expect(localDateKey(new Date(2026, 9, 16, 23, 59))).toBe('2026-10-16');
  });

  test('the next redraw lands on the next whole minute', () => {
    expect(msUntilNextMinute(at(19, 13, 45))).toBe(15000);
  });

  test('times are read as minutes since midnight', () => {
    expect(minutesOfDay('19:25')).toBe(1165);
    expect(minutesOfDay('nonsense')).toBeNull();
  });
});
