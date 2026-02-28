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
  ])('$name', ({ jwtSecretKey, jwtSecret }) => {
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
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toEqual(expect.objectContaining({
      id: 42,
      role: 'admin',
      organizationId: 7,
    }));
  });
});
