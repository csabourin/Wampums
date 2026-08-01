/**
 * @jest-environment jsdom
 */

/**
 * Consulting an archived scout year.
 *
 * Three things have to agree on which season is being shown: the header sent
 * with every request, the key responses are cached under, and the guard that
 * refuses to write into an archive. They are tested together because a
 * disagreement between any two of them is the actual failure mode — a write
 * landing in the wrong year, or last year's roster served as if it were today's.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: { API_BASE_URL: 'https://unit.wampums.app' }
}));

jest.mock('../../spa/jwt-helper.js', () => ({
  getOrganizationIdFromJWT: () => null,
  getUserInfoFromJWT: () => ({})
}));

import {
  getSelectedScoutYear,
  getSelectedScoutYearId,
  isArchiveMode,
  setSelectedScoutYear,
  clearSelectedScoutYear,
  onScoutYearChange
} from '../../spa/modules/scout-year/ScoutYearContext.js';

const ARCHIVED_YEAR = { id: 4, label: '2024-2025', status: 'closed' };
const ACTIVE_YEAR = { id: 6, label: '2026-2027', status: 'active' };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('currentOrganizationId', '12');
});

describe('the selected scout year', () => {
  test('starts on the current season, with nothing stored', () => {
    expect(getSelectedScoutYear()).toBeNull();
    expect(getSelectedScoutYearId()).toBeNull();
    expect(isArchiveMode()).toBe(false);
  });

  test('remembers an archived year', () => {
    setSelectedScoutYear(ARCHIVED_YEAR);

    expect(getSelectedScoutYearId()).toBe(4);
    expect(isArchiveMode()).toBe(true);
    expect(getSelectedScoutYear()).toEqual(ARCHIVED_YEAR);
  });

  test('treats picking the active year as going back to now', () => {
    setSelectedScoutYear(ARCHIVED_YEAR);
    setSelectedScoutYear(ACTIVE_YEAR);

    // Storing it would send a year header and split the cache for what is
    // already the default answer.
    expect(isArchiveMode()).toBe(false);
    expect(localStorage.getItem('selectedScoutYear')).toBeNull();
  });

  test('ignores a year chosen while another unit was selected', () => {
    setSelectedScoutYear(ARCHIVED_YEAR);
    localStorage.setItem('currentOrganizationId', '99');

    // Asking unit 99 for unit 12's year would simply be refused by the server.
    expect(getSelectedScoutYear()).toBeNull();
    expect(isArchiveMode()).toBe(false);
  });

  test('survives a corrupted entry rather than throwing', () => {
    localStorage.setItem('selectedScoutYear', 'not json');
    expect(getSelectedScoutYear()).toBeNull();
  });

  test('notifies subscribers only when the year actually moves', () => {
    const listener = jest.fn();
    const unsubscribe = onScoutYearChange(listener);

    setSelectedScoutYear(ARCHIVED_YEAR);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(ARCHIVED_YEAR);

    setSelectedScoutYear(ARCHIVED_YEAR);
    expect(listener).toHaveBeenCalledTimes(1);

    clearSelectedScoutYear();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(null);

    unsubscribe();
    setSelectedScoutYear(ARCHIVED_YEAR);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('what the rest of the app derives from it', () => {
  test('sends the year header only while consulting an archive', async () => {
    const { getAuthHeader } = await import('../../spa/api/api-helpers.js');
    localStorage.setItem('jwtToken', 'token');

    expect(getAuthHeader()['x-scout-year-id']).toBeUndefined();

    setSelectedScoutYear(ARCHIVED_YEAR);
    expect(getAuthHeader()['x-scout-year-id']).toBe('4');
  });

  test('gives an archived year its own cache entries', async () => {
    const { buildScopedCacheKey } = await import('../../spa/utils/OfflineCacheKeys.js');

    const currentKey = buildScopedCacheKey('/api/v1/participants');
    expect(currentKey).not.toContain('|year:');

    setSelectedScoutYear(ARCHIVED_YEAR);
    const archiveKey = buildScopedCacheKey('/api/v1/participants');
    expect(archiveKey).toBe(`${currentKey}|year:4`);

    // Already-scoped keys must not accumulate suffixes on a second pass.
    expect(buildScopedCacheKey(archiveKey)).toBe(archiveKey);
  });
});
