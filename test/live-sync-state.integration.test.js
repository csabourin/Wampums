/**
 * Live-sync change counters in PostgreSQL, shared by every server instance.
 * Skips without TEST_DATABASE_URL.
 */
const { Pool } = require('pg');
const { recordChange, recordSharedChange, syncStateFor } = require('../services/liveSyncState');

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
/** Unit ids no seeded unit uses. */
const UNIT = 2000000001;
const OTHER_UNIT = 2000000002;
const CONCURRENT_WRITES = 25;

describeWithDatabase('live-sync counters', () => {
  let pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM live_sync_versions WHERE organization_id = ANY($1::int[])', [[UNIT, OTHER_UNIT]]);
    await pool.end();
  });

  test('changes counted at the same time, as several instances would, each get their own version', async () => {
    const before = (await syncStateFor(pool, UNIT)).version;

    const versions = await Promise.all(Array.from({ length: CONCURRENT_WRITES }, () => recordChange(pool, UNIT)));

    expect(new Set(versions).size).toBe(CONCURRENT_WRITES);
    expect((await syncStateFor(pool, UNIT)).version).toBe(before + CONCURRENT_WRITES);
  });

  test('a unit\'s count does not move another\'s, while the shared count is seen by both', async () => {
    const other = await syncStateFor(pool, OTHER_UNIT);

    await recordChange(pool, UNIT);
    await recordSharedChange(pool);

    const after = await syncStateFor(pool, OTHER_UNIT);
    expect(after.version).toBe(other.version);
    expect(after.shared).toBe(other.shared + 1);
    expect((await syncStateFor(pool, UNIT)).shared).toBe(after.shared);
  });
});
