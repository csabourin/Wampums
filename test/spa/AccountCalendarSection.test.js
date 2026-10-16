/**
 * @jest-environment jsdom
 *
 * "Mon compte" offers the calendar subscription to those who see the unit's
 * activities, and keeps it in place when the page redraws itself.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key, app: {} }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({ CONFIG: { DEFAULT_LANG: 'fr' }, getStorageKey: (key) => key }));
jest.mock('../../spa/api/api-core.js', () => ({ makeApiRequest: jest.fn() }));
jest.mock('../../spa/api/api-members.js', () => ({ updateMyNickname: jest.fn() }));
jest.mock('../../spa/modules/push/PushSubscription.js', () => ({
  enablePushNotifications: jest.fn(), disablePushNotifications: jest.fn(), PushSetupError: class extends Error {},
}));
let mockSeesActivities = true;
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewActivities: jest.fn(() => mockSeesActivities),
  holdsFamilyRole: jest.fn(() => false),
  isParent: jest.fn(() => true),
  isDemoUser: jest.fn(() => false),
}));
const mockMount = jest.fn();
const mockDestroy = jest.fn();
jest.mock('../../spa/modules/calendar-feed/CalendarFeedPanel.js', () => ({
  CALENDAR_FEED_ANCHOR: 'calendar-feed',
  CalendarFeedPanel: jest.fn().mockImplementation(() => ({ mount: mockMount, destroy: mockDestroy })),
}));

import { AccountInfoModule } from '../../spa/modules/account-info.js';

/** @returns {AccountInfoModule} The account page, drawn */
function renderPage() {
  document.body.innerHTML = '<main id="app"></main>';
  const page = new AccountInfoModule({
    lang: 'fr', showMessage: jest.fn(), getUnitLanguages: () => ({ available: ['fr', 'en'] }),
  });
  page.userData = { full_name: 'Marie Parent', email: 'marie@example.test', roles: [] };
  page.render();
  return page;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSeesActivities = true;
});

test('someone who sees activities gets the calendar section, labelled by its heading', () => {
  renderPage();
  const section = document.getElementById('calendar-feed');
  expect(section).not.toBeNull();
  expect(section.getAttribute('aria-labelledby')).toBe('calendar-feed-heading');
  expect(mockMount).toHaveBeenCalledWith(section);
});

test('someone who does not see activities is not offered a calendar', () => {
  mockSeesActivities = false;
  renderPage();
  expect(document.getElementById('calendar-feed')).toBeNull();
  expect(mockMount).not.toHaveBeenCalled();
});

test('each redraw of the page mounts the same panel again, and leaving the page releases it', () => {
  const page = renderPage();
  page.render();
  expect(mockMount).toHaveBeenCalledTimes(2);
  expect(mockMount.mock.calls[1][0]).toBe(document.getElementById('calendar-feed'));

  page.destroy();
  expect(mockDestroy).toHaveBeenCalled();
});
