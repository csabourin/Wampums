/** @jest-environment jsdom */
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn() }));

const { noteOfflineRead, listOfflineReads } = require('../../spa/utils/OfflineReadRegistry.js');
const { OFFLINE_READS, isNetworkOnlyRead } = require('../../spa/config/offline-reads.js');

const SCOPE = '|scope:user:leader-1|org:1';
const NOW = 1_800_000_000_000;

beforeEach(() => localStorage.clear());

test('a read made on any screen is remembered once, most recent first, per account and unit', () => {
  noteOfflineRead(SCOPE, { endpoint: 'v1/carpools/activity/9', cacheKey: 'v1/carpools/activity/9' }, NOW);
  noteOfflineRead(SCOPE, { endpoint: 'v1/menus', params: { camp: 7 }, cacheKey: 'v1/menus?camp=7' }, NOW + 1);
  noteOfflineRead(SCOPE, { endpoint: 'v1/carpools/activity/9', cacheKey: 'v1/carpools/activity/9' }, NOW + 2);

  expect(listOfflineReads(SCOPE, NOW + 3).map((entry) => entry.cacheKey))
    .toEqual(['v1/carpools/activity/9', 'v1/menus?camp=7']);
  expect(listOfflineReads('|scope:user:parent-2|org:1', NOW + 3)).toEqual([]);
});

test('a screen not used within the offline retention is forgotten, and the list stays bounded', () => {
  noteOfflineRead(SCOPE, { endpoint: 'v1/old', cacheKey: 'v1/old' }, NOW);
  expect(listOfflineReads(SCOPE, NOW + OFFLINE_READS.RETENTION_MS)).toEqual([]);

  for (let index = 0; index < OFFLINE_READS.REGISTRY_MAX_ENTRIES + 10; index += 1) {
    noteOfflineRead(SCOPE, { endpoint: `v1/r${index}`, cacheKey: `v1/r${index}` }, NOW + index);
  }
  const kept = listOfflineReads(SCOPE, NOW + 1000);
  expect(kept).toHaveLength(OFFLINE_READS.REGISTRY_MAX_ENTRIES);
  expect(kept[0].cacheKey).toBe(`v1/r${OFFLINE_READS.REGISTRY_MAX_ENTRIES + 9}`);
});

test('online-only editors and secrets are never kept; contacts, allergies and health are, for camp without signal', () => {
  ['v1/camp-plans/camps/3/versions', 'v1/calendar-feed', 'v1/roles/matrix', '/api/v1/parent-invitations?kind=family',
    'v1/users/me/access']
    .forEach((endpoint) => expect([endpoint, isNetworkOnlyRead(endpoint)]).toEqual([endpoint, true]));
  ['v1/points', 'v1/dashboards/parent', 'v1/messages', 'v1/camp-plans/camps/3', 'v1/volunteer-space/camps/4/contacts',
    'v1/camp-rosters/12', 'v1/member-profile/me/health', 'v1/member-allergies/me', 'v1/reports/allergies',
    'v1/carpools/activity/9']
    .forEach((endpoint) => expect([endpoint, isNetworkOnlyRead(endpoint)]).toEqual([endpoint, false]));
});
