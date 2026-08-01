describe('JWT secret resolution compatibility', () => {
  const originalJwtSecretKey = process.env.JWT_SECRET_KEY;
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalJwtSecretKey === undefined) {
      delete process.env.JWT_SECRET_KEY;
    } else {
      process.env.JWT_SECRET_KEY = originalJwtSecretKey;
    }

    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }

    jest.resetModules();
    jest.clearAllMocks();
  });

  test.each([
    {
      name: 'uses JWT_SECRET_KEY when only JWT_SECRET_KEY is set',
      jwtSecretKey: 'secret-key-only',
      jwtSecret: undefined,
    },
    {
      name: 'uses JWT_SECRET when only JWT_SECRET is set',
      jwtSecretKey: undefined,
      jwtSecret: 'secret-legacy-only',
    },
  ])('$name', async ({ jwtSecretKey, jwtSecret }) => {
    if (jwtSecretKey === undefined) {
      delete process.env.JWT_SECRET_KEY;
    } else {
      process.env.JWT_SECRET_KEY = jwtSecretKey;
    }

    if (jwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = jwtSecret;
    }

    const { signJWTToken, verifyJWTToken } = require('../utils/jwt-config');
    const { verifyJWT } = require('../utils/index');
    const { authenticate } = require('../middleware/auth');

    const token = signJWTToken(
      {
        user_id: 42,
        user_role: 'admin',
        organizationId: 7,
      },
      { expiresIn: '1h' }
    );

    // Helper-level verification
    const decodedByJwtConfig = verifyJWTToken(token);
    const decodedByUtils = verifyJWT(token);

    expect(decodedByJwtConfig.user_id).toBe(42);
    expect(decodedByUtils.user_id).toBe(42);
    expect(decodedByUtils.organizationId).toBe(7);

    // Middleware-level verification
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ organization_id: 7 }] }) };
    const req = {
      headers: { authorization: `Bearer ${token}` },
      app: { locals: { pool } }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toEqual(expect.objectContaining({
      id: 42,
      role: 'admin',
      organizationId: 7,
    }));
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('user_organizations'), [42, 7]);
  });

  test('rejects a valid token as soon as its organization membership is disabled', async () => {
    process.env.JWT_SECRET_KEY = 'membership-revocation-secret';
    delete process.env.JWT_SECRET;
    const { signJWTToken } = require('../utils/jwt-config');
    const { authenticate } = require('../middleware/auth');
    const token = signJWTToken({ user_id: 42, organizationId: 7 }, { expiresIn: '1h' });
    const req = {
      headers: { authorization: `Bearer ${token}` },
      app: { locals: { pool: { query: jest.fn().mockResolvedValue({ rows: [] }) } } }
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
