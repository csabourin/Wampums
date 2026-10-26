/**
 * The creation form and the server read a unit's subdomain the same way:
 * what the form lets through, the server accepts, and the reverse.
 */

import { subdomainProblem, suggestSubdomain } from '../../spa/utils/UnitSubdomainUtils.js';

const { readUnitSubdomain } = require('../../utils/unitSubdomains');

const CASES = [
  '', '   ', 'ab', 'abc', 'Meute-Ada', 'meute--ada', '-meute', 'meute-', 'meute_ada', 'meute.ada',
  'www', 'DEMO', 'a'.repeat(63), 'a'.repeat(64), 'louveteaux-é', '6e-groupe',
];

test.each(CASES)('the form and the server agree on "%s"', (value) => {
  expect(subdomainProblem(value)).toBe(readUnitSubdomain(value).problem);
});

test('a suggestion drawn from a unit\'s name is an address the server can accept', () => {
  [
    'Éclaireurs 6E Lac-aux-Castors',
    'Meute « Ada » — Hull',
    `Colonie ${'très '.repeat(30)}longue`,
    'Œuvre des Louveteaux',
  ].forEach((name) => {
    const suggestion = suggestSubdomain(name);
    expect(readUnitSubdomain(suggestion).problem).toBeNull();
  });
  expect(suggestSubdomain('Éclaireurs 6E Lac-aux-Castors')).toBe('eclaireurs-6e-lac-aux-castors');
});

test('a name too short or made only of symbols suggests nothing rather than an unusable address', () => {
  expect(suggestSubdomain('Lé')).toBe('');
  expect(suggestSubdomain('★ ★')).toBe('');
});
