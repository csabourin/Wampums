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
      roleIds: [1],
      roleNames: ['finance'],
      permissions: ['finance.view'],
      role: 'finance',
    },
  };
}

describe('authenticated organization selection', () => {
  test('keeps the signed organization and claims even if another membership is requested', async () => {
    const req = requestFor(20);
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          role_ids: [7],
          role_names: ['parent'],
          permissions: [],
        }],
      }),
    };

    await expect(getOrganizationId(req, pool)).resolves.toBe(10);
    expect(pool.query).not.toHaveBeenCalled();
    expect(req.user).toMatchObject({
      organizationId: 10,
      roleIds: [1],
      roleNames: ['finance'],
      permissions: ['finance.view'],
      role: 'finance',
    });
  });

  test('uses the signed organization when the header matches', async () => {
    const pool = {
      query: jest.fn(),
    };

    await expect(getOrganizationId(requestFor(10), pool)).resolves.toBe(10);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
