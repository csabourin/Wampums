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
const { syncStateFor } = require('../services/liveSyncState');

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
 * Run a request through the middleware and finish it with a status.
 * @param {Object} options
 * @returns {void}
 */
function runRequest({ method = 'POST', url, status = 200, user = { organizationId: 12 }, headers = {}, locals = {} }) {
  const req = {
    method,
    originalUrl: url,
    user,
    get: (name) => headers[name.toLowerCase()],
  };
  const res = new EventEmitter();
  res.statusCode = status;
  res.locals = locals;
  const next = jest.fn();

  liveSyncBroadcaster(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  res.emit('finish');
}

beforeEach(() => {
  mockEmit.mockReset();
  mockExcept.mockReset();
  mockTo.mockReset();
  mockSockets.clear();
  const room = { emit: mockEmit, except: mockExcept };
  mockExcept.mockReturnValue(room);
  mockTo.mockReturnValue(room);
});

describe('liveSyncBroadcaster', () => {
  test("announces a successful write to the writer's unit, with the path only", () => {
    runRequest({ method: 'DELETE', url: '/api/v1/participants/42?organization_id=12', status: 204 });

    expect(mockTo).toHaveBeenCalledWith('org-12');
    expect(mockEmit).toHaveBeenCalledWith('data-changed', {
      path: '/api/v1/participants/42',
      version: expect.any(Number),
    });
  });

  test("each announcement carries the unit's next version, counted per unit", () => {
    const before = syncStateFor(12).version;
    const otherUnit = syncStateFor(13).version;

    runRequest({ url: '/api/v1/points' });
    runRequest({ url: '/api/v1/points' });

    expect(mockEmit.mock.calls.map(([, payload]) => payload.version)).toEqual([before + 1, before + 2]);
    expect(syncStateFor(12).version).toBe(before + 2);
    expect(syncStateFor(13).version).toBe(otherUnit);
  });

  test('a write that fails changes no version', () => {
    const before = syncStateFor(12).version;

    runRequest({ url: '/api/v1/points', status: 400 });

    expect(syncStateFor(12).version).toBe(before);
  });

  test("the session that made the write learns the unit's new version", () => {
    const writer = openSession('Writer123', 'org-12');

    runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'Writer123' } });

    expect(writer.emit).toHaveBeenCalledWith('sync-state', syncStateFor(12));
  });

  test('a session of another unit named in the header hears nothing', () => {
    const stranger = openSession('Stranger99', 'org-13');

    runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'Stranger99' } });

    expect(stranger.emit).not.toHaveBeenCalled();
  });

  test('leaves out the session that made the write', () => {
    runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'AbC123_-xyz' } });

    expect(mockExcept).toHaveBeenCalledWith('AbC123_-xyz');
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  test('ignores a malformed connection id rather than passing it to Socket.IO', () => {
    runRequest({ url: '/api/v1/points', headers: { 'x-live-sync-client': 'not a socket id!' } });

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
  ])('says nothing about %s', (_label, request) => {
    runRequest(request);

    expect(mockEmit).not.toHaveBeenCalled();
  });

  test('a failed announcement never throws into the finished request', () => {
    mockTo.mockImplementation(() => {
      throw new Error('Socket.IO not initialized!');
    });

    expect(() => runRequest({ url: '/api/v1/points' })).not.toThrow();
  });
});

describe('writes that are not announced', () => {
  test('a public page\'s write moves the shared version, announcing nothing', () => {
    const before = syncStateFor(12).shared;

    runRequest({ url: '/api/v1/public/parent-invitations/accept', user: null });

    expect(syncStateFor(12).shared).toBe(before + 1);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test.each([
    '/api/v1/auth/login',
    '/api/v1/auth/verify-2fa',
    '/api/v1/auth/verify-session',
    '/api/v1/auth/logout',
    '/public/login',
    '/api/v1/public/contact-demo',
  ])('signing in and the like (%s) do not count', (url) => {
    const before = syncStateFor(12).shared;

    runRequest({ url, user: null });

    expect(syncStateFor(12).shared).toBe(before);
  });

  test('a failed public write does not count', () => {
    const before = syncStateFor(12).shared;

    runRequest({ url: '/api/v1/public/family-links/accept', user: null, status: 400 });

    expect(syncStateFor(12).shared).toBe(before);
  });

  test('another unit a write changed moves on, without being told what changed', () => {
    const destination = syncStateFor(31).version;
    const writer = syncStateFor(12).version;

    runRequest({ url: '/api/v1/transfers', locals: { liveSyncOrganizationIds: [31, 31, 12] } });

    expect(syncStateFor(31).version).toBe(destination + 1);
    expect(syncStateFor(12).version).toBe(writer + 1);
    expect(mockTo).toHaveBeenCalledTimes(1);
    expect(mockTo).toHaveBeenCalledWith('org-12');
  });
});

describe('announcedPath', () => {
  test('drops the query string and a trailing slash', () => {
    expect(announcedPath({ originalUrl: '/api/v1/groups/3/?x=1' })).toBe('/api/v1/groups/3');
  });
});
