/** @jest-environment jsdom */
require('fake-indexeddb/auto');
const { IDBFactory } = require('fake-indexeddb');

const MS_PER_DAY = 86400000;
jest.mock('../../spa/config.js', () => ({ CONFIG: {} }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugWarn: jest.fn(), debugError: jest.fn() }));

const {
  setCachedData,
  getCachedData,
  getCachedDataIgnoreExpiration,
  pruneOfflineCache,
  saveOfflineData,
  getOfflineData,
} = require('../../spa/indexedDB.js');

const NOW = new Date('2026-11-14T12:00:00Z').getTime();
const THIRTY_MINUTES = 30 * 60 * 1000;

beforeEach(() => {
  global.indexedDB = new IDBFactory();
  localStorage.clear();
  localStorage.setItem('userId', 'leader-1');
  localStorage.setItem('currentOrganizationId', '1');
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'setImmediate', 'queueMicrotask', 'nextTick'] });
});

afterEach(() => {
  jest.useRealTimers();
});

const nextMeeting = { success: true, data: { date: '2026-11-18', notes: 'Ada Lovelace brings the canoe' } };

test('after three days without a connection, the next meeting saved before leaving is still readable', async () => {
  await setCachedData('v1/meetings/next', nextMeeting, THIRTY_MINUTES);
  jest.setSystemTime(NOW + 3 * MS_PER_DAY);

  // The ordinary read finds it stale, as before...
  expect(await getCachedData('v1/meetings/next')).toBeNull();
  // ...but no longer deletes it, so the fallback after the failed fetch finds it.
  expect(await getCachedDataIgnoreExpiration('v1/meetings/next')).toEqual(nextMeeting);
});

test('a copy is no longer shown offline fourteen days after the server confirmed it', async () => {
  await setCachedData('v1/reports/parent-contact-list', { success: true, data: [] }, MS_PER_DAY);
  jest.setSystemTime(NOW + 14 * MS_PER_DAY + 1);

  expect(await getCachedDataIgnoreExpiration('v1/reports/parent-contact-list')).toBeNull();
});

test('a copy kept longer on purpose (camp mode) stays until its own expiry', async () => {
  await setCachedData('v1/attendance?date=2026-11-20', { success: true }, 20 * MS_PER_DAY);
  jest.setSystemTime(NOW + 15 * MS_PER_DAY);

  expect(await getCachedDataIgnoreExpiration('v1/attendance?date=2026-11-20')).toEqual({ success: true });
});

test('pruning removes copies past retention and never touches queued changes', async () => {
  await setCachedData('old', { success: true }, THIRTY_MINUTES);
  await saveOfflineData('points', { participant_id: 1, value: 5 });
  jest.setSystemTime(NOW + 3 * MS_PER_DAY);
  await setCachedData('recent', { success: true }, THIRTY_MINUTES);
  jest.setSystemTime(NOW + 15 * MS_PER_DAY);

  expect(await pruneOfflineCache()).toBe(1);
  expect(await getCachedDataIgnoreExpiration('old')).toBeNull();
  expect(await getCachedDataIgnoreExpiration('recent')).toEqual({ success: true });
  expect(await getOfflineData()).toHaveLength(1);
});
