/**
 * @jest-environment jsdom
 *
 * The parent dashboard offers only what the account can open and save.
 *
 * "Request a badge" and "View progress report" led parents to a 403 page:
 * badges and reports are unit-wide (badges.view, reports.view). The calendar
 * and carpool buttons need activities.view and carpools.view. Each button now
 * follows the permission its page requires, and a refused permission slip is
 * explained in the page's language.
 */

jest.mock('../../spa/ajax-functions.js', () => ({}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  declinePermissionSlip: jest.fn(),
  getPermissionSlips: jest.fn(),
  signPermissionSlip: jest.fn(),
}));
jest.mock('../../spa/api/api-activities.js', () => ({ getActivities: jest.fn() }));
jest.mock('../../spa/api/api-scout-years.js', () => ({}));
jest.mock('../../spa/api/api-core.js', () => ({ buildApiUrl: (path) => path }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
  registerPushSubscription: jest.fn(),
}));
jest.mock('../../spa/functions.js', () => ({}));
jest.mock('../../spa/config.js', () => ({ CONFIG: {} }));
jest.mock('../../spa/utils/DOMUtils.js', () => ({ setContent: jest.fn(), loadStylesheet: jest.fn() }));
jest.mock('../../spa/utils/DateUtils.js', () => ({ formatDateShort: (v) => v, parseDate: (v) => v }));
jest.mock('../../spa/utils/ActivityDateUtils.js', () => ({}));
jest.mock('../../spa/utils/FormLabelUtils.js', () => ({ formTypeLabel: (type) => type }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirm: jest.fn(),
  prompt: jest.fn(),
}));

const mockHeld = new Set();
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  isParent: () => true,
  hasPermission: (key) => mockHeld.has(key),
  canViewFinance: () => false,
  canManageFinance: () => false,
  canViewBudget: () => false,
  canManageBudget: () => false,
  canViewBadges: () => mockHeld.has('badges.view'),
  canApproveBadges: () => mockHeld.has('badges.approve'),
  canViewReports: () => mockHeld.has('reports.view'),
  canViewActivities: () => mockHeld.has('activities.view'),
  canViewCarpools: () => mockHeld.has('carpools.view') || mockHeld.has('carpools.manage'),
}));

const endpoints = require('../../spa/api/api-endpoints.js');
const { prompt } = require('../../spa/utils/DialogUtils.js');
const { ParentDashboard } = require('../../spa/parent_dashboard.js');

const PARENT_PERMISSIONS = [
  'participants.view', 'participants.create_own', 'permission_slips.sign', 'activities.view', 'carpools.view',
];
const CHILD = { id: 4, first_name: 'Léa', last_name: 'Parent' };

/**
 * Hrefs of the per-child buttons for an account holding these permissions.
 *
 * @param {string[]} permissions - Permission keys held
 * @returns {string[]} Hrefs
 */
function childButtonHrefs(permissions) {
  mockHeld.clear();
  permissions.forEach((key) => mockHeld.add(key));
  const page = new ParentDashboard({ showMessage: jest.fn() });
  page.formFormats = { fiche_sante: {} };
  document.body.innerHTML = page.renderFormButtons(CHILD);
  return [...document.querySelectorAll('a')].map((link) => link.getAttribute('href'));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('parent dashboard buttons', () => {
  test('a parent is not offered the unit-wide badge and report pages', () => {
    const hrefs = childButtonHrefs(PARENT_PERMISSIONS);
    expect(hrefs).toEqual(expect.arrayContaining([
      '/dynamic-form/fiche_sante/4', '/parent-program-progress', '/medication-planning/4',
    ]));
    expect(hrefs).not.toContain('/badge-form/4');
    expect(hrefs).not.toContain('/reports?participantId=4');
  });

  test('an account that may open them still sees them', () => {
    const hrefs = childButtonHrefs([...PARENT_PERMISSIONS, 'badges.view', 'reports.view']);
    expect(hrefs).toContain('/badge-form/4');
    expect(hrefs).toContain('/reports?participantId=4');
  });

  test('carpool coordination follows activities.view and carpools.view', () => {
    mockHeld.clear();
    PARENT_PERMISSIONS.forEach((key) => mockHeld.add(key));
    const page = new ParentDashboard({});
    expect(page.renderCarpoolButton()).toContain('id="view-carpool-activities"');

    mockHeld.delete('carpools.view');
    expect(page.renderCarpoolButton()).toBe('');
  });
});

describe('answering a permission slip', () => {
  /**
   * Click "sign" on a rendered slip button.
   *
   * @param {Error} failure - Error the API rejects with
   * @returns {Promise<Object>} The app stub
   */
  async function signWith(failure) {
    const app = { showMessage: jest.fn() };
    const page = new ParentDashboard(app);
    page.loadPermissionSlips = jest.fn().mockResolvedValue([]);
    page.refreshPermissionSlipSection = jest.fn();
    document.body.innerHTML = `<div id="app"><button type="button" class="permission-slip-sign-btn"
      data-slip-id="9" data-participant-id="4">sign</button></div>`;
    page.bindPermissionSlipHandlers();
    prompt.mockResolvedValue('Marie Parent');
    endpoints.signPermissionSlip.mockRejectedValue(failure);

    document.querySelector('button').click();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    return app;
  }

  test('a refusal is shown in the page language', async () => {
    const app = await signWith(Object.assign(new Error('API request failed: Insufficient permissions'), { status: 403 }));
    expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
  });

  test('a slip answered meanwhile says so and refreshes', async () => {
    const app = await signWith(Object.assign(new Error('API request failed: Permission slip has already been answered'), { status: 409 }));
    expect(app.showMessage).toHaveBeenCalledWith('permission_slip_already_answered', 'warning');
  });
});
