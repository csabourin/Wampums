const {
  normalizeName,
  validateChild,
  MAX_PARTICIPANT_AGE_YEARS,
} = require('../services/parentOnboarding');

const NOW = new Date('2026-09-23T12:00:00.000Z');
const child = (overrides) => ({ firstName: 'Léa', lastName: 'Tremblay', dateOfBirth: '2016-05-01', ...overrides });

test('names compare regardless of case and stray spaces', () => {
  expect(normalizeName('  LÉA   Marie ')).toBe(normalizeName('léa marie'));
});

test('accents are not folded, because Léa and Lea may be two children', () => {
  expect(normalizeName('Léa')).not.toBe(normalizeName('Lea'));
});

test('accepts an ordinary child', () => {
  expect(validateChild(child(), NOW)).toBeNull();
});

test.each([
  ['name_required', { firstName: '  ' }],
  ['name_required', { lastName: undefined }],
  ['name_too_long', { lastName: 'x'.repeat(256) }],
  ['date_of_birth_required', { dateOfBirth: undefined }],
  ['date_of_birth_required', { dateOfBirth: '01/05/2016' }],
  ['date_of_birth_invalid', { dateOfBirth: '2016-02-30' }],
  ['date_of_birth_in_future', { dateOfBirth: '2026-09-24' }],
  ['date_of_birth_too_old', { dateOfBirth: '1916-05-01' }],
])('refuses with %s', (code, overrides) => {
  expect(validateChild(child(overrides), NOW)).toBe(code);
});

test('the oldest accepted birth date is the Rover ceiling, not an arbitrary century', () => {
  const edge = `${2026 - MAX_PARTICIPANT_AGE_YEARS}-09-24`;
  expect(validateChild(child({ dateOfBirth: edge }), NOW)).toBeNull();
});
