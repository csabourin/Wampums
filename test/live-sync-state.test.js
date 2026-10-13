/**
 * What a reconnecting session compares to tell whether it missed a change.
 */
const { recordChange, syncStateFor } = require('../services/liveSyncState');

describe('live sync state', () => {
  test('a unit nobody changed is at version 0', () => {
    expect(syncStateFor(901)).toEqual({ run: expect.any(String), org: '901', version: 0 });
  });

  test('each change moves only its own unit forward', () => {
    recordChange(902);
    recordChange(902);
    recordChange(903);

    expect(syncStateFor(902).version).toBe(2);
    expect(syncStateFor(903).version).toBe(1);
  });

  test('names this server run, so a restarted server is told apart', () => {
    expect(syncStateFor(902).run).toBe(syncStateFor(903).run);
    expect(syncStateFor(902).run).toMatch(/^[0-9a-f-]{36}$/);
  });
});
