/**
 * @jest-environment jsdom
 *
 * A demo visitor is told, on every screen, what they may try and what stays
 * read-only, so a refused change reads as part of the demo.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({
  app: {},
  translate: (key) => key,
}));

const axe = require('axe-core');
const { app } = require('../../spa/app.js');
const { initDemoBanner } = require('../../spa/modules/demo/DemoBanner.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

function signInAs({ roles, permissions = [], demoUnit = true }) {
  app.userRoles = roles;
  app.userPermissions = permissions;
  app.organizationSettings = { demo_sign_in: demoUnit };
}

function banner() {
  return document.getElementById('demo-banner');
}

const LEADER = ['points.manage', 'attendance.manage', 'attendance.view', 'honors.create', 'badges.view', 'activities.view'];

beforeEach(() => {
  document.body.innerHTML = '<a class="skip-link" href="#app">Skip</a><div id="app"></div>';
  localStorage.clear();
});

function missionLabels() {
  return Array.from(document.querySelectorAll('.demo-missions__check label')).map((label) => label.textContent.trim());
}

function tick(missionId) {
  const box = document.querySelector(`[data-demo-mission="${missionId}"]`);
  box.click();
  return box;
}

describe('the demo banner', () => {
  test('tells a demo leader which buttons work and that everything is reset at midnight', () => {
    signInAs({ roles: ['demoadmin'], permissions: ['points.manage', 'attendance.manage'] });

    initDemoBanner();

    expect(banner().textContent).toContain('demo_banner_title');
    expect(banner().textContent).toContain('demo_banner_sandbox');
    // Before the page, so it outlives every screen drawn into #app.
    expect(banner().nextElementSibling.id).toBe('app');
  });

  test('sends a demo parent to the leader view to try things', () => {
    signInAs({ roles: ['demoparent'] });

    initDemoBanner();

    expect(banner().textContent).toContain('demo_banner_parent');
  });

  test('a demo account in an ordinary unit is told it is read-only', () => {
    signInAs({ roles: ['demoadmin'], permissions: ['points.manage'], demoUnit: false });

    initDemoBanner();

    expect(banner().textContent).toContain('demo_banner_read_only');
  });

  test('shows nothing to an ordinary account, and leaves when a demo session does', () => {
    signInAs({ roles: ['demoadmin'] });
    initDemoBanner();
    signInAs({ roles: ['leader'], permissions: ['points.manage'] });

    initDemoBanner();

    expect(banner()).toBeNull();
  });

  test('drawing it twice keeps one banner', () => {
    signInAs({ roles: ['demoadmin'] });

    initDemoBanner();
    initDemoBanner();

    expect(document.querySelectorAll('#demo-banner')).toHaveLength(1);
  });

  test('has no WCAG A/AA violations', async () => {
    signInAs({ roles: ['demoadmin'], permissions: LEADER });
    initDemoBanner();

    const results = await axe.run(document.body, AXE_OPTIONS);

    expect(results.violations).toEqual([]);
  });
});

describe('the demo missions', () => {
  test('a demo leader gets the leader tour, each mission a link to its screen', () => {
    signInAs({ roles: ['demoadmin'], permissions: LEADER });

    initDemoBanner();

    expect(missionLabels()).toEqual([
      'demo_mission_points_title', 'demo_mission_attendance_title', 'demo_mission_honors_title',
      'demo_mission_badges_title', 'demo_mission_activities_title', 'demo_mission_parent_view_title',
    ]);
    const link = document.querySelector('.demo-missions__go');
    expect(link.getAttribute('href')).toBe('/manage-points');
    // "Go" alone would be ambiguous among six links.
    expect(link.textContent.replace(/\s+/g, ' ').trim()).toBe('demo_missions_go — demo_mission_points_title');
  });

  test('a mission whose screen the account cannot open is left out', () => {
    signInAs({ roles: ['demoadmin'], permissions: ['points.manage'] });

    initDemoBanner();

    expect(missionLabels()).not.toContain('demo_mission_badges_title');
    expect(missionLabels()).toContain('demo_mission_points_title');
  });

  test('a demo parent gets the family tour', () => {
    signInAs({ roles: ['demoparent'], permissions: ['activities.view'] });
    app.userFamilyRole = true;

    initDemoBanner();

    expect(missionLabels()).toEqual(expect.arrayContaining([
      'demo_mission_carpool_title', 'demo_mission_calendar_title', 'demo_mission_leader_view_title',
    ]));
    expect(missionLabels()).not.toContain('demo_mission_points_title');
    delete app.userFamilyRole;
  });

  test('a demo account in an ordinary unit gets no tour', () => {
    signInAs({ roles: ['demoadmin'], permissions: LEADER, demoUnit: false });

    initDemoBanner();

    expect(document.getElementById('demo-missions')).toBeNull();
  });

  test('ticking a mission counts it, says so, and is remembered on the next screen load', () => {
    signInAs({ roles: ['demoadmin'], permissions: LEADER });
    initDemoBanner();

    const box = tick('leader_points');

    expect(document.getElementById('demo-missions-count').textContent).toBe('1/6');
    expect(document.getElementById('demo-missions-progress').getAttribute('role')).toBe('status');
    expect(document.activeElement === box || document.activeElement === document.body).toBe(true);

    document.getElementById('demo-banner').remove();
    initDemoBanner();
    expect(document.querySelector('[data-demo-mission="leader_points"]').checked).toBe(true);
    expect(document.getElementById('demo-missions-count').textContent).toBe('1/6');
  });

  test('completing every mission awards the curious visitor badge', () => {
    signInAs({ roles: ['demoadmin'], permissions: LEADER });
    initDemoBanner();

    document.querySelectorAll('[data-demo-mission]').forEach((box) => box.click());

    expect(document.getElementById('demo-missions-progress').textContent).toBe('demo_missions_complete');
  });

  test('on a phone, the tour starts closed so the page stays in view', () => {
    window.matchMedia = jest.fn(() => ({ matches: false }));
    signInAs({ roles: ['demoadmin'], permissions: LEADER });

    initDemoBanner();

    expect(document.getElementById('demo-missions').open).toBe(false);
    expect(document.querySelector('#demo-missions summary').textContent).toContain('demo_missions_title');
  });

  test('on a wide screen, the tour opens on a first visit and stays closed once closed', () => {
    window.matchMedia = jest.fn(() => ({ matches: true }));
    signInAs({ roles: ['demoadmin'], permissions: LEADER });
    initDemoBanner();
    const details = document.getElementById('demo-missions');
    expect(details.open).toBe(true);

    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    document.getElementById('demo-banner').remove();
    initDemoBanner();

    expect(document.getElementById('demo-missions').open).toBe(false);
  });

  test('drawing the banner again does not stack its listeners', () => {
    signInAs({ roles: ['demoadmin'], permissions: LEADER });
    initDemoBanner();
    initDemoBanner();

    tick('leader_points');

    expect(JSON.parse(localStorage.getItem('demo_missions')).done).toEqual(['leader_points']);
    expect(document.getElementById('demo-missions-count').textContent).toBe('1/6');
  });

  test('a stored progress that is not what the tour wrote is ignored', () => {
    localStorage.setItem('demo_missions', '{"done": "<img src=x onerror=alert(1)>", "open": "yes"}');
    signInAs({ roles: ['demoadmin'], permissions: LEADER });

    initDemoBanner();

    expect(document.getElementById('demo-missions-count').textContent).toBe('0/6');
    expect(document.querySelector('#demo-banner img')).toBeNull();
  });
});
