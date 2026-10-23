'use strict';

/** What a demo visitor may send, and when the night reset acts. */

const { DEMO_SANDBOX, isHarmlessDemoWrite } = require('../middleware/demoSandbox');
const { parseArguments, isMidnightIn } = require('../scripts/demo/reset-demo-sandbox');

const NOW = Date.parse('2026-10-23T15:00:00Z');

describe('the demo sandbox', () => {
  test('lets points through as ids and small numbers', () => {
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.points, [
      { type: 'individual', id: 12, points: 5 },
      { type: 'group', id: '3', points: -10 },
    ], NOW)).toBe(true);
  });

  test('lets through the points the points screen actually sends, timestamp and group date included', () => {
    const timestamp = '2026-10-23T14:59:58.123Z';
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.points, [{ type: 'individual', id: 12, points: 5, timestamp }], NOW)).toBe(true);
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.points, [{ type: 'group', id: 3, points: 5, timestamp, date: '2026-10-23' }], NOW)).toBe(true);
  });

  test('refuses a timestamp that carries words', () => {
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.points, [{ type: 'individual', id: 12, points: 5, timestamp: '2026-10-23T14:59:58Z visit my site' }], NOW)).toBe(false);
  });

  test('refuses points beyond what a button gives, or a flood of entries', () => {
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.points, [{ type: 'individual', id: 12, points: 101 }], NOW)).toBe(false);
    const flood = Array.from({ length: 201 }, () => ({ type: 'individual', id: 12, points: 1 }));
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.points, flood, NOW)).toBe(false);
  });

  test('refuses any field it does not know, so no text can ride along', () => {
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.points, [{ type: 'individual', id: 12, points: 5, note: 'hello' }], NOW)).toBe(false);
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.attendanceMark, {
      participant_id: 12, date: '2026-10-23', status: 'present', comment: 'hello',
    }, NOW)).toBe(false);
  });

  test('refuses a status written as a sentence', () => {
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.attendanceMark, {
      participant_id: 12, date: '2026-10-23', status: 'Visit my site',
    }, NOW)).toBe(false);
  });

  test('lets attendance through for one child or several, close to today', () => {
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.attendanceMark, {
      participant_id: 12, date: '2026-10-23', status: 'present', previous_status: null,
    }, NOW)).toBe(true);
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.attendanceBatch, {
      participant_id: [12, '13'], date: '2026-10-16', status: 'absent',
    }, NOW)).toBe(true);
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.attendanceCarryForward, { fromDate: '2026-10-16', toDate: '2026-10-23' }, NOW)).toBe(true);
  });

  test('refuses a date years away from today', () => {
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.attendanceMark, {
      participant_id: 12, date: '2031-01-01', status: 'present',
    }, NOW)).toBe(false);
  });

  test('lets an honor through only without a reason', () => {
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.honorAward, [{ participantId: '12', date: '2026-10-23', reason: '' }], NOW)).toBe(true);
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.honorAward, { participant_id: 12, date: '2026-10-23' }, NOW)).toBe(true);
    expect(isHarmlessDemoWrite(DEMO_SANDBOX.honorAward, [{ participantId: 12, date: '2026-10-23', reason: 'pwned' }], NOW)).toBe(false);
  });

  test('refuses everything without a policy', () => {
    expect(isHarmlessDemoWrite(null, { id: 1 }, NOW)).toBe(false);
  });
});

describe('the night reset', () => {
  test('acts only during the midnight hour of the time zone it is given', () => {
    // 04:30 UTC is 00:30 in Toronto in summer (EDT), 23:30 the evening before in winter (EST).
    expect(isMidnightIn('America/Toronto', new Date('2026-07-01T04:30:00Z'))).toBe(true);
    expect(isMidnightIn('America/Toronto', new Date('2026-01-15T04:30:00Z'))).toBe(false);
    expect(isMidnightIn('America/Toronto', new Date('2026-01-15T05:30:00Z'))).toBe(true);
  });

  test('reads its options and refuses one it does not know', () => {
    expect(parseArguments(['--dry-run', '--only-at-midnight=America/Toronto'])).toEqual({
      capture: false, dryRun: true, midnightZone: 'America/Toronto',
    });
    expect(() => parseArguments(['--everything'])).toThrow(/Unknown argument/);
  });
});
