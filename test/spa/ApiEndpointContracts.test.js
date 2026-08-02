/**
 * @jest-environment jsdom
 */

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockApiPut = jest.fn();
const mockHandleResponse = jest.fn();

jest.mock('../../spa/api/api-core.js', () => ({
  API: {
    get: (...args) => mockApiGet(...args),
    getNoCache: jest.fn(),
    post: (...args) => mockApiPost(...args),
    put: (...args) => mockApiPut(...args),
    patch: jest.fn(),
    delete: jest.fn(),
  },
  handleResponse: (...args) => mockHandleResponse(...args),
  makeApiRequest: jest.fn(),
  makeApiRequestWithCache: jest.fn(),
  buildApiUrl: jest.fn(),
  batchApiRequests: jest.fn(),
  withErrorHandling: jest.fn(),
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    API_BASE_URL: 'http://localhost:5173',
    CACHE_DURATION: { SHORT: 1, MEDIUM: 2, LONG: 3 }
  },
}));

jest.mock('../../spa/api/api-helpers.js', () => ({
  fetchPublic: jest.fn(),
  getCurrentOrganizationId: jest.fn(() => 3),
  getAuthHeader: jest.fn(() => ({})),
  checkLoginStatus: jest.fn(),
  validateCurrentToken: jest.fn(),
  buildPublicUrl: jest.fn(),
}));

jest.mock('../../spa/indexedDB.js', () => ({
  clearGroupRelatedCaches: jest.fn(),
  clearBudgetCaches: jest.fn(),
  clearFinanceRelatedCaches: jest.fn(),
  clearExternalRevenueCaches: jest.fn(),
  clearFundraiserRelatedCaches: jest.fn(),
  clearBadgeRelatedCaches: jest.fn(),
  clearPointsRelatedCaches: jest.fn(),
  clearAttendanceRelatedCaches: jest.fn(),
  deleteCachedData: jest.fn(),
}));

jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({
  buildApiCacheKey: jest.fn((key) => key),
}));

import {
  approveUser,
  archiveFundraiser,
  getCalendarsForFundraiser,
  getFundraiser,
  getUserOrganizations,
  register as registerAccount,
  updateCalendarEntry,
  updateFundraiser,
} from '../../spa/ajax-functions.js';

beforeEach(() => {
  jest.clearAllMocks();
});

test('fundraiser lifecycle helpers use the registered REST routes and payloads', async () => {
  const editedFields = { name: 'Fall campaign', objective: 2500 };
  const entryFields = { amount: 12, paid: true };

  await getFundraiser(41);
  await updateFundraiser(41, editedFields);
  await archiveFundraiser(41, true);
  await archiveFundraiser(41, false);
  await getCalendarsForFundraiser(41);
  await updateCalendarEntry(93, entryFields);

  expect(mockApiGet).toHaveBeenCalledWith('v1/fundraisers/41');
  expect(mockApiPut).toHaveBeenCalledWith('v1/fundraisers/41', editedFields);
  expect(mockApiPut).toHaveBeenCalledWith('v1/fundraisers/41/archive', { archived: true });
  expect(mockApiPut).toHaveBeenCalledWith('v1/fundraisers/41/archive', { archived: false });
  expect(mockApiGet).toHaveBeenCalledWith('v1/calendars', { fundraiser_id: 41 });
  expect(mockApiPut).toHaveBeenCalledWith('v1/calendars/93', entryFields);
});

test('Admin approval helper targets the mounted users resource', async () => {
  await approveUser('550e8400-e29b-41d4-a716-446655440000');

  expect(mockApiPost).toHaveBeenCalledWith('v1/users/approve', {
    user_id: '550e8400-e29b-41d4-a716-446655440000',
  });
});

test('District Management loads organizations from the current-user resource', async () => {
  await getUserOrganizations({ forceRefresh: true });

  expect(mockApiGet).toHaveBeenCalledWith(
    'v1/users/me/organizations',
    {},
    expect.objectContaining({
      cacheKey: 'v1/users/me/organizations',
      forceRefresh: true,
    })
  );
});

test('public registration does not send a stale authenticated session', async () => {
  const response = { ok: true };
  global.fetch = jest.fn().mockResolvedValue(response);
  mockHandleResponse.mockResolvedValue({ success: true });

  await registerAccount({
    email: 'parent@example.com',
    password: 'StrongPass1!',
    full_name: 'Parent Example'
  });

  expect(global.fetch).toHaveBeenCalledWith(
    'http://localhost:5173/public/register',
    expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-organization-id': 3
      }
    })
  );
  expect(mockHandleResponse).toHaveBeenCalledWith(response);
});
