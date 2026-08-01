/** @jest-environment jsdom */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  debugError: jest.fn()
}));

import { OptimisticUpdateManager } from '../../spa/utils/OptimisticUpdateManager.js';

test('does not roll back a successful server mutation when local reconciliation fails', async () => {
  const manager = new OptimisticUpdateManager();
  const rollbackFn = jest.fn();
  const onError = jest.fn();
  const onCommitError = jest.fn();
  const serverResult = { id: 42 };

  await expect(manager.execute('save-42', {
    optimisticFn: () => ({ previous: 'old' }),
    apiFn: async () => serverResult,
    successFn: async () => { throw new Error('IndexedDB unavailable'); },
    rollbackFn,
    onError,
    onCommitError
  })).resolves.toBe(serverResult);

  expect(rollbackFn).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(onCommitError).toHaveBeenCalledWith(expect.any(Error), serverResult);
  expect(manager.getHistory()[0]).toMatchObject({
    success: true,
    localSyncError: 'IndexedDB unavailable'
  });
});

test('still rolls back when the API mutation itself fails', async () => {
  const manager = new OptimisticUpdateManager();
  const rollbackFn = jest.fn();
  const apiError = new Error('network failure');

  await expect(manager.execute('save-43', {
    optimisticFn: () => ({ previous: 'old' }),
    apiFn: async () => { throw apiError; },
    rollbackFn
  })).rejects.toThrow('network failure');

  expect(rollbackFn).toHaveBeenCalledWith({ previous: 'old' }, apiError);
});
