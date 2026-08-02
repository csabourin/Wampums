import { normalizeMeetingDurationMinutes } from '../../spa/utils/MeetingPlanUtils.js';

describe('normalizeMeetingDurationMinutes', () => {
  test.each([
    [90, 90],
    ['105', 105],
    ['90.5', 90],
  ])('normalizes %p to %p minutes', (value, expected) => {
    expect(normalizeMeetingDurationMinutes(value, 90)).toBe(expected);
  });

  test.each([undefined, null, '', 'not-a-number', Number.NaN, 0, -30])(
    'falls back for invalid value %p',
    (value) => {
      expect(normalizeMeetingDurationMinutes(value, 90)).toBe(90);
    }
  );
});

