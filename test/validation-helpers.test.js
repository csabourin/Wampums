const {
  validateMoney,
  validateDate,
  validatePositiveInteger,
} = require('../utils/validation-helpers');

describe('amounts', () => {
  test.each([0, 12, 12.5, 12.25, '12', '12.5', '12.50', '0.99'])('%p is accepted', (value) => {
    expect(validateMoney(value, 'amount')).toEqual({ valid: true, value: Number(value) });
  });

  test.each(['12CAD', '12 $', '12,50', '12.345', 12.345, '-1', -1, '', ' 12', '1e3', '.5', null, undefined, NaN, Infinity, true, {}])(
    '%p is refused rather than read as a number',
    (value) => {
      expect(validateMoney(value, 'amount').valid).toBe(false);
    }
  );
});

describe('dates', () => {
  test.each(['2026-11-04', '2028-02-29'])('%p is a calendar date', (value) => {
    expect(validateDate(value, 'revenue_date')).toEqual({ valid: true, value });
  });

  test('a date the API sent back as a UTC timestamp is read as its date', () => {
    expect(validateDate('2026-11-04T00:00:00.000Z', 'revenue_date')).toEqual({ valid: true, value: '2026-11-04' });
  });

  test.each(['2026-02-30', '2027-02-29', '2026-13-01', '11/04/2026', 'November 4, 2026', '2026-11-04T10:00:00', '2026-02-30T00:00:00Z', '', null, 20261104])(
    '%p is refused',
    (value) => {
      expect(validateDate(value, 'revenue_date').valid).toBe(false);
    }
  );
});

describe('positive integers', () => {
  test.each([[1, 1], ['7', 7], [2147483647, 2147483647], ['2147483647', 2147483647]])('%p is read as %p', (value, expected) => {
    expect(validatePositiveInteger(value, 'id')).toEqual({ valid: true, value: expected });
  });

  test.each(['7abc', '7.0', '7.5', 7.5, 0, '0', -3, '-3', 2147483648, '2147483648', '', ' 7', '0x10', '1e3', null, undefined, true])(
    '%p is refused',
    (value) => {
      expect(validatePositiveInteger(value, 'id').valid).toBe(false);
    }
  );
});
