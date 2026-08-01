/**
 * @jest-environment jsdom
 */

const mockGetCalendarsForFundraiser = jest.fn();

jest.mock('../../spa/ajax-functions.js', () => ({
  getCalendarsForFundraiser: (...args) => mockGetCalendarsForFundraiser(...args),
  getFundraiser: jest.fn(),
  updateCalendarEntry: jest.fn(),
  updateCalendarPayment: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/indexedDB.js', () => ({
  clearFundraiserRelatedCaches: jest.fn(),
}));
jest.mock('../../spa/utils/PrintUtils.js', () => ({
  openPrintWindow: jest.fn(),
  setPrintContent: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { TIME_FORMAT: { DEFAULT: '24h' } },
  getStorageKey: jest.fn((key) => key),
}));

import { Calendars } from '../../spa/calendars.js';

test('reads fundraiser entries from the standardized response data envelope', async () => {
  const entries = [
    { id: 2, first_name: 'Zoé', paid: false },
    { id: 1, first_name: 'Alex', paid: true },
  ];
  mockGetCalendarsForFundraiser.mockResolvedValue({
    success: true,
    data: { fundraiser_entries: entries },
  });

  const calendars = new Calendars({ showMessage: jest.fn() });
  calendars.fundraiserId = 9;
  await calendars.fetchCalendars();

  expect(mockGetCalendarsForFundraiser).toHaveBeenCalledWith(9);
  expect(calendars.calendars.map((entry) => entry.id)).toEqual([1, 2]);
});
