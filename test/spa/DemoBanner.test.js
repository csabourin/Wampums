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

beforeEach(() => {
  document.body.innerHTML = '<a class="skip-link" href="#app">Skip</a><div id="app"></div>';
});

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
    signInAs({ roles: ['demoadmin'], permissions: ['points.manage'] });
    initDemoBanner();

    const results = await axe.run(document.body, AXE_OPTIONS);

    expect(results.violations).toEqual([]);
  });
});
