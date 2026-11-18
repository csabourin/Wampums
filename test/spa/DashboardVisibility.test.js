/**
 * @jest-environment jsdom
 */

import axe from 'axe-core';

const mockPermissions = new Set();
let mockIsParent = true;
let mockAdminPanel = false;

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    ROLES: {
      DISTRICT: 'district',
      UNIT_ADMIN: 'unitadmin',
      ADMINISTRATION: 'administration',
      DEMO_ADMIN: 'demoadmin',
      FINANCE: 'finance',
      LEADER: 'leader',
      PARENT: 'parent',
      DEMO_PARENT: 'demoparent',
    },
  },
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  CONFIG: { ROLES: {} },
  getParticipants: jest.fn(),
  getGroups: jest.fn(),
  getCurrentOrganizationId: jest.fn(),
  getOrganizationSettings: jest.fn(),
}));

jest.mock('../../spa/api/api-endpoints.js', () => ({
  getAttendanceDates: jest.fn(),
  getAttendance: jest.fn(),
  getNextMeetingInfo: jest.fn(),
  getPermissionSlips: jest.fn(),
  getMedicationDistributions: jest.fn(),
}));

jest.mock('../../spa/api/api-programme.js', () => ({ getDayProgramme: jest.fn(() => Promise.resolve({ data: null })) }));
jest.mock('../../spa/api/api-activities.js', () => ({ getActivities: jest.fn() }));
jest.mock('../../spa/indexedDB.js', () => ({
  getCachedData: jest.fn(),
  setCachedData: jest.fn(),
  clearActivityRelatedCaches: jest.fn(),
}));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => { element.innerHTML = html; },
  loadStylesheet: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../spa/utils/SkeletonUtils.js', () => ({ skeletonDashboard: jest.fn(() => '') }));
jest.mock('../../spa/utils/DateUtils.js', () => ({
  getTodayISO: jest.fn(() => '2026-08-02'),
  formatDate: jest.fn((value) => value),
  formatDateRange: jest.fn((from, to) => `${from} – ${to}`),
}));
jest.mock('../../spa/utils/ParticipantRoleUtils.js', () => ({
  normalizeParticipantList: (participants) => participants,
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn((permission) => mockPermissions.has(permission)),
  hasAnyPermission: jest.fn((...permissions) => permissions.some((permission) => mockPermissions.has(permission))),
  canAccessAdminPanel: jest.fn(() => mockAdminPanel),
  canAccessParentTools: jest.fn(() => mockIsParent),
  canCreateOrganization: jest.fn(() => false),
  canSwitchUnits: jest.fn(() => false),
  canViewCarpools: jest.fn(() => false),
  canFollowPermissionSlips: jest.fn(() => !mockIsParent
    && ['activities.view', 'participants.view', 'groups.view'].every((permission) => mockPermissions.has(permission))),
  isParent: jest.fn(() => mockIsParent),
  holdsFamilyRole: jest.fn(() => mockIsParent),
}));
jest.mock('../../spa/utils/DashboardCacheManager.js', () => ({
  DashboardCacheManager: { preloadCachedData: jest.fn() },
}));
jest.mock('../../spa/modules/modals/CarpoolQuickAccessModal.js', () => ({ CarpoolQuickAccessModal: jest.fn() }));
// The device's choice for "Plan the year and the camps", kept between renders like localStorage would.
let mockPlanSectionOpen = null;
jest.mock('../../spa/utils/DashboardPreferences.js', () => ({
  applyPalette: jest.fn(),
  getDashboardPrefs: jest.fn(() => ({ hiddenTiles: [], collapsedToolGroups: [], planSectionOpen: mockPlanSectionOpen })),
  setCollapsedToolGroups: jest.fn(),
  setPlanSectionOpen: jest.fn((open) => { mockPlanSectionOpen = open; }),
}));
jest.mock('../../spa/modules/CommandPalette.js', () => ({
  CommandPalette: jest.fn().mockImplementation(() => ({
    attachGlobalShortcut: jest.fn(),
    setTiles: jest.fn(),
    detach: jest.fn(),
  })),
}));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: {} }));

import { Dashboard } from '../../spa/modules/dashboard/Dashboard.js';
import {
  DASHBOARD_TILES,
  FINANCE_WORKSPACE_EXTRA_TILES,
  TOOL_GROUP_ORDER,
} from '../../spa/config/dashboard-tiles.js';
import { DOMAINS, PALETTES } from '../../spa/config/dashboard-customization.js';
import customizationConfig from '../../config/unit_customization.json';
import { setOnlineCount } from '../../spa/modules/live-sync/OnlinePresence.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  mockPermissions.clear();
  mockPermissions.add('finance.view');
  mockIsParent = true;
  mockAdminPanel = false;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

test('finance workspace extras inherit their canonical feature visibility metadata', () => {
  expect(FINANCE_WORKSPACE_EXTRA_TILES).toEqual(expect.arrayContaining([
    expect.objectContaining({
      featureKey: 'parent_preview',
      href: '/parent-dashboard',
      parentOnly: true,
      gate: { check: 'parentTools' },
    }),
    expect.objectContaining({
      featureKey: 'account_info',
      href: '/account-info',
    }),
  ]));
});

test('finance workspace honors organization-hidden parent preview', () => {
  const dashboard = new Dashboard({ userRoles: ['parent'] }, { mode: 'finance-focused' });
  dashboard.isLoading = false;
  dashboard.organizationName = '<Unsafe Unit>';
  dashboard.organizationSettings = {
    dashboard_configuration: { hidden_tile_keys: ['parent_preview'] },
  };

  dashboard.render();

  expect(document.querySelector('a[href="/parent-dashboard"]')).toBeNull();
  expect(document.querySelector('a[href="/account-info"]')).not.toBeNull();
  expect(document.querySelector('h2').textContent).toBe('<Unsafe Unit>');
  expect(document.querySelector('h2').innerHTML).toBe('&lt;Unsafe Unit&gt;');
});

test('all dashboard destinations except authenticated account info declare an access gate', () => {
  const ungatedRoutes = DASHBOARD_TILES
    .filter((tile) => !tile.gate)
    .map((tile) => tile.href);

  expect(ungatedRoutes).toEqual(['/account-info']);
});

test('backend dashboard visibility keys match the current configurable tiles', () => {
  const tileFeatureKeys = Array.from(new Set(
    DASHBOARD_TILES.map((tile) => tile.featureKey).filter(Boolean),
  )).sort();

  expect([...customizationConfig.dashboardFeatureKeys].sort()).toEqual(tileFeatureKeys);
});

test('the news screen is offered to every member of the dashboard, not only to those who send messages', () => {
  const tile = DASHBOARD_TILES.find((candidate) => candidate.href === '/communication-history');

  expect(tile.gate).toEqual({ check: 'member' });
});

describe('tool groups separate weekly work from unit set-up', () => {
  const routesIn = (domain) => DASHBOARD_TILES
    .filter((tile) => tile.moment === 'tools' && tile.domain === domain)
    .map((tile) => tile.href);

  test('"Jeunes et familles" holds the reports', () => {
    expect(routesIn('people')).toEqual(expect.arrayContaining([
      '/reports',
      '/group-participant-report',
      '/progression',
    ]));
  });

  test('"see the app as a parent" checks what families see: it sits with my account and display, not the youth', () => {
    expect(routesIn('people')).not.toContain('/parent-dashboard');
    expect(routesIn('system')).toContain('/parent-dashboard');
  });

  test('"Administration de l\'unité" holds the settings changed a few times a year', () => {
    expect(routesIn('admin').sort()).toEqual([
      '/camp-plan-templates',
      '/communication-history',
      '/invitations',
      '/manage-groups',
      '/manage-participants',
      '/manage-users-participants',
      '/participant-duplicates',
      '/roles',
      '/unit-settings',
    ]);
  });

  test('families and leaders are invited from one tile, open to whoever may invite', () => {
    const tiles = DASHBOARD_TILES.filter((item) => /invitations/.test(item.href));
    expect(tiles.map((tile) => tile.href)).toEqual(['/invitations']);
    // Naming a team role also takes users.assign_roles; the page's role list says so.
    expect(tiles[0].gate).toEqual({ permission: 'users.invite' });
  });

  test('"Administration" holds my account and display first, then district and system tools', () => {
    const tiles = DASHBOARD_TILES.filter((tile) => tile.domain === 'system');
    expect(tiles.map((tile) => tile.href))
      .toEqual(['/account-info', '/display-settings', '/parent-dashboard', '/district', '/create-organization', '/units']);
    expect(tiles.every((tile) => tile.href === '/account-info' || tile.gate)).toBe(true);
  });

  test('the new group renders last and every palette colors it', () => {
    expect(TOOL_GROUP_ORDER.slice(-2)).toEqual(['admin', 'system']);
    expect(DOMAINS).toContain('system');
    Object.values(PALETTES).forEach((palette) => {
      expect(palette.domains.system).toEqual(expect.objectContaining({
        bg: expect.any(String), fg: expect.any(String), accent: expect.any(String),
      }));
    });
  });
});

describe('tiles follow the permissions their page acts on', () => {
  const renderAs = (permissions, { adminPanel = true } = {}) => {
    mockPermissions.clear();
    permissions.forEach((permission) => mockPermissions.add(permission));
    mockAdminPanel = adminPanel;
    mockIsParent = false;
    const dashboard = new Dashboard({ userRoles: ['leader'] });
    dashboard.isLoading = false;
    dashboard.organizationSettings = {};
    dashboard.render();
    const group = (domain) => document.querySelector(`.dashboard-v2__group[data-group="${domain}"]`);
    const has = (href) => document.querySelector(`a[href="${href}"]`) !== null;
    return { group, has };
  };

  test('an ordinary leader sees only "Mon compte" and "Affichage" under Administration', () => {
    const { group } = renderAs(['participants.view', 'reports.view'], { adminPanel: false });
    const links = Array.from(group('system').querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/account-info', '/display-settings']);
    expect(group('people').querySelector('a[href="/reports"]')).not.toBeNull();
  });

  test('roles, role permissions and form access share one tile, shown to whoever can open one of its tabs', () => {
    expect(renderAs(['participants.view'], { adminPanel: false }).has('/roles')).toBe(false);
    expect(renderAs(['roles.view']).has('/roles')).toBe(true);
    expect(renderAs(['roles.manage']).has('/roles')).toBe(true);
    expect(renderAs(['users.view', 'users.assign_roles']).has('/roles')).toBe(true);
    // Form access needs forms.manage, not just admin-panel access.
    expect(renderAs(['users.view']).has('/roles')).toBe(false);
    expect(renderAs(['users.view', 'forms.manage']).has('/roles')).toBe(true);
    expect(renderAs(['forms.manage'], { adminPanel: false }).has('/roles')).toBe(false);
  });

  test('the former role and form tiles are gone from the dashboard', () => {
    const { has } = renderAs(['roles.view', 'roles.manage', 'users.view', 'users.assign_roles', 'forms.manage']);
    expect(has('/roles')).toBe(true);
    ['/role-management', '/roles/permissions', '/form-permissions'].forEach((href) => expect(has(href)).toBe(false));
  });

  test('unit settings need a permission the page uses', () => {
    expect(renderAs(['users.view']).has('/unit-settings')).toBe(false);
    expect(renderAs(['org.view']).has('/unit-settings')).toBe(true);
    expect(renderAs(['communications.send']).has('/unit-settings')).toBe(true);
    expect(renderAs(['org.edit'], { adminPanel: false }).has('/unit-settings')).toBe(false);
  });

  test('the permission-slip tile needs every read its page makes, not participants.view alone', () => {
    expect(renderAs(['participants.view']).has('/permission-slips')).toBe(false);
    expect(renderAs(['activities.view', 'participants.view', 'groups.view']).has('/permission-slips')).toBe(true);
  });

  test('the honors tile needs the honors its page reads, not points rights alone', () => {
    expect(renderAs(['points.manage']).has('/manageHonors')).toBe(false);
    expect(renderAs(['honors.view']).has('/manageHonors')).toBe(true);
  });

  test('the honors route is guarded by the same honors permission', () => {
    const fs = require('fs');
    const path = require('path');
    const router = fs.readFileSync(path.join(__dirname, '../../spa/router.js'), 'utf8');
    expect(router).toMatch(/case 'manageHonors':[^}]*if \(!guard\(canViewHonors\(\)\)\)/);
  });

  test('unit set-up tiles land in "Administration de l\'unité"', () => {
    const { group } = renderAs(['users.invite', 'users.view', 'participants.edit', 'groups.view']);
    const links = Array.from(group('admin').querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/manage-groups',
      '/invitations',
      '/manage-users-participants',
      '/participant-duplicates',
      '/communication-history',
    ]);
  });
});

describe('tool groups stay accessible', () => {
  const renderAdmin = () => {
    ['participants.view', 'reports.view', 'org.view', 'users.view', 'roles.view', 'forms.manage']
      .forEach((permission) => mockPermissions.add(permission));
    mockAdminPanel = true;
    mockIsParent = false;
    const dashboard = new Dashboard({ userRoles: ['leader'] });
    dashboard.isLoading = false;
    dashboard.organizationSettings = {};
    dashboard.render();
    dashboard.attachEventListeners();
    return dashboard;
  };

  test('each group toggle is a native button named after its group', () => {
    renderAdmin();
    const toggles = Array.from(document.querySelectorAll('.dashboard-v2__group-toggle'));
    const names = toggles.map((button) => button.textContent.trim());
    expect(names).toEqual(expect.arrayContaining([
      'domain_people',
      'domain_admin',
      'domain_system',
    ]));
    toggles.forEach((button) => {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(['true', 'false']).toContain(button.getAttribute('aria-expanded'));
    });
  });

  test('activating a toggle flips aria-expanded and the collapsed state', () => {
    renderAdmin();
    const group = document.querySelector('.dashboard-v2__group[data-group="admin"]');
    const toggle = group.querySelector('.dashboard-v2__group-toggle');
    const before = toggle.getAttribute('aria-expanded');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe(before === 'true' ? 'false' : 'true');
    expect(group.getAttribute('data-collapsed')).toBe(before);
  });

  test('"Administration" is open on first visit so "Mon compte" is one tap away', () => {
    renderAdmin();
    const toggle = document.querySelector('.dashboard-v2__group[data-group="system"] .dashboard-v2__group-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  test('a tile count is read with its number, not only its unit', () => {
    const dashboard = renderAdmin();
    dashboard.participants = [{ id: 1 }, { id: 2 }];
    dashboard.render();

    const tile = document.querySelector('a[href="/parent-contact-list"]');
    const count = tile.querySelector('.dashboard-v2__tile-stat');
    expect(count.hasAttribute('aria-label')).toBe(false);
    expect(count.textContent.replace(/\s+/g, ' ').trim()).toBe('2 contacts_short');
  });

  test('a count of one is read in the singular: "1 contact", not "1 contacts"', () => {
    const dashboard = renderAdmin();
    dashboard.participants = [{ id: 1 }];
    dashboard.render();

    const stat = (href) => document.querySelector(`a[href="${href}"] .dashboard-v2__tile-stat`)
      .textContent.replace(/\s+/g, ' ').trim();
    expect(stat('/parent-contact-list')).toBe('1 contacts_short_one');
    expect(stat('/manage-participants')).toBe('1 participants_short_one');
  });

  test('the page is titled by the unit\'s name, as its only <h1>', () => {
    const dashboard = renderAdmin();
    dashboard.organizationName = '6e Meute <img src=x onerror=alert(1)>';
    dashboard.render();

    const headings = document.querySelectorAll('#app h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('6e Meute <img src=x onerror=alert(1)>');
    expect(document.querySelector('#app img[src="x"]')).toBeNull();
  });

  test('a unit without a name still gets a page title', () => {
    const dashboard = renderAdmin();
    dashboard.organizationName = '';
    dashboard.render();

    expect(document.querySelector('#app h1').textContent).toBe('dashboard_title');
  });

  test('the colour choice is a tile beside "Mon compte", not a button in the page header', () => {
    const dashboard = renderAdmin();
    expect(document.querySelector('.dashboard-v2__topbar button')).toBeNull();
    const tile = document.querySelector('.dashboard-v2__group[data-group="system"] a[href="/display-settings"]');
    expect(tile.textContent.trim()).toBe('tile_display_settings');

    dashboard.organizationSettings = { dashboard_configuration: { hidden_tile_keys: ['display_settings'] } };
    dashboard.render();
    expect(document.querySelector('a[href="/display-settings"]')).toBeNull();
  });

  test('the tool section has no WCAG A/AA violations', async () => {
    renderAdmin();
    const results = await axe.run(document.querySelector('#moment-tools').closest('section'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // jsdom does no layout, so contrast cannot be computed here.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});

describe('planning the year and the camps has its own section, after this week', () => {
  const renderPlanner = () => {
    ['meetings.view', 'meetings.manage', 'activities.view', 'volunteers.view', 'inventory.view', 'tasks.view',
      'camp_plan_templates.manage'].forEach((permission) => mockPermissions.add(permission));
    mockIsParent = false;
    const dashboard = new Dashboard({ userRoles: ['leader'] });
    dashboard.isLoading = false;
    dashboard.organizationSettings = {};
    dashboard.render();
    return dashboard;
  };
  const sectionOf = (href) => document.querySelector(`a[href="${href}"]`)?.closest('section')?.querySelector('h2')?.id;

  test('the section follows "This week" and comes before everything else', () => {
    renderPlanner();
    const ids = Array.from(document.querySelectorAll('.dashboard-v2__section-title')).map((heading) => heading.id);
    expect(ids.indexOf('moment-plan')).toBe(ids.indexOf('moment-week') + 1);
    expect(ids.indexOf('moment-plan')).toBeLessThan(ids.indexOf('moment-tools'));
    expect(document.querySelector('#moment-plan').textContent).toBe('dashboard_plan_section');
  });

  test('it holds the year planner, activities, camp plans and sites, equipment reservations, carpooling and volunteering, in that order', () => {
    renderPlanner();
    const hrefs = Array.from(document.querySelectorAll('#dashboard-plan-body a')).map((tile) => tile.getAttribute('href'));
    expect(hrefs).toEqual(['/yearly-planner', '/activities', '/camp-plans', '/camp-sites', '/material-management', '/volunteers']);
    // The templates are written once, with the unit's other settings.
    expect(document.querySelector('.dashboard-v2__group[data-group="admin"] a[href="/camp-plan-templates"]')).not.toBeNull();
    // This week keeps what is done this week.
    expect(sectionOf('/tasks')).toBe('moment-week');
    expect(sectionOf('/equipment-loans')).toBe('moment-tools');
  });

  test('volunteering has one entry: with the volunteer space, no separate Volunteering tile', () => {
    mockPermissions.add('volunteer_space.view');
    renderPlanner();
    expect(document.querySelector('a[href="/volunteers"]')).toBeNull();
    expect(sectionOf('/volunteer-space')).toBe('moment-week');
  });

  test('every planning tile is gated, and the camp plans open with the permission each plan needs', () => {
    const planning = DASHBOARD_TILES.filter((tile) => tile.moment === 'plan');
    expect(planning.map((tile) => tile.href)).toEqual(expect.arrayContaining(['/carpool', '/camp-plans']));
    expect(planning.every((tile) => tile.gate)).toBe(true);
    expect(DASHBOARD_TILES.find((tile) => tile.href === '/camp-plans').gate).toEqual({ permission: 'meetings.view' });
  });

  test('someone with no planning right sees no empty planning section', () => {
    mockIsParent = false;
    const dashboard = new Dashboard({ userRoles: ['leader'] });
    dashboard.isLoading = false;
    dashboard.organizationSettings = {};
    dashboard.render();
    expect(document.querySelector('#moment-plan')).toBeNull();
  });

  test('the planning section has no WCAG A/AA violations', async () => {
    renderPlanner();
    const results = await axe.run(document.querySelector('#moment-plan').closest('section'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});

describe('a shorter leaders\' dashboard (#1430)', () => {
  const render = (permissions, { camps = [] } = {}) => {
    permissions.forEach((permission) => mockPermissions.add(permission));
    mockIsParent = false;
    const dashboard = new Dashboard({ userRoles: ['leader'], lang: 'fr' });
    dashboard.isLoading = false;
    dashboard.organizationSettings = {};
    dashboard.upcomingCamps = camps;
    dashboard.render();
    return dashboard;
  };
  const PLANNER = ['meetings.view', 'meetings.manage', 'activities.view', 'volunteers.view', 'inventory.view', 'tasks.view'];
  const HELPER = ['meetings.view', 'activities.view', 'inventory.view', 'tasks.view'];
  const toggle = () => document.getElementById('dashboard-plan-toggle');
  const body = () => document.getElementById('dashboard-plan-body');

  beforeEach(() => {
    mockPermissions.clear();
    mockPlanSectionOpen = null;
  });

  test('planning tiles are compact, like the tools below them', () => {
    render(PLANNER);
    const tiles = [...body().querySelectorAll('a')];
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((tile) => tile.classList.contains('dashboard-v2__tile--sm'))).toBe(true);
    // This week keeps its large tiles.
    expect(document.querySelector('#moment-week').closest('section').querySelector('.dashboard-v2__tile--sm')).toBeNull();
  });

  test('planning is open for those who plan, folded for everyone else', () => {
    render(PLANNER);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(body().hidden).toBe(false);

    mockPermissions.clear();
    render(HELPER);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe('dashboard-plan-body');
    expect(body().hidden).toBe(true);
    expect(document.getElementById('moment-plan').textContent).toBe('dashboard_plan_section');
  });

  test('a leader unfolds planning from the keyboard, and the device remembers it', () => {
    const dashboard = render(HELPER);
    dashboard.attachEventListeners();
    toggle().focus();
    expect(document.activeElement).toBe(toggle());
    // Enter or Space on a native button is a click.
    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(body().hidden).toBe(false);
    dashboard.destroy();

    render(HELPER);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(body().hidden).toBe(false);
  });

  test('folded sections still open while an archived year is consulted: their toggles only show links', () => {
    render(HELPER);
    const toggles = [toggle(), ...document.querySelectorAll('.dashboard-v2__group-toggle')];
    expect(toggles.length).toBeGreaterThan(1);
    expect(toggles.every((button) => button.hasAttribute('data-archive-safe'))).toBe(true);
  });

  test('one heading level for every section, in one style; the camps coming up are a card of this week', () => {
    render(PLANNER, { camps: [{ id: 3, theme: 'Camp d’hiver', date_from: '2026-12-04', date_to: '2026-12-06' }] });
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    const sections = [...document.querySelectorAll('.dashboard-v2 h2')];
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((heading) => heading.classList.contains('dashboard-v2__section-title'))).toBe(true);
    const camps = document.getElementById('dashboard-team-camps');
    expect(camps.closest('section').querySelector('h2').id).toBe('moment-week');
    expect(camps.querySelector('h3').textContent).toBe('camp_readiness_upcoming_title');
  });

  test('with planning folded, the dashboard has no WCAG A/AA violations', async () => {
    render(HELPER, { camps: [{ id: 3, theme: '<img src=x onerror=alert(1)>', date_from: '2026-12-04', date_to: '2026-12-06' }] });
    expect(document.querySelector('#app img')).toBeNull();
    const results = await axe.run(document.querySelector('.dashboard-v2'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});

describe('administrators see, live, how many accounts are online', () => {
  const renderLeader = (permissions) => {
    permissions.forEach((permission) => mockPermissions.add(permission));
    mockIsParent = false;
    const dashboard = new Dashboard({ userRoles: ['leader'], lang: 'en' });
    dashboard.isLoading = false;
    dashboard.organizationSettings = {};
    dashboard.render();
    dashboard._watchOnlineCount();
    return dashboard;
  };
  const label = () => document.getElementById('dashboard-online-count');

  afterEach(() => setOnlineCount(null));

  test('the count sits in the banner and follows accounts as they come and go', () => {
    setOnlineCount(3);
    const dashboard = renderLeader(['users.view_online']);

    expect(document.querySelector('.dashboard-v2__topbar #dashboard-online-count')).not.toBeNull();
    expect(label().hidden).toBe(false);
    expect(label().textContent).toBe('dashboard_online_count_other');

    setOnlineCount(1);
    expect(label().textContent).toBe('dashboard_online_count_one');

    // Disconnected, the count is no longer live: it is hidden, not left stale.
    setOnlineCount(null);
    expect(label().hidden).toBe(true);

    dashboard.destroy();
    setOnlineCount(2);
    expect(label().hidden).toBe(true);
  });

  test('without the permission, the banner shows no count', () => {
    setOnlineCount(4);
    renderLeader(['participants.view']);

    expect(label()).toBeNull();
  });

  test('the banner with its count has no WCAG A/AA violations', async () => {
    setOnlineCount(2);
    renderLeader(['users.view_online']);
    const results = await axe.run(document.querySelector('.dashboard-v2__topbar'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // jsdom does no layout, so contrast cannot be computed here.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
