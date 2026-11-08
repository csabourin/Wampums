/**
 * The day the attendance screen opens on: today when something is on, else
 * the meeting of the past week whose attendance is being completed.
 */
const { defaultAttendanceDate, RECENT_MEETING_WINDOW_DAYS } = require('../../spa/modules/attendance/AttendanceDefaultDate.js');

const TODAY = '2026-11-08';

test('today, when the server lists it', () => {
  expect(defaultAttendanceDate(['2026-11-06', TODAY], TODAY)).toBe(TODAY);
});

test('the most recent day of the past week otherwise', () => {
  expect(defaultAttendanceDate(['2026-10-30', '2026-11-03', '2026-11-06', '2026-11-20'], TODAY)).toBe('2026-11-06');
});

test('a week is the limit; beyond it, and with only days to come, today', () => {
  expect(RECENT_MEETING_WINDOW_DAYS).toBe(6);
  expect(defaultAttendanceDate(['2026-11-02'], TODAY)).toBe('2026-11-02');
  expect(defaultAttendanceDate(['2026-11-01'], TODAY)).toBe(TODAY);
  expect(defaultAttendanceDate(['2026-11-09'], TODAY)).toBe(TODAY);
  expect(defaultAttendanceDate(undefined, TODAY)).toBe(TODAY);
});

test('a month boundary is counted in days, not by the day of the month', () => {
  expect(defaultAttendanceDate(['2026-10-31'], '2026-11-02')).toBe('2026-10-31');
});
