/**
 * @jest-environment jsdom
 */

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugError: jest.fn(),
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => {
    // eslint-disable-next-line no-param-reassign
    element.innerHTML = html;
  },
  loadStylesheet: jest.fn(() => Promise.resolve())
}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn((permission) => permission === 'org.edit'),
  canSendCommunications: jest.fn(() => false),
  canAccessAdminPanel: jest.fn(() => false),
  canViewRoles: jest.fn(() => false),
  canManageForms: jest.fn(() => false)
}));

jest.mock('../../spa/utils/MeetingDateUtils.js', () => ({
  DAYS_OF_WEEK: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
}));

const mockUpdateOrganizationInfo = jest.fn();
jest.mock('../../spa/api/api-endpoints.js', () => ({
  fetchEditableOrganizationSettings: jest.fn(() => Promise.resolve({
    data: {
      organization_info: {
        name: 'Existing unit',
        meeting_day: 'Wednesday',
        meeting_time: '19:00'
      },
      meeting_length: { duration_minutes: 90 }
    }
  })),
  getLeaders: jest.fn(() => Promise.resolve({ data: { users: [] } })),
  updateOrganizationInfo: (...args) => mockUpdateOrganizationInfo(...args)
}));

jest.mock('../../spa/api/api-core.js', () => ({
  makeApiRequest: jest.fn()
}));

import { UnitSettings } from '../../spa/modules/unit-settings/unit-settings.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  mockUpdateOrganizationInfo.mockResolvedValue({
    data: { organization_info: { name: '12e Unité' } }
  });
});

test('reads every visible control when saving unit settings', async () => {
  const app = { showMessage: jest.fn(), organizationSettings: {} };
  const module = new UnitSettings(app);
  await module.init();

  document.getElementById('unit-organization-name').value = '12e Unité';
  document.getElementById('unit-name').value = '12e';
  document.getElementById('unit-district').value = 'District du Nord';
  document.getElementById('unit-group-leader').value = 'Alex Tremblay';
  document.getElementById('unit-meeting-location').value = 'Centre communautaire';
  document.getElementById('unit-meeting-day').value = 'Thursday';
  document.getElementById('unit-meeting-time').value = '18:30';
  document.getElementById('unit-meeting-duration').value = '105';
  document.getElementById('unit-logo-url').value = '/images/12e.png';

  await module.handleSaveUnitDetails({ preventDefault: jest.fn() });

  expect(mockUpdateOrganizationInfo).toHaveBeenCalledWith({
    name: '12e Unité',
    unit: '12e',
    district: 'District du Nord',
    animateur_responsable: 'Alex Tremblay',
    endroit: 'Centre communautaire',
    meeting_day: 'Thursday',
    meeting_time: '18:30',
    meeting_duration: 105,
    logo: '/images/12e.png'
  });
});

test('shows a localized validation message instead of the English API detail', async () => {
  const app = { showMessage: jest.fn(), organizationSettings: {} };
  const module = new UnitSettings(app);
  await module.init();
  const apiError = new Error('Invalid organization settings: Organization name is required');
  apiError.status = 400;
  mockUpdateOrganizationInfo.mockRejectedValue(apiError);

  await module.handleSaveUnitDetails({ preventDefault: jest.fn() });

  expect(app.showMessage).toHaveBeenCalledWith('unit_settings_invalid_settings', 'error');
});
