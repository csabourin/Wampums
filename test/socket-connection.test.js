/**
 * What a session hears as soon as it connects to its unit's change feed.
 */
const mockHandlers = {};
/** Every room broadcast: [room, event, payload]. */
const mockBroadcasts = [];
/** Membership the authorization engine reports, by user id. */
const mockMemberships = new Map();

jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => ({
    use: jest.fn(),
    on: (event, handler) => {
      mockHandlers[event] = handler;
    },
    to: (room) => ({ emit: (event, payload) => mockBroadcasts.push([room, event, payload]) }),
  })),
}));
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  loadMembership: jest.fn((userId) => Promise.resolve(mockMemberships.get(userId) || { active: false, permissions: [] })),
}));

const socketService = require('../services/socket');
const presence = require('../services/onlinePresence');

const mockPool = {
  query: jest.fn(() => Promise.resolve({ rows: [{ organization_id: 77, version: '4' }, { organization_id: 0, version: 2 }] })),
};

/**
 * @param {Object} overrides - Fields of the authenticated socket
 * @returns {Object} A connected socket
 */
function connectSocket(overrides) {
  const listeners = {};
  const socket = {
    id: 'S1', join: jest.fn(), emit: jest.fn(),
    on: jest.fn((event, handler) => { listeners[event] = handler; }),
    disconnect: () => listeners.disconnect?.(),
    ...overrides,
  };
  mockHandlers.connection(socket);
  return socket;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeAll(() => {
  socketService.init({}, mockPool);
});

beforeEach(() => {
  presence.reset();
  mockMemberships.clear();
  mockBroadcasts.length = 0;
});

test('a session joins its unit and is told the unit\'s current state, marked as the connection\'s', async () => {
  const socket = connectSocket({ userId: 'u-1', organizationId: 77 });
  await flush();

  expect(socket.join).toHaveBeenCalledWith('org-77');
  expect(socket.emit).toHaveBeenCalledWith('sync-state', { org: '77', version: 4, shared: 2, connection: true });
});

test('a session with no unit joins nothing and is told nothing', async () => {
  const socket = connectSocket({ userId: 'u-2', organizationId: undefined });
  await flush();

  expect(socket.join).not.toHaveBeenCalled();
  expect(socket.emit).not.toHaveBeenCalled();
});

test('a state the database cannot give is not sent: the session catches up on its own', async () => {
  mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

  const socket = connectSocket({ userId: 'u-3', organizationId: 77 });
  await flush();

  expect(socket.join).toHaveBeenCalledWith('org-77');
  expect(socket.emit).not.toHaveBeenCalled();
});

describe('accounts online', () => {
  const ADMIN = { active: true, permissions: ['users.view_online'] };
  const LEADER = { active: true, permissions: ['participants.view'] };
  const countsTo = (socket) => socket.emit.mock.calls.filter(([event]) => event === 'online-count').map(([, p]) => p.count);

  test('an administrator is told how many accounts of the unit are online, counting each account once', async () => {
    mockMemberships.set('admin', ADMIN);
    mockMemberships.set('leader', LEADER);
    connectSocket({ userId: 'leader', organizationId: 77 });
    connectSocket({ userId: 'leader', organizationId: 77 });
    await flush();

    const admin = connectSocket({ userId: 'admin', organizationId: 77 });
    await flush();

    expect(admin.join).toHaveBeenCalledWith('org-77-online');
    expect(countsTo(admin)).toEqual([2]);
  });

  test('administrators hear the count change as accounts come and go, and only theirs', async () => {
    mockMemberships.set('admin', ADMIN);
    mockMemberships.set('leader', LEADER);
    connectSocket({ userId: 'admin', organizationId: 77 });
    connectSocket({ userId: 'admin', organizationId: 12 });
    await flush();
    mockBroadcasts.length = 0;

    const first = connectSocket({ userId: 'leader', organizationId: 77 });
    const second = connectSocket({ userId: 'leader', organizationId: 77 });
    await flush();
    expect(mockBroadcasts).toEqual([['org-77-online', 'online-count', { count: 2 }]]);

    // A second tab closing leaves the account online.
    first.disconnect();
    expect(mockBroadcasts).toHaveLength(1);
    second.disconnect();
    expect(mockBroadcasts[1]).toEqual(['org-77-online', 'online-count', { count: 1 }]);
  });

  test('without the permission, a connection is counted but never told the count', async () => {
    mockMemberships.set('leader', LEADER);
    const leader = connectSocket({ userId: 'leader', organizationId: 77 });
    await flush();

    expect(leader.join).not.toHaveBeenCalledWith('org-77-online');
    expect(countsTo(leader)).toEqual([]);
    expect(presence.onlineCount(77)).toBe(1);
  });

  test('a token for a unit the account no longer belongs to is not counted', async () => {
    connectSocket({ userId: 'gone', organizationId: 77 });
    await flush();

    expect(presence.onlineCount(77)).toBe(0);
    expect(mockBroadcasts).toEqual([]);
  });

  test('a connection closed before its membership was read is not counted', async () => {
    mockMemberships.set('leader', LEADER);
    const socket = connectSocket({ userId: 'leader', organizationId: 77 });
    socket.disconnect();
    await flush();

    expect(presence.onlineCount(77)).toBe(0);
  });
});
