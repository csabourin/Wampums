/**
 * The subdomain a unit is created at: one DNS label under wampums.app, never
 * a name the platform keeps for itself.
 */

const { readUnitSubdomain, subdomainConfig } = require('../utils/unitSubdomains');

describe('a unit subdomain', () => {
  test('is read without case or surrounding spaces, and stored as a full hostname', () => {
    expect(readUnitSubdomain('  Meute-Ada  ')).toEqual({
      subdomain: 'meute-ada',
      hostname: 'meute-ada.wampums.app',
      problem: null,
    });
  });

  test('is required', () => {
    expect(readUnitSubdomain(undefined).problem).toBe('subdomain_required');
    expect(readUnitSubdomain('   ').problem).toBe('subdomain_required');
    expect(readUnitSubdomain(42).problem).toBe('subdomain_required');
  });

  test.each([
    ['ab', 'too short'],
    ['a'.repeat(subdomainConfig.maxLength + 1), 'too long'],
    ['-meute', 'starting with a hyphen'],
    ['meute-', 'ending with a hyphen'],
    ['xn--meute', 'holding two hyphens in a row'],
    ['meute_ada', 'holding an underscore'],
    ['meute.ada', 'holding a dot'],
    ['louveteaux-é', 'holding an accent'],
  ])('refuses %s (%s)', (value) => {
    expect(readUnitSubdomain(value).problem).toBe('subdomain_invalid');
  });

  test('refuses the names the platform keeps for itself', () => {
    expect(readUnitSubdomain('WWW').problem).toBe('subdomain_reserved');
    expect(readUnitSubdomain('demo').problem).toBe('subdomain_reserved');
  });

  test('accepts the longest label DNS allows', () => {
    expect(readUnitSubdomain('a'.repeat(subdomainConfig.maxLength)).problem).toBeNull();
  });
});
