/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/config.js', () => ({ CONFIG: { DEFAULT_LANG: 'fr', STORAGE_KEYS: {} }, getStorageKey: (key) => key }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: {} }));
jest.mock('../../spa/indexedDB.js', () => ({ getCachedData: jest.fn() }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugError: jest.fn() }));
import { CampPreparation, campPreparation } from '../../spa/modules/offline/CampPreparation.js';
import { renderCampReadiness, renderCampReadinessSummary, isCampReadinessDue } from '../../spa/modules/offline/CampReadiness.js';
import { getCachedData } from '../../spa/indexedDB.js';
import { buildScopedCacheKey } from '../../spa/utils/OfflineCacheKeys.js';

let manager;
let coordinator;
let checkAssets;
const CAMP = { id: 7, name: '<img src=x onerror=alert(1)>', activity_start_date: '2026-10-25', activity_end_date: '2026-10-27' };
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00'));
  localStorage.clear();
  localStorage.setItem('jwtToken', 'fictional');
  localStorage.setItem('userId', 'leader');
  localStorage.setItem('currentOrganizationId', '1');
  getCachedData.mockResolvedValue({ data: [] });
  manager = {
    preparedActivities: new Map(),
    getUpcomingCamps: jest.fn().mockResolvedValue([CAMP]),
    restoreCampMode: jest.fn(), autoDetectCampMode: jest.fn(),
    prepareForActivity: jest.fn((id, startDate, endDate) => {
      manager.preparedActivities.set(id, { scope: buildScopedCacheKey(''), cacheKeys: ['participants'], preparedAt: Date.now(), startDate, endDate });
      return Promise.resolve();
    }),
  };
  checkAssets = jest.fn().mockResolvedValue(true);
  coordinator = new CampPreparation(manager, checkAssets);
  coordinator.allowed = () => true;
});
afterEach(() => { coordinator.stop(); jest.useRealTimers(); });

test('opening the app prepares nearby camps automatically and skips camps further away', async () => {
  manager.getUpcomingCamps.mockResolvedValue([CAMP, { ...CAMP, id: 9, activity_start_date: '2026-11-10' }]);
  await coordinator.refresh();
  expect(manager.prepareForActivity).toHaveBeenCalledTimes(1);
  expect(manager.prepareForActivity).toHaveBeenCalledWith(7, '2026-10-25', '2026-10-27');
  expect(coordinator.getStatus(7).status).toBe('ready');
  await coordinator.refresh();
  expect(manager.prepareForActivity).toHaveBeenCalledTimes(1);
});

test('a worker or reconnection event during preparation is checked again as soon as the first pass ends', async () => {
  checkAssets.mockResolvedValueOnce(false).mockResolvedValue(true);
  const first = coordinator.refresh();
  coordinator.onWake();
  await first;
  await coordinator.task;
  expect(manager.prepareForActivity).toHaveBeenCalledTimes(1);
  expect(coordinator.getStatus(7).status).toBe('ready');
});

test('family-only accounts do not download the unit records', async () => {
  coordinator.allowed = () => false;
  await coordinator.refresh();
  expect(manager.getUpcomingCamps).not.toHaveBeenCalled();
});

test('a stored flag without verifiable data and screens never claims readiness', async () => {
  coordinator.ensureScope();
  manager.preparedActivities.set(7, { preparedAt: Date.now() });
  expect(await coordinator.verify(7)).toBe(false);
  await coordinator.prepare(7, CAMP.activity_start_date, CAMP.activity_end_date);
  checkAssets.mockResolvedValue(false);
  expect(await coordinator.verify(7)).toBe(false);
  expect(coordinator.getStatus(7).status).toBe('incomplete');
  checkAssets.mockResolvedValue(true);
  getCachedData.mockResolvedValue(null);
  expect(await coordinator.verify(7)).toBe(false);
});

test('missing screens do not cause fresh data to download again every minute', async () => {
  checkAssets.mockResolvedValue(false);
  await coordinator.refresh();
  jest.advanceTimersByTime(60000);
  await coordinator.refresh();
  expect(manager.prepareForActivity).toHaveBeenCalledTimes(1);
  expect(coordinator.getStatus(7).status).toBe('incomplete');
});

test('the manual availability check works offline using the existing snapshot', async () => {
  await coordinator.refresh();
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  try {
    expect(await coordinator.prepare(7, CAMP.activity_start_date, CAMP.activity_end_date)).toBe(true);
    expect(manager.prepareForActivity).toHaveBeenCalledTimes(1);
  } finally { delete navigator.onLine; }
});

test('a refused preparation is retried and never appears ready', async () => {
  manager.prepareForActivity.mockRejectedValueOnce(new Error('offline'));
  await coordinator.refresh();
  expect(coordinator.getStatus(7).status).toBe('incomplete');
  await coordinator.refresh();
  expect(coordinator.getStatus(7).status).toBe('ready');
});

test('switching units immediately hides the previous unit readiness', async () => {
  await coordinator.refresh();
  localStorage.setItem('currentOrganizationId', '2');
  expect(coordinator.getStatus(7).status).toBe('incomplete');
  coordinator.ensureScope();
  expect(await coordinator.verify(7)).toBe(false);
});

test('a delayed check cannot mark another account ready', async () => {
  await coordinator.refresh();
  let answer;
  checkAssets.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  const checking = coordinator.verify(7);
  await Promise.resolve();
  await Promise.resolve();
  localStorage.setItem('currentOrganizationId', '2');
  answer(true);
  expect(await checking).toBe(false);
  expect(coordinator.getStatus(7).status).toBe('incomplete');
});

test('the shared device status is escaped and accessible with a route to verify it', async () => {
  jest.useRealTimers();
  const previous = { states: campPreparation.states, scope: campPreparation.scope, allowed: campPreparation.allowed, activities: campPreparation.activities };
  Object.assign(campPreparation, { states: new Map([['7', { status: 'ready', preparedAt: Date.now() }]]), scope: buildScopedCacheKey(''), allowed: () => true, activities: [CAMP] });
  document.body.innerHTML = `<main>${renderCampReadinessSummary('fr', new Date('2026-10-25T08:00:00'))}${renderCampReadiness(7, 'fr')}</main>`;
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('a').getAttribute('href')).toBe('/prepare-offline');
  expect(document.body.textContent).toContain('camp_device_ready');
  expect((await axe.run(document.querySelector('main'), { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
  Object.assign(campPreparation, previous);
});

test('the dashboard speaks of a camp from a day before it starts until it ends', () => {
  const camp = { ...CAMP, activity_start_time: '18:00:00', activity_end_time: '15:00:00' };
  expect(isCampReadinessDue(camp, new Date('2026-10-24T17:59:00'))).toBe(false);
  expect(isCampReadinessDue(camp, new Date('2026-10-24T18:00:00'))).toBe(true);
  expect(isCampReadinessDue(camp, new Date('2026-10-26T12:00:00'))).toBe(true);
  expect(isCampReadinessDue(camp, new Date('2026-10-27T15:00:00'))).toBe(true);
  expect(isCampReadinessDue(camp, new Date('2026-10-27T15:01:00'))).toBe(false);
});

test('without times, a camp counts from midnight the day before until the end of its last day', () => {
  expect(isCampReadinessDue(CAMP, new Date('2026-10-23T23:59:00'))).toBe(false);
  expect(isCampReadinessDue(CAMP, new Date('2026-10-24T00:00:00'))).toBe(true);
  expect(isCampReadinessDue(CAMP, new Date('2026-10-27T23:00:00'))).toBe(true);
  expect(isCampReadinessDue(CAMP, new Date('2026-10-28T00:00:00'))).toBe(false);
});

test('a camp still days away is prepared in the background but not shown on the dashboard', () => {
  const previous = { states: campPreparation.states, allowed: campPreparation.allowed, activities: campPreparation.activities };
  Object.assign(campPreparation, { states: new Map(), allowed: () => true, activities: [CAMP] });
  expect(renderCampReadinessSummary('fr', new Date('2026-10-22T12:00:00'))).toBe('');
  expect(renderCampReadinessSummary('fr', new Date('2026-10-24T12:00:00'))).toContain('camp_device_title');
  Object.assign(campPreparation, previous);
});
