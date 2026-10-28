/** @jest-environment jsdom */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: { API_BASE_URL: 'http://localhost', CACHE_DURATION: { SHORT: 60000, MEDIUM: 300000 }, UI: {} }, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/modules/offline/OfflineAssets.js', () => ({ verifyOfflineAssets: jest.fn() }));
import { OfflineManager } from '../../spa/modules/OfflineManager.js';
import { setCachedData, getOfflineData } from '../../spa/indexedDB.js';
import { storeLotSnapshot, getLotSnapshot, lotSnapshotKey, pendingLotChanges, overlayLotChanges } from '../../spa/modules/camp-lots/CampLotOffline.js';
import { verifyOfflineAssets } from '../../spa/modules/offline/OfflineAssets.js';
import { changeCampLotStatus, getCampLots } from '../../spa/api/api-camp-lots.js';
const URL = 'http://localhost/api/v1/camp-equipment-lots/mine/3/status';
const ID = '00000000-0000-4000-8000-000000000003';
const LOT = { id: 3, meeting_id: 7, version: 1, status: 'to_prepare', items: [], roles: [], history: [] };
const payload = (extra = {}) => ({ meeting_id: 7, expected_version: 1, status: 'loaded', mutation_id: ID, ...extra });
const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: () => Promise.resolve(data) });
let manager;
beforeEach(() => {
  jest.clearAllMocks(); global.indexedDB = new IDBFactory();
  localStorage.clear(); localStorage.setItem('userId', 'fictional-helper'); localStorage.setItem('currentOrganizationId', '1'); localStorage.setItem('jwtToken', 'fictional-token');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  crypto.randomUUID ||= () => ID;
  verifyOfflineAssets.mockResolvedValue(true);
  global.fetch = jest.fn(); manager = new OfflineManager();
});
afterEach(() => delete navigator.onLine);
const queue = (data = payload()) => manager.queueMutation(URL, { method: 'PATCH', headers: { 'Idempotency-Key': data.mutation_id }, body: JSON.stringify(data) });

test('an unprepared camp refuses offline changes and stores nothing', async () => {
  await expect(queue()).rejects.toMatchObject({ code: 'camp_lot_not_prepared' });
  expect(await getOfflineData()).toEqual([]);
});
test('cached data without a verified schema and scope is not preparation', async () => {
  await setCachedData(lotSnapshotKey(7, true), { lots: [LOT], ready: true });
  await expect(queue()).rejects.toMatchObject({ code: 'camp_lot_not_prepared' });
});
test('a prepared lot can be changed offline without storing authentication tokens', async () => {
  await storeLotSnapshot(7, [LOT], true); await queue();
  const records = await getOfflineData(); expect(records).toHaveLength(1);
  expect(records[0].data.headers.Authorization).toBeUndefined();
  expect(overlayLotChanges([LOT], await pendingLotChanges())[0]).toMatchObject({ status: 'loaded', version: 2, pending: true });
  expect(await getCampLots(7, true)).toMatchObject({ data: [LOT] });
  expect(global.fetch).not.toHaveBeenCalled();
});
test('a missing offline shell prevents queueing even when lot data exists', async () => {
  await storeLotSnapshot(7, [LOT], true); verifyOfflineAssets.mockResolvedValue(false);
  await expect(queue()).rejects.toMatchObject({ code: 'camp_lot_not_prepared' });
});
test('preparation and pending progress never cross an account or unit change', async () => {
  await storeLotSnapshot(7, [LOT], true); await queue();
  localStorage.setItem('currentOrganizationId', '2');
  expect(await getLotSnapshot(7, true)).toBeNull(); expect(await pendingLotChanges()).toEqual([]);
  await expect(queue()).rejects.toMatchObject({ code: 'camp_lot_not_prepared' });
});
test('a refused replay clears only that camp snapshot and announces the refusal', async () => {
  await storeLotSnapshot(7, [LOT], true); await storeLotSnapshot(70, [{ ...LOT, id: 30, meeting_id: 70 }], true);
  await queue(); global.fetch.mockResolvedValue(jsonResponse({ success: false }, 409));
  const events = []; const handler = (event) => events.push(event.detail); window.addEventListener('offlineMutationRejected', handler);
  const outcome = await manager.replayPendingMutations(); window.removeEventListener('offlineMutationRejected', handler);
  expect(outcome.rejected).toEqual([expect.objectContaining({ kind: 'camp_lots', status: 409 })]);
  expect(events).toHaveLength(1); expect(await getLotSnapshot(7, true)).toBeNull(); expect(await getLotSnapshot(70, true)).not.toBeNull();
});
test('a replay updates the prepared copy even when the screen is closed', async () => {
  await storeLotSnapshot(7, [LOT], true); await queue();
  global.fetch.mockResolvedValue(jsonResponse({ success: true, data: { ...LOT, status: 'loaded', version: 2 } }));
  expect((await manager.replayPendingMutations()).replayed).toBe(1);
  expect((await getLotSnapshot(7, true)).lots[0]).toMatchObject({ status: 'loaded', version: 2 });
  expect(await getOfflineData()).toEqual([]);
});
test('a temporary server failure preserves the change and its original receipt id', async () => {
  await storeLotSnapshot(7, [LOT], true); await queue();
  global.fetch.mockResolvedValue(jsonResponse({ success: false }, 503));
  expect((await manager.replayPendingMutations()).replayed).toBe(0);
  expect(await getOfflineData()).toHaveLength(1);
  expect(global.fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(ID);
});
test('the API preserves a mutation id across a network-error fallback to the outbox', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  await storeLotSnapshot(7, [LOT], true);
  global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
  const result = await changeCampLotStatus(LOT, 'loaded', true);
  expect(result).toMatchObject({ queued: true, mutationId: expect.any(String) });
  const body = JSON.parse((await getOfflineData())[0].data.body);
  expect(body.mutation_id).toBe(result.mutationId); expect(global.fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(result.mutationId);
});
test('successive offline changes carry their preceding receipt so a rejected change cannot be bypassed', async () => {
  await storeLotSnapshot(7, [LOT], true); await queue();
  const projected = overlayLotChanges([LOT], await pendingLotChanges())[0];
  await changeCampLotStatus(projected, 'returned', true);
  const records = await getOfflineData(); const second = JSON.parse(records[1].data.body);
  expect(second).toMatchObject({ expected_version: 2, previous_mutation_id: ID, status: 'returned' });
});
test('a replayed old receipt cannot replace a newer prepared version', async () => {
  await storeLotSnapshot(7, [LOT], true); await queue();
  await storeLotSnapshot(7, [{ ...LOT, status: 'returned', version: 3 }], true);
  global.fetch.mockResolvedValue(jsonResponse({ success: true, data: { ...LOT, status: 'loaded', version: 2 } }));
  await manager.replayPendingMutations();
  expect((await getLotSnapshot(7, true)).lots[0].version).toBe(3);
});
