const { rowPlaceholders } = require('../utils/sql-placeholders');

test('each row of a batch insert takes the next block of parameters', () => {
  expect(rowPlaceholders(0, 4)).toBe('$1, $2, $3, $4');
  expect(rowPlaceholders(1, 4)).toBe('$5, $6, $7, $8');
  expect(rowPlaceholders(2, 5)).toBe('$11, $12, $13, $14, $15');
});

test('parameters shared by every row can come before the first row', () => {
  expect(rowPlaceholders(0, 2, 1)).toBe('$2, $3');
  expect(rowPlaceholders(1, 2, 1)).toBe('$4, $5');
});
