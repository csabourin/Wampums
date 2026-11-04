/**
 * @jest-environment jsdom
 *
 * A camp's site and emergency numbers kept on this device (#1327): stored
 * without the members a manager chooses from, read back only for the same camp
 * in the same account and unit, and cleared by any confirmed write to the camp
 * sites, so a stale emergency number is never kept after an edit.
 */

import 'fake-indexeddb/auto';

let mockUserId = 'user-1';
let mockOrganizationId = 12;
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/api/api-helpers.js', () => ({
  getCurrentOrganizationId: () => mockOrganizationId,
  getCurrentUserId: () => mockUserId,
  getAuthHeader: () => ({ Authorization: 'Bearer test' }),
}));
jest.mock('../../spa/modules/scout-year/ScoutYearContext.js', () => ({
  getSelectedScoutYearId: () => null,
}));

import { storeCampSiteSnapshot, getCampSiteSnapshot } from '../../spa/modules/camp-sites/CampSiteOffline.js';
import { invalidateForWrite } from '../../spa/utils/CacheInvalidation.js';

const CAMP_SITE = {
  camp: { id: 41, theme: 'Camp d’automne', date_from: '2026-11-01', date_to: '2026-11-03', is_cancelled: false },
  details: { camp_site_id: 4, contact_phone: '555-0123', on_site_lead_name: 'Ada Lovelace', version: 2 },
  site: { id: 4, name: 'Fictional Lake Camp', hospital_phone: '555-0199', poison_centre_phone: '1-800-463-5060' },
  gaps: [],
  members: [{ id: 'u-1', full_name: 'Léa Tremblay' }],
};

beforeEach(() => {
  mockUserId = 'user-1';
  mockOrganizationId = 12;
});

test('the copy keeps the site and its emergency numbers, never the members a manager chooses from', async () => {
  await storeCampSiteSnapshot(41, CAMP_SITE);

  const snapshot = await getCampSiteSnapshot(41);

  expect(snapshot.data.site.hospital_phone).toBe('555-0199');
  expect(snapshot.data.details.contact_phone).toBe('555-0123');
  expect(snapshot.data.members).toBeUndefined();
  expect(typeof snapshot.preparedAt).toBe('number');
});

test('the copy is only read back for the same camp, account and unit', async () => {
  await storeCampSiteSnapshot(41, CAMP_SITE);

  expect(await getCampSiteSnapshot(42)).toBeNull();
  mockUserId = 'user-2';
  expect(await getCampSiteSnapshot(41)).toBeNull();
  mockUserId = 'user-1';
  mockOrganizationId = 13;
  expect(await getCampSiteSnapshot(41)).toBeNull();
});

test('an expired copy is not shown', async () => {
  await storeCampSiteSnapshot(41, CAMP_SITE, -1);
  expect(await getCampSiteSnapshot(41)).toBeNull();
});

test('a confirmed change to the camp sites clears the copy, so a stale number is never kept', async () => {
  await storeCampSiteSnapshot(41, CAMP_SITE);

  await invalidateForWrite('v1/camp-sites/camps/41');

  expect(await getCampSiteSnapshot(41)).toBeNull();
});
