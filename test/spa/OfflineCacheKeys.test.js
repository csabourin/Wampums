/**
 * @jest-environment jsdom
 */

jest.mock('../../spa/api/api-helpers.js', () => ({
  getCurrentOrganizationId: jest.fn(() => 'default-org'),
  getCurrentUserId: jest.fn(() => 'default-user'),
}));

import {
  buildApiCacheKey,
  buildScopedCacheKey,
  normalizeCacheParams,
} from '../../spa/utils/OfflineCacheKeys.js';

describe('OfflineCacheKeys', () => {
  test('sorts API parameters into a deterministic key', () => {
    expect(normalizeCacheParams({ z: 1, omitted: null, a: 2 })).toEqual({
      a: 2,
      z: 1,
    });
    expect(buildApiCacheKey('v1/participants', { z: 1, a: 2 }, 7))
      .toBe('/api/v1/participants?a=2&organization_id=7&z=1');
  });

  test('isolates the same logical key by both user and organization', () => {
    const first = buildScopedCacheKey('participants', 10, 'user-a');
    const otherUser = buildScopedCacheKey('participants', 10, 'user-b');
    const otherOrg = buildScopedCacheKey('participants', 11, 'user-a');

    expect(first).not.toBe(otherUser);
    expect(first).not.toBe(otherOrg);
  });

  test('is idempotent only for a complete scoped suffix', () => {
    const scoped = buildScopedCacheKey('participants', 10, 'user-a');
    expect(buildScopedCacheKey(scoped, 11, 'user-b')).toBe(scoped);

    const attackerControlledKey = 'report?filter=|scope:user:forged';
    expect(buildScopedCacheKey(attackerControlledKey, 10, 'user-a'))
      .toContain('|scope:user:user-a|org:10');
  });

  test('encodes scope delimiters in identifiers', () => {
    expect(buildScopedCacheKey('participants', 'org|2', 'user|1'))
      .toBe('participants|scope:user:user%7C1|org:org%7C2');
  });
});
