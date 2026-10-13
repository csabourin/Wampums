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
const { recordChange, syncStateFor } = require('../services/liveSyncState');

/**
 * @param {Object} overrides - Fields of the authenticated socket
 * @returns {Object} A connected socket
 */
function connectSocket(overrides) {
  const socket = { id: 'S1', join: jest.fn(), emit: jest.fn(), on: jest.fn(), ...overrides };
  mockHandlers.connection(socket);
  return socket;
}

beforeAll(() => {
  socketService.init({});
});

test("a session joins its unit and is told the unit's current version", () => {
  recordChange(77);

  const socket = connectSocket({ userId: 'u-1', organizationId: 77 });

  expect(socket.join).toHaveBeenCalledWith('org-77');
  expect(socket.emit).toHaveBeenCalledWith('sync-state', syncStateFor(77));
  expect(syncStateFor(77).version).toBe(1);
});

test('a session with no unit joins nothing and is told nothing', () => {
  const socket = connectSocket({ userId: 'u-2', organizationId: undefined });

  expect(socket.join).not.toHaveBeenCalled();
  expect(socket.emit).not.toHaveBeenCalled();
});
