'use strict';

process.env.JWT_SECRET_KEY ||= 'organization-selection-test-secret';
const { getOrganizationId } = require('../middleware/auth');

function requestFor(headerOrganizationId) {
  return {
    headers: {
      'x-organization-id': String(headerOrganizationId),
    },
    query: {},
    body: {},
    method: 'GET',
    path: '/api/v1/participants',
    user: {
      id: 'user-1',
      organizationId: 10,
    },
  };
}

describe('authenticated organization selection', () => {
  test('uses a selected organization after membership validation', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [{ exists: 1 }] }),
    };

    await expect(getOrganizationId(requestFor(20), pool)).resolves.toBe(20);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('user_organizations'),
      ['user-1', 20],
    );
  });

  test('falls back to the signed organization for an unauthorized selection', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    await expect(getOrganizationId(requestFor(999), pool)).resolves.toBe(10);
  });

  test('does not query membership when selection matches the signed organization', async () => {
    const pool = {
      query: jest.fn(),
    };

    await expect(getOrganizationId(requestFor(10), pool)).resolves.toBe(10);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
