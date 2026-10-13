/**
 * What a session hears as soon as it connects to its unit's change feed.
 */
const mockHandlers = {};

jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => ({
    use: jest.fn(),
    on: (event, handler) => {
      mockHandlers[event] = handler;
    },
  })),
}));
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const socketService = require('../services/socket');

const mockPool = {
  query: jest.fn(() => Promise.resolve({ rows: [{ organization_id: 77, version: '4' }, { organization_id: 0, version: 2 }] })),
};

/**
 * @param {Object} overrides - Fields of the authenticated socket
 * @returns {Object} A connected socket
 */
function connectSocket(overrides) {
  const socket = { id: 'S1', join: jest.fn(), emit: jest.fn(), on: jest.fn(), ...overrides };
  mockHandlers.connection(socket);
  return socket;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeAll(() => {
  socketService.init({}, mockPool);
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
