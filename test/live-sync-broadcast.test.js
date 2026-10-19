/**
 * Announcing successful writes to a unit's other open sessions.
 */
const { EventEmitter } = require('events');

const mockEmit = jest.fn();
const mockExcept = jest.fn();
const mockTo = jest.fn();
const mockSockets = new Map();

jest.mock('../services/socket', () => ({
  getIO: () => ({ to: mockTo, sockets: { sockets: mockSockets } }),
}));

const { liveSyncBroadcaster, announcedPath } = require('../middleware/live-sync');

/** The live_sync_versions table, as the two statements of services/liveSyncState.js see it. */
const mockVersions = new Map();
const mockPool = {
  query: jest.fn((sql, params) => {
    if (/INSERT INTO live_sync_versions/.test(sql)) {
      const version = (mockVersions.get(params[0]) || 0) + 1;
      mockVersions.set(params[0], version);
      return Promise.resolve({ rows: [{ version }] });
    }
    const [ids] = params;
    return Promise.resolve({
      rows: ids.filter((id) => mockVersions.has(id)).map((id) => ({ organization_id: id, version: mockVersions.get(id) })),
    });
  }),
};

/**
 * @param {number} organizationId - Unit (0 for the shared row)
 * @returns {number} Its counted version
 */
function versionOf(organizationId) {
  return mockVersions.get(organizationId) || 0;
}

/**
 * An open session, as Socket.IO keeps it.
 * @param {string} id - Socket id
 * @param {string} room - Unit room it joined
 * @returns {{ emit: jest.Mock }} The session
 */
function openSession(id, room) {
  const session = { emit: jest.fn(), rooms: new Set([id, room]) };
  mockSockets.set(id, session);
  return session;
}

/**
 * Run a request through the middleware, finish it with a status, and let the
 * announcement complete.
 * @param {Object} options
 * @returns {Promise<void>}
 */
async function runRequest({ method = 'POST', url, status = 200, user = { organizationId: 12 }, headers = {}, locals = {} }) {
  const req = {
    method,
    originalUrl: url,
    user,
    app: { locals: { pool: mockPool } },
    get: (name) => headers[name.toLowerCase()],
  };
  const res = new EventEmitter();
  res.statusCode = status;
  res.locals = locals;
  const next = jest.fn();

  liveSyncBroadcaster(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  res.emit('finish');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  mockEmit.mockReset();
  mockExcept.mockReset();
  mockTo.mockReset();
  mockSockets.clear();
  mockVersions.clear();
  const room = { emit: mockEmit, except: mockExcept };
  mockExcept.mockReturnValue(room);
  mockTo.mockReturnValue(room);
});

describe('liveSyncBroadcaster', () => {
  test("announces a successful write to the writer's unit, with the path only", async () => {
    await runRequest({ method: 'DELETE', url: '/api/v1/participants/42?organization_id=12', status: 204 });

    expect(mockTo).toHaveBeenCalledWith('org-12');
    expect(mockEmit).toHaveBeenCalledWith('data-changed', {
      path: '/api/v1/participants/42',
      version: expect.any(Number),
    });
  });

  test("each announcement carries the unit's next version, counted per unit", async () => {
    const before = versionOf(12);
    const otherUnit = versionOf(13);

    await runRequest({ url: '/api/v1/points' });
    await runRequest({ url: '/api/v1/points' });

    expect(mockEmit.mock.calls.map(([, payload]) => payload.version)).toEqual([before + 1, before + 2]);
    expect(versionOf(12)).toBe(before + 2);
    expect(versionOf(13)).toBe(otherUnit);
  });

  test('a write accepted but still under way is neither counted, announced nor acknowledged', async () => {
    const writer = openSession('Writer123', 'org-12');
    const before = versionOf(12);

    await runRequest({ url: '/api/v1/notifications/subscription', status: 202, headers: { 'x-live-sync-client': 'Writer123' } });

    expect(versionOf(12)).toBe(before);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(writer.emit).not.toHaveBeenCalled();
  });

  test('a change the database could not count is still announced, without a version to count as seen', async () => {
    const writer = openSession('Writer123', 'org-12');
    mockPool.query.mockRejectedValueOnce(new Error('connection terminated'));

    await runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'Writer123' } });

    expect(mockEmit).toHaveBeenCalledWith('data-changed', { path: '/api/v1/points' });
    expect(writer.emit).not.toHaveBeenCalled();
  });

  test("the writer's acknowledgement names its own write's version, not a later one", async () => {
    const writer = openSession('Writer123', 'org-12');
    // Another instance counts a change between this write and the acknowledgement.
    const realQuery = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementationOnce(realQuery).mockImplementationOnce((sql, params) => {
      mockVersions.set(12, (mockVersions.get(12) || 0) + 1);
      return realQuery(sql, params);
    });

    await runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'Writer123' } });

    expect(versionOf(12)).toBe(2);
    expect(writer.emit).toHaveBeenCalledWith('sync-state', { org: '12', version: 1, shared: 0 });
  });

  test('when the writer\'s acknowledgement cannot be read, the other sessions are still told', async () => {
    const writer = openSession('Writer123', 'org-12');
    const realQuery = mockPool.query.getMockImplementation();
    mockPool.query.mockImplementationOnce(realQuery).mockRejectedValueOnce(new Error('connection terminated'));

    await runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'Writer123' } });

    expect(mockEmit).toHaveBeenCalledWith('data-changed', { path: '/api/v1/points', version: 1 });
    expect(writer.emit).not.toHaveBeenCalled();
  });

  test('a write that fails changes no version', async () => {
    const before = versionOf(12);

    await runRequest({ url: '/api/v1/points', status: 400 });

    expect(versionOf(12)).toBe(before);
  });

  test("the session that made the write learns the unit's new version", async () => {
    const writer = openSession('Writer123', 'org-12');

    await runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'Writer123' } });

    expect(writer.emit).toHaveBeenCalledWith('sync-state', { org: '12', version: versionOf(12), shared: 0 });
  });

  test('a session of another unit named in the header hears nothing', async () => {
    const stranger = openSession('Stranger99', 'org-13');

    await runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'Stranger99' } });

    expect(stranger.emit).not.toHaveBeenCalled();
  });

  test('leaves out the session that made the write', async () => {
    await runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'AbC123_-xyz' } });

    expect(mockExcept).toHaveBeenCalledWith('AbC123_-xyz');
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  test('ignores a malformed connection id rather than passing it to Socket.IO', async () => {
    await runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'not a socket id!' } });

    expect(mockExcept).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['a failed write', { url: '/api/v1/points', status: 400 }],
    ['a refused write', { url: '/api/v1/points', status: 403 }],
    ['a read', { method: 'GET', url: '/api/v1/points' }],
    ['an unauthenticated write', { url: '/api/v1/points', user: null }],
    ['a legacy path', { url: '/api/points' }],
    ['a read made with POST', { url: '/api/v1/users/permissions/check' }],
    ['an AI query', { url: '/api/v1/ai/ask' }],
  ])('says nothing about %s', async (_label, request) => {
    await runRequest(request);

    expect(mockEmit).not.toHaveBeenCalled();
  });

  test('a failed announcement never throws into the finished request', async () => {
    mockTo.mockImplementation(() => {
      throw new Error('Socket.IO not initialized!');
    });

    await expect(runRequest({ url: '/api/v1/points' })).resolves.toBeUndefined();
  });
});

describe('writes that are not announced', () => {
  test('a public page\'s write moves the shared version, announcing nothing', async () => {
    const before = versionOf(0);

    await runRequest({ url: '/api/v1/public/parent-invitations/accept', user: null });

    expect(versionOf(0)).toBe(before + 1);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test.each([
    '/api/v1/auth/login',
    '/api/v1/auth/verify-2fa',
    '/api/v1/auth/verify-session',
    '/api/v1/auth/logout',
    '/public/login',
    '/api/v1/public/contact-demo',
  ])('signing in and the like (%s) do not count', async (url) => {
    const before = versionOf(0);

    await runRequest({ url, user: null });

    expect(versionOf(0)).toBe(before);
  });

  test('a failed public write does not count', async () => {
    const before = versionOf(0);

    await runRequest({ url: '/api/v1/public/family-links/accept', user: null, status: 400 });

    expect(versionOf(0)).toBe(before);
  });

  test('a destination unit that could not be counted does not stop the writer\'s unit being told', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('connection terminated'));

    await runRequest({ url: '/api/v1/transfers', locals: { liveSyncOrganizationIds: [31] } });

    expect(versionOf(12)).toBe(1);
    expect(mockEmit).toHaveBeenCalledWith('data-changed', { path: '/api/v1/transfers', version: 1 });
  });

  test('another unit a write changed moves on, without being told what changed', async () => {
    const destination = versionOf(31);
    const writer = versionOf(12);

    await runRequest({ url: '/api/v1/transfers', locals: { liveSyncOrganizationIds: [31, 31, 12] } });

    expect(versionOf(31)).toBe(destination + 1);
    expect(versionOf(12)).toBe(writer + 1);
    expect(mockTo).toHaveBeenCalledTimes(1);
    expect(mockTo).toHaveBeenCalledWith('org-12');
  });
});

describe('a signed-out write its route attributed to one unit', () => {
  const PAYMENT_PATH = '/api/v1/finance/participant-fees/42/payments';

  test('is counted for that unit and announced there, under the path the route named', async () => {
    await runRequest({
      url: '/api/v1/stripe/webhook',
      user: null,
      locals: { liveSyncAnnouncement: { organizationId: 7, path: PAYMENT_PATH } },
    });

    expect(mockTo).toHaveBeenCalledWith('org-7');
    expect(mockEmit).toHaveBeenCalledWith('data-changed', { path: PAYMENT_PATH, version: 1 });
    expect(versionOf(7)).toBe(1);
    expect(versionOf(0)).toBe(0);
  });

  test.each([
    ['no unit', { path: PAYMENT_PATH }],
    ['a unit that is not an id', { organizationId: 'org-7', path: PAYMENT_PATH }],
    ['a path outside the API', { organizationId: 7, path: '/dashboard' }],
  ])('with %s is only counted as a shared change, announcing nothing', async (_case, announcement) => {
    await runRequest({ url: '/api/v1/stripe/webhook', user: null, locals: { liveSyncAnnouncement: announcement } });

    expect(mockEmit).not.toHaveBeenCalled();
    expect(versionOf(0)).toBe(1);
  });

  test('cannot redirect a signed-in write to another unit', async () => {
    await runRequest({
      url: '/api/v1/points',
      user: { organizationId: 12 },
      locals: { liveSyncAnnouncement: { organizationId: 7, path: PAYMENT_PATH } },
    });

    expect(mockTo).toHaveBeenCalledWith('org-12');
    expect(mockTo).not.toHaveBeenCalledWith('org-7');
    expect(mockEmit).toHaveBeenCalledWith('data-changed', { path: '/api/v1/points', version: 1 });
  });
});

describe('announcedPath', () => {
  test('drops the query string and a trailing slash', () => {
    expect(announcedPath({ originalUrl: '/api/v1/groups/3/?x=1' })).toBe('/api/v1/groups/3');
  });
});
