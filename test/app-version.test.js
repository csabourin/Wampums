const crypto = require('crypto');

describe('appVersion BUILD_ID selection', () => {
  const originalEnv = {
    FORCE_CLIENT_REFRESH: process.env.FORCE_CLIENT_REFRESH,
    RAILWAY_GIT_COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA,
    BUILD_ID: process.env.BUILD_ID,
  };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    if (originalEnv.FORCE_CLIENT_REFRESH === undefined) {
      delete process.env.FORCE_CLIENT_REFRESH;
    } else {
      process.env.FORCE_CLIENT_REFRESH = originalEnv.FORCE_CLIENT_REFRESH;
    }

    if (originalEnv.RAILWAY_GIT_COMMIT_SHA === undefined) {
      delete process.env.RAILWAY_GIT_COMMIT_SHA;
    } else {
      process.env.RAILWAY_GIT_COMMIT_SHA = originalEnv.RAILWAY_GIT_COMMIT_SHA;
    }

    if (originalEnv.BUILD_ID === undefined) {
      delete process.env.BUILD_ID;
    } else {
      process.env.BUILD_ID = originalEnv.BUILD_ID;
    }
  });

  test('prefers the built shell hash over deployment identifiers', () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = 'deploy-sha';
    process.env.BUILD_ID = 'deploy-build';

    jest.doMock('fs', () => ({
      readFileSync: jest.fn(() => Buffer.from('<html>built shell</html>')),
    }));
    jest.doMock('../config/logger', () => ({ info: jest.fn() }));

    const expectedHash = crypto
      .createHash('sha256')
      .update(Buffer.from('<html>built shell</html>'))
      .digest('hex')
      .slice(0, 12);

    const appVersionRoute = require('../routes/appVersion');

    expect(appVersionRoute.BUILD_ID).toBe(expectedHash);
  });

  test('keeps FORCE_CLIENT_REFRESH as the highest-priority override', () => {
    process.env.FORCE_CLIENT_REFRESH = 'force-refresh-token';
    process.env.RAILWAY_GIT_COMMIT_SHA = 'deploy-sha';
    process.env.BUILD_ID = 'deploy-build';

    jest.doMock('fs', () => ({
      readFileSync: jest.fn(() => Buffer.from('<html>built shell</html>')),
    }));
    jest.doMock('../config/logger', () => ({ info: jest.fn() }));

    const appVersionRoute = require('../routes/appVersion');

    expect(appVersionRoute.BUILD_ID).toBe('force-refresh-token');
  });
});
