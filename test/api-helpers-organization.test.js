'use strict';

process.env.JWT_SECRET_KEY ||= 'api-helper-organization-test-secret';

const { getCurrentOrganizationId } = require('../utils/api-helpers');
const { signJWTToken } = require('../utils/jwt-config');

describe('public organization resolution', () => {
  const originalOrganizationId = process.env.ORGANIZATION_ID;

  beforeEach(() => {
    process.env.ORGANIZATION_ID = '4';
  });

  afterAll(() => {
    if (originalOrganizationId === undefined) {
      delete process.env.ORGANIZATION_ID;
    } else {
      process.env.ORGANIZATION_ID = originalOrganizationId;
    }
  });

  test('keeps a public organization header when the tenant exists', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    };
    const request = {
      headers: { 'x-organization-id': '3' },
      hostname: '127.0.0.1',
    };

    await expect(getCurrentOrganizationId(request, pool)).resolves.toBe(3);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT 1 FROM organizations WHERE id = $1 LIMIT 1',
      [3],
    );
  });

  test('recovers from a stale public header using the local organization', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    const logger = { info: jest.fn(), warn: jest.fn() };
    const request = {
      headers: { 'x-organization-id': '3' },
      hostname: '127.0.0.1',
    };

    await expect(getCurrentOrganizationId(request, pool, logger)).resolves.toBe(4);
    expect(logger.warn).toHaveBeenCalledWith(
      'Ignoring invalid or stale public organization header: 3',
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Using fallback ORGANIZATION_ID from ENV for local hostname: 127.0.0.1',
    );
  });

  test('ignores a stale session token when authentication is disabled', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    const logger = { info: jest.fn(), warn: jest.fn() };
    const request = {
      headers: {
        authorization: `Bearer ${signJWTToken({ user_id: 9, organizationId: 3 })}`,
        'x-organization-id': '3',
      },
      hostname: '127.0.0.1',
    };

    await expect(getCurrentOrganizationId(
      request,
      pool,
      logger,
      { allowAuthentication: false },
    )).resolves.toBe(4);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT 1 FROM organizations WHERE id = $1 LIMIT 1',
      [3],
    );
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('user_organizations'),
      expect.anything(),
    );
  });
});
