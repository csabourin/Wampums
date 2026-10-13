/**
 * What a reconnecting session compares to tell whether it missed a change.
 * The counting itself runs against PostgreSQL in live-sync-state.integration.test.js.
 */
const { recordChange, recordSharedChange, syncStateFor } = require('../services/liveSyncState');

test('a unit nobody changed is at version 0, as is the shared row', async () => {
  const pool = { query: jest.fn(() => Promise.resolve(({ rows: [] }))) };

  await expect(syncStateFor(pool, 901)).resolves.toEqual({ org: '901', version: 0, shared: 0 });
  expect(pool.query.mock.calls[0][1]).toEqual([[901, 0]]);
});

test('versions read back as numbers, whatever the driver returns', async () => {
  const pool = { query: jest.fn(() => Promise.resolve(({ rows: [{ organization_id: '902', version: '7' }, { organization_id: 0, version: '3' }] }))) };

  await expect(syncStateFor(pool, '902')).resolves.toEqual({ org: '902', version: 7, shared: 3 });
});

test('a change is counted in its unit\'s row, a shared one in row 0', async () => {
  const pool = { query: jest.fn(() => Promise.resolve(({ rows: [{ version: 1 }] }))) };

  await recordChange(pool, '903');
  await recordSharedChange(pool);

  expect(pool.query.mock.calls.map(([, params]) => params)).toEqual([[903], [0]]);
});
