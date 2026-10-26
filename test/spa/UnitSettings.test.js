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
  loadStylesheet: jest.fn(() => Promise.resolve()),
  withFormBusy: (_form, fn) => fn()
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    PROGRAM_SECTIONS: {
      DEFAULT: ['general', 'beavers', 'cubs', 'scouts', 'pioneers', 'rovers']
        .map((key) => ({ key, labelKey: `program_section_${key}` })),
    },
  },
}));

const mockUpdateUnitBranch = jest.fn();
const mockGetUnitDomains = jest.fn();
const mockAddUnitDomain = jest.fn();
const mockSetPrimaryUnitDomain = jest.fn();
const mockRemoveUnitDomain = jest.fn();
jest.mock('../../spa/api/api-organizations.js', () => ({
  updateUnitBranch: (...args) => mockUpdateUnitBranch(...args),
  getUnitDomains: (...args) => mockGetUnitDomains(...args),
  addUnitDomain: (...args) => mockAddUnitDomain(...args),
  setPrimaryUnitDomain: (...args) => mockSetPrimaryUnitDomain(...args),
  removeUnitDomain: (...args) => mockRemoveUnitDomain(...args)
}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  // A unit administrator reads and writes organization settings. The group tab
  // follows the API and needs org.view for the membership read, org.edit to change it.
  hasPermission: jest.fn((permission) => ['org.view', 'org.edit'].includes(permission)),
  canSendCommunications: jest.fn(() => false),
  canAccessAdminPanel: jest.fn(() => false),
  canViewRoles: jest.fn(() => false),
  canManageForms: jest.fn(() => false)
}));

jest.mock('../../spa/utils/MeetingDateUtils.js', () => ({
  DAYS_OF_WEEK: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
}));

const mockUpdateOrganizationInfo = jest.fn();
const mockUpdateUnitVocabulary = jest.fn();
const mockUpdateDashboardConfiguration = jest.fn();
const mockUpdateParentDashboardConfiguration = jest.fn();
const mockGetLocalGroups = jest.fn();
const mockGetLocalGroupMemberships = jest.fn();
const mockJoinLocalGroup = jest.fn();
const mockLeaveLocalGroup = jest.fn();
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
  updateOrganizationInfo: (...args) => mockUpdateOrganizationInfo(...args),
  updateUnitVocabulary: (...args) => mockUpdateUnitVocabulary(...args),
  updateDashboardConfiguration: (...args) => mockUpdateDashboardConfiguration(...args),
  updateParentDashboardConfiguration: (...args) => mockUpdateParentDashboardConfiguration(...args),
  getLocalGroups: (...args) => mockGetLocalGroups(...args),
  getLocalGroupMemberships: (...args) => mockGetLocalGroupMemberships(...args),
  joinLocalGroup: (...args) => mockJoinLocalGroup(...args),
  leaveLocalGroup: (...args) => mockLeaveLocalGroup(...args)
}));

jest.mock('../../spa/api/api-core.js', () => ({
  makeApiRequest: jest.fn()
}));

const mockConfirmDestructive = jest.fn();
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirmDestructive: (...args) => mockConfirmDestructive(...args)
}));

import axe from 'axe-core';
import { UnitSettings } from '../../spa/modules/unit-settings/unit-settings.js';
import { canManageForms, hasPermission } from '../../spa/utils/PermissionUtils.js';

const flushPromises = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const UNIT_ADDRESSES = [
  { id: 4, domain: 'meute-ada.wampums.app', is_primary: true, is_wildcard: false },
  { id: 7, domain: 'ancienne-meute.wampums.app', is_primary: false, is_wildcard: false }
];

const LOCAL_GROUP_CATALOG = [
  { id: 1, name: 'Groupe 6 Aylmer', slug: 'groupe-6-aylmer' },
  { id: 2, name: 'Hull', slug: 'hull' }
];

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  mockUpdateOrganizationInfo.mockResolvedValue({
    data: { organization_info: { name: '12e Unité' } }
  });
  mockUpdateUnitVocabulary.mockResolvedValue({ data: {} });
  mockUpdateDashboardConfiguration.mockResolvedValue({ data: {} });
  mockUpdateParentDashboardConfiguration.mockImplementation((payload) =>
    Promise.resolve({ data: { parent_dashboard_configuration: payload } }));
  canManageForms.mockReturnValue(false);
  hasPermission.mockImplementation((permission) => ['org.view', 'org.edit'].includes(permission));
  mockGetLocalGroups.mockResolvedValue({ data: LOCAL_GROUP_CATALOG });
  mockGetLocalGroupMemberships.mockResolvedValue({
    data: [{ id: 1, name: 'Groupe 6 Aylmer', slug: 'groupe-6-aylmer', peer_organizations: ['Meute 6B'] }]
  });
  mockJoinLocalGroup.mockResolvedValue({
    data: {
      added: { id: 2, name: 'Hull', slug: 'hull' },
      memberships: [
        { id: 1, name: 'Groupe 6 Aylmer', slug: 'groupe-6-aylmer', peer_organizations: ['Meute 6B'] },
        { id: 2, name: 'Hull', slug: 'hull', peer_organizations: [] }
      ]
    }
  });
  mockLeaveLocalGroup.mockResolvedValue({ data: null });
  mockConfirmDestructive.mockResolvedValue(true);
  mockGetUnitDomains.mockResolvedValue({ data: UNIT_ADDRESSES });
  mockUpdateUnitBranch.mockResolvedValue({
    data: { program_section: 'scouts', unit_vocabulary: { version: 1, profile: 'generic', locales: { en: {}, fr: {} } } }
  });
  mockAddUnitDomain.mockResolvedValue({ data: {} });
  mockSetPrimaryUnitDomain.mockResolvedValue({ data: {} });
  mockRemoveUnitDomain.mockResolvedValue({ data: null });
});

test('links authorized unit administrators to the form builder', async () => {
  canManageForms.mockReturnValue(true);
  const module = new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} });
  await module.init();

  expect(document.querySelector('a[href="/form-builder"]')).not.toBeNull();
});

test('renders vocabulary and dashboard tabs with organization-level controls', async () => {
  const app = { showMessage: jest.fn(), organizationSettings: {}, lang: 'fr' };
  const module = new UnitSettings(app);
  await module.init();

  expect(document.querySelectorAll('[data-settings-tab]')).toHaveLength(5);
  const generalTab = document.getElementById('unit-settings-tab-general');
  const vocabularyTab = document.getElementById('unit-settings-tab-vocabulary');
  const tabPanel = document.getElementById('unit-settings-tab-panel');
  expect(generalTab.getAttribute('aria-controls')).toBe('unit-settings-tab-panel');
  expect(generalTab.getAttribute('aria-selected')).toBe('true');
  expect(generalTab.getAttribute('tabindex')).toBe('0');
  expect(vocabularyTab.getAttribute('tabindex')).toBe('-1');
  expect(tabPanel.getAttribute('aria-labelledby')).toBe('unit-settings-tab-general');

  generalTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(document.activeElement.id).toBe('unit-settings-tab-vocabulary');
  expect(document.getElementById('unit-settings-tab-vocabulary').getAttribute('aria-selected')).toBe('true');
  expect(document.getElementById('unit-settings-tab-panel').getAttribute('aria-labelledby'))
    .toBe('unit-settings-tab-vocabulary');

  module.activeTab = 'vocabulary';
  module.render();
  module.attachEventListeners();
  expect(document.getElementById('unit-vocabulary-profile')).not.toBeNull();
  expect(document.querySelectorAll('.unit-vocabulary-input')).toHaveLength(24);

  module.activeTab = 'dashboard';
  module.render();
  module.attachEventListeners();
  const pointsToggle = document.getElementById('dashboard-feature-points');
  pointsToggle.checked = false;
  await module.handleSaveDashboard({ preventDefault: jest.fn() });
  expect(mockUpdateDashboardConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({ hidden_tile_keys: expect.arrayContaining(['points']) })
  );
});

test('loads group memberships only once the group tab is opened', async () => {
  const app = { showMessage: jest.fn(), organizationSettings: {} };
  const module = new UnitSettings(app);
  await module.init();

  expect(mockGetLocalGroups).not.toHaveBeenCalled();
  expect(mockGetLocalGroupMemberships).not.toHaveBeenCalled();

  document.getElementById('unit-settings-tab-group').click();
  await module.ensureLocalGroupsLoaded();

  expect(mockGetLocalGroups).toHaveBeenCalledTimes(1);
  expect(mockGetLocalGroupMemberships).toHaveBeenCalledTimes(1);

  const items = document.querySelectorAll('.unit-group-item');
  expect(items).toHaveLength(1);
  expect(items[0].textContent).toContain('Groupe 6 Aylmer');
  expect(items[0].textContent).toContain('unit_group_shared_with');

  // Only groups the unit has not joined can be selected.
  const options = Array.from(document.querySelectorAll('#unit-group-select option'));
  expect(options.map((option) => option.value)).toEqual(['2']);

  // Reopening the tab reuses what was already fetched.
  document.getElementById('unit-settings-tab-general').click();
  document.getElementById('unit-settings-tab-group').click();
  await module.ensureLocalGroupsLoaded();
  expect(mockGetLocalGroups).toHaveBeenCalledTimes(1);
});

test('joins a group and shows the units it is now shared with', async () => {
  const app = { showMessage: jest.fn(), organizationSettings: {} };
  const module = new UnitSettings(app);
  await module.init();
  module.activeTab = 'group';
  await module.ensureLocalGroupsLoaded();

  document.getElementById('unit-group-select').value = '2';
  await module.handleJoinGroup({ preventDefault: jest.fn() });

  expect(mockJoinLocalGroup).toHaveBeenCalledWith(2);
  expect(app.showMessage).toHaveBeenCalledWith('unit_group_joined', 'success');

  const items = document.querySelectorAll('.unit-group-item');
  expect(items).toHaveLength(2);
  expect(items[1].textContent).toContain('Hull');
  expect(items[1].textContent).toContain('unit_group_no_peers');
  // Every catalog group is joined, so nothing is left to select.
  expect(document.getElementById('unit-group-select')).toBeNull();
});

test('confirms before leaving a group and drops it from the list', async () => {
  const app = { showMessage: jest.fn(), organizationSettings: {} };
  const module = new UnitSettings(app);
  await module.init();
  module.activeTab = 'group';
  await module.ensureLocalGroupsLoaded();

  mockConfirmDestructive.mockResolvedValueOnce(false);
  await module.handleLeaveGroup(1);
  expect(mockLeaveLocalGroup).not.toHaveBeenCalled();
  expect(document.querySelectorAll('.unit-group-item')).toHaveLength(1);

  await module.handleLeaveGroup(1);
  expect(mockLeaveLocalGroup).toHaveBeenCalledWith(1);
  expect(app.showMessage).toHaveBeenCalledWith('unit_group_left', 'success');
  expect(document.querySelectorAll('.unit-group-item')).toHaveLength(0);
  expect(document.querySelector('.unit-group-status').textContent).toContain('unit_group_none');
});

test('hides the group tab from users without organization read access', async () => {
  hasPermission.mockReturnValue(false);
  const module = new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} });
  await module.init();

  expect(document.querySelectorAll('[data-settings-tab]')).toHaveLength(4);
  expect(document.getElementById('unit-settings-tab-group')).toBeNull();
});

test('requires org.view for the group tab even when the unit is editable', async () => {
  // The panel opens with a membership read, so it follows the read permission
  // the API enforces rather than riding on org.edit.
  hasPermission.mockImplementation((permission) => permission === 'org.edit');
  const module = new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} });
  await module.init();

  expect(document.getElementById('unit-settings-tab-group')).toBeNull();
  expect(document.getElementById('unit-details-form')).not.toBeNull();
});

test('shows group membership read-only when the unit cannot be edited', async () => {
  hasPermission.mockImplementation((permission) => permission === 'org.view');
  const module = new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} });
  await module.init();
  module.activeTab = 'group';
  await module.ensureLocalGroupsLoaded();

  expect(document.getElementById('unit-settings-tab-group')).not.toBeNull();
  expect(document.querySelectorAll('.unit-group-item')).toHaveLength(1);
  expect(document.querySelector('.unit-group-leave-btn')).toBeNull();
  expect(document.getElementById('unit-group-join-form')).toBeNull();
});

test('reports a localized error when group membership cannot be loaded', async () => {
  mockGetLocalGroupMemberships.mockRejectedValue(new Error('network down'));
  const module = new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} });
  await module.init();
  module.activeTab = 'group';
  await module.ensureLocalGroupsLoaded();

  expect(document.querySelector('.error-message').textContent).toContain('error_loading_data');
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

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } }
};

describe('parent dashboard tab', () => {
  /**
   * Open Unit settings on the parent dashboard tab with the keyboard.
   *
   * @param {Object} app - App stub
   * @returns {Promise<UnitSettings>} The page
   */
  async function openParentDashboardTab(app) {
    const module = new UnitSettings(app);
    await module.init();
    const dashboardTab = document.getElementById('unit-settings-tab-dashboard');
    dashboardTab.focus();
    dashboardTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return module;
  }

  test('is reached with the keyboard and names every optional button', async () => {
    await openParentDashboardTab({ showMessage: jest.fn(), organizationSettings: {} });

    const tab = document.getElementById('unit-settings-tab-parent_dashboard');
    expect(document.activeElement).toBe(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('unit-settings-tab-panel').getAttribute('aria-labelledby'))
      .toBe('unit-settings-tab-parent_dashboard');

    const switches = [...document.querySelectorAll('.unit-parent-dashboard-button')];
    expect(switches.map((input) => input.dataset.buttonKey)).toEqual(expect.arrayContaining([
      'request_badge', 'program_progress'
    ]));
    switches.forEach((input) => {
      expect(input.getAttribute('role')).toBe('switch');
      expect(input.checked).toBe(true);
      expect(document.querySelector(`label[for="${input.id}"]`).textContent.trim()).not.toBe('');
    });
    expect(document.querySelector('[data-button-key="add_child"]')).toBeNull();
  });

  test('saves the buttons switched off and shares them with the app', async () => {
    const app = { showMessage: jest.fn(), organizationSettings: {} };
    const module = await openParentDashboardTab(app);

    document.getElementById('parent-dashboard-button-request_badge').checked = false;
    document.getElementById('parent-dashboard-button-program_progress').checked = false;
    await module.handleSaveParentDashboard({ preventDefault: jest.fn() });

    expect(mockUpdateParentDashboardConfiguration).toHaveBeenCalledWith({
      version: 1,
      hidden_button_keys: ['program_progress', 'request_badge']
    });
    expect(app.organizationSettings.parent_dashboard_configuration.hidden_button_keys)
      .toEqual(['program_progress', 'request_badge']);
    expect(app.showMessage).toHaveBeenCalledWith('unit_parent_dashboard_saved', 'success');
  });

  test('is read-only without org.edit', async () => {
    hasPermission.mockImplementation((permission) => permission === 'org.view');
    await openParentDashboardTab({ showMessage: jest.fn(), organizationSettings: {} });

    expect(document.getElementById('save-parent-dashboard-btn')).toBeNull();
    document.querySelectorAll('.unit-parent-dashboard-button').forEach((input) => {
      expect(input.disabled).toBe(true);
    });
  });

  test('has no WCAG A/AA violations', async () => {
    await openParentDashboardTab({ showMessage: jest.fn(), organizationSettings: {} });
    const results = await axe.run(document.querySelector('.unit-settings-page'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

describe('Unit languages', () => {
  const { makeApiRequest } = jest.requireMock('../../spa/api/api-core.js');

  /**
   * Open the general tab as a unit administrator.
   *
   * @param {Object} [app] - Extra app fields
   * @returns {Promise<Object>} The app
   */
  async function openGeneralTab(app = {}) {
    const fullApp = { showMessage: jest.fn(), organizationSettings: {}, lang: 'fr', applyUnitLanguages: jest.fn(), ...app };
    const module = new UnitSettings(fullApp);
    await module.init();
    return fullApp;
  }

  test('offers each optional language by its own name, with French and English always on', async () => {
    await openGeneralTab();
    const form = document.getElementById('interface-languages-form');
    const labels = Array.from(form.querySelectorAll('fieldset label')).map((label) => [label.textContent, label.getAttribute('lang')]);

    expect(labels).toEqual([['Українська', 'uk'], ['Italiano', 'it'], ['Indonesia', 'id']]);
    expect(form.querySelectorAll('input[name="enabled"]:checked')).toHaveLength(0);
    expect(document.getElementById('interface-fallback-select').value).toBe('en');
  });

  test('saves the chosen languages and brings the session in line', async () => {
    makeApiRequest.mockResolvedValue({ data: { interface_languages: { enabled: ['uk'], fallback: 'fr' } } });
    const app = await openGeneralTab();

    document.getElementById('interface-lang-uk').checked = true;
    document.getElementById('interface-fallback-select').value = 'fr';
    document.getElementById('interface-languages-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(makeApiRequest).toHaveBeenCalledWith('v1/organizations/settings/languages', {
      method: 'PATCH',
      body: { enabled: ['uk'], fallback: 'fr' },
    });
    expect(app.organizationSettings.interface_languages).toEqual({ enabled: ['uk'], fallback: 'fr' });
    expect(app.applyUnitLanguages).toHaveBeenCalled();
  });

  test('the languages form has no WCAG A/AA violations', async () => {
    await openGeneralTab();
    const results = await axe.run(document.getElementById('interface-languages-form'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});

describe('the unit\'s branch', () => {
  test.each(['cubs', 'beavers'])(
    'saving %s vocabulary updates the branch selector before General can save it again', async (profile) => {
      const app = { showMessage: jest.fn(), organizationSettings: { program_section: 'general' } };
      const fetchSettings = require('../../spa/api/api-endpoints.js').fetchEditableOrganizationSettings;
      fetchSettings.mockResolvedValueOnce({ data: { organization_info: { name: 'Unité Ada' }, program_section: 'general' } });
      await new UnitSettings(app).init();
      mockUpdateUnitVocabulary.mockResolvedValueOnce({ data: { program_section: profile } });

      document.getElementById('unit-settings-tab-vocabulary').click();
      const select = document.getElementById('unit-vocabulary-profile');
      select.value = profile;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('unit-vocabulary-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushPromises();

      expect(app.organizationSettings.program_section).toBe(profile);
      document.getElementById('unit-settings-tab-general').click();
      expect(document.getElementById('unit-branch-select').value).toBe(profile);
      document.getElementById('unit-branch-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushPromises();
      expect(mockUpdateUnitBranch).toHaveBeenCalledWith(profile);
    },
  );

  test('shows the branch the unit has, and saving another changes the app\'s vocabulary with it', async () => {
    const app = { showMessage: jest.fn(), organizationSettings: { program_section: 'cubs' } };
    const fetchSettings = require('../../spa/api/api-endpoints.js').fetchEditableOrganizationSettings;
    fetchSettings.mockResolvedValueOnce({ data: { organization_info: { name: 'Meute Ada' }, program_section: 'cubs' } });
    const module = new UnitSettings(app);
    await module.init();

    const select = document.getElementById('unit-branch-select');
    expect(select.value).toBe('cubs');
    expect(document.getElementById(select.getAttribute('aria-describedby')).textContent).toBe('unit_branch_hint');

    select.value = 'scouts';
    document.getElementById('unit-branch-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(mockUpdateUnitBranch).toHaveBeenCalledWith('scouts');
    expect(app.organizationSettings).toMatchObject({ program_section: 'scouts', unit_vocabulary: { profile: 'generic' } });
    expect(app.showMessage).toHaveBeenCalledWith('unit_branch_saved', 'success');
    expect(document.activeElement).toBe(document.getElementById('unit-branch-select'));
  });

  test('a refused change says so and keeps the branch shown', async () => {
    mockUpdateUnitBranch.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 403 }));
    const app = { showMessage: jest.fn(), organizationSettings: {} };
    await new UnitSettings(app).init();

    document.getElementById('unit-branch-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
    expect(app.showMessage).not.toHaveBeenCalledWith('unit_branch_saved', 'success');
  });

  test('someone who cannot edit the unit sees the branch without a way to change it', async () => {
    hasPermission.mockImplementation((permission) => permission === 'org.view');
    await new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} }).init();

    expect(document.getElementById('unit-branch-select').disabled).toBe(true);
    expect(document.getElementById('save-unit-branch-btn')).toBeNull();
  });
});

describe('the unit\'s addresses', () => {
  const asDistrict = () => hasPermission.mockImplementation((permission) => ['org.view', 'org.edit', 'org.create'].includes(permission));
  const addressItems = () => Array.from(document.querySelectorAll('.unit-addresses-item'));

  test('a unit administrator sees where the unit answers, but changing it is left to the district', async () => {
    await new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} }).init();

    expect(addressItems().map((item) => item.querySelector('.unit-addresses-domain').textContent))
      .toEqual(['meute-ada.wampums.app', 'ancienne-meute.wampums.app']);
    expect(addressItems()[0].textContent).toContain('unit_addresses_primary');
    expect(document.querySelector('[data-domain-remove], [data-domain-primary], #unit-address-form')).toBeNull();
    expect(document.body.textContent).toContain('unit_addresses_read_only');
  });

  test('a district administrator adds an address, and the list is read again', async () => {
    asDistrict();
    const app = { showMessage: jest.fn(), organizationSettings: {} };
    await new UnitSettings(app).init();

    const input = document.getElementById('unit-address-subdomain');
    input.value = ' Meute-Lea ';
    document.getElementById('unit-address-primary').checked = true;
    document.getElementById('unit-address-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(mockAddUnitDomain).toHaveBeenCalledWith('meute-lea', true);
    expect(mockGetUnitDomains).toHaveBeenCalledTimes(2);
    expect(app.showMessage).toHaveBeenCalledWith('unit_addresses_added', 'success');
    expect(document.activeElement).toBe(document.getElementById('unit-addresses-title'));
  });

  test('an unusable address is tied to its field before anything is sent, and goes once it is edited', async () => {
    asDistrict();
    await new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} }).init();

    const input = document.getElementById('unit-address-subdomain');
    input.value = 'www';
    document.getElementById('unit-address-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(mockAddUnitDomain).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('unit-address-subdomain-hint unit-address-subdomain-error');
    expect(document.getElementById('unit-address-subdomain-error').textContent).toBe('subdomain_reserved');
    expect(document.activeElement).toBe(input);

    input.value = 'meute-lea';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById('unit-address-subdomain-error')).toBeNull();
  });

  test('an address another unit holds is explained on the field', async () => {
    asDistrict();
    mockAddUnitDomain.mockRejectedValueOnce(Object.assign(new Error('subdomain_taken'), {
      status: 409, errors: [{ field: 'subdomain', msg: 'subdomain_taken' }]
    }));
    await new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} }).init();

    document.getElementById('unit-address-subdomain').value = 'meute-prise';
    document.getElementById('unit-address-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(document.getElementById('unit-address-subdomain-error').textContent).toBe('subdomain_taken');
  });

  test('another address can become the one emails use; the main one offers no removal', async () => {
    asDistrict();
    await new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} }).init();

    expect(addressItems()[0].querySelector('button')).toBeNull();
    const makePrimary = addressItems()[1].querySelector('[data-domain-primary]');
    expect(makePrimary.getAttribute('aria-label')).toBe('unit_addresses_make_primary_named');
    makePrimary.click();
    await flushPromises();

    expect(mockSetPrimaryUnitDomain).toHaveBeenCalledWith(7);
  });

  test('removing an address asks first, and declining changes nothing', async () => {
    asDistrict();
    await new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} }).init();

    mockConfirmDestructive.mockResolvedValueOnce(false);
    addressItems()[1].querySelector('[data-domain-remove]').click();
    await flushPromises();
    expect(mockRemoveUnitDomain).not.toHaveBeenCalled();

    addressItems()[1].querySelector('[data-domain-remove]').click();
    await flushPromises();
    expect(mockConfirmDestructive).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'unit_addresses_remove_title' }));
    expect(mockRemoveUnitDomain).toHaveBeenCalledWith(7);
  });

  test('a refused removal is explained and the address stays', async () => {
    asDistrict();
    mockRemoveUnitDomain.mockRejectedValueOnce(Object.assign(new Error('domain_last_address'), { status: 409 }));
    const app = { showMessage: jest.fn(), organizationSettings: {} };
    await new UnitSettings(app).init();

    const remove = addressItems()[1].querySelector('[data-domain-remove]');
    remove.click();
    await flushPromises();

    expect(app.showMessage).toHaveBeenCalledWith('api_error_conflict', 'error');
    expect(remove.disabled).toBe(false);
  });

  test('addresses that did not load are an alert with a retry, not an empty list', async () => {
    mockGetUnitDomains.mockRejectedValueOnce(new Error('offline'));
    await new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} }).init();

    expect(document.querySelector('#unit-addresses-title').parentElement.querySelector('[role="alert"]').textContent)
      .toBe('unit_addresses_load_failed');
    expect(document.body.textContent).not.toContain('unit_addresses_empty');

    document.getElementById('unit-addresses-retry').click();
    await flushPromises();
    expect(addressItems()).toHaveLength(2);
  });

  test('an address made of markup is shown as text', async () => {
    asDistrict();
    mockGetUnitDomains.mockResolvedValue({
      data: [{ id: 9, domain: '<img src=x onerror=alert(1)>', is_primary: false, is_wildcard: false }]
    });
    await new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} }).init();

    expect(document.querySelector('.unit-addresses-list img')).toBeNull();
    expect(document.querySelector('.unit-addresses-domain').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('the branch and address sections have no accessibility violations', async () => {
    asDistrict();
    await new UnitSettings({ showMessage: jest.fn(), organizationSettings: {} }).init();

    for (const id of ['unit-branch-title', 'unit-addresses-title']) {
      // eslint-disable-next-line no-await-in-loop -- axe runs one at a time
      const results = await axe.run(document.getElementById(id).closest('section'), AXE_OPTIONS);
      expect(results.violations).toEqual([]);
    }
  });
});
