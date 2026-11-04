/**
 * @jest-environment jsdom
 */

/**
 * The unit's camp plans: coming camps first, each saying in words what its
 * plan still lacks and leading to its plan, site and overview; no camp says
 * where to add one; a failed load offers a retry; names are shown as text; the
 * screen meets WCAG A/AA.
 *
 * @module test/spa/CampPlans
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true), isDemoUser: jest.fn(() => false), hasOrganizationScope: jest.fn(() => true) }));
jest.mock('../../spa/api/api-camp-plans.js', () => ({ getCampPlans: jest.fn() }));

const { getCampPlans } = require('../../spa/api/api-camp-plans.js');
const { hasPermission, hasOrganizationScope } = require('../../spa/utils/PermissionUtils.js');
const { CampPlans } = require('../../spa/modules/camp-plan/CampPlans.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);
let screen;

async function open() {
  screen = new CampPlans({ lang: 'fr' });
  await screen.init();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  hasPermission.mockImplementation(() => true);
  hasOrganizationScope.mockReturnValue(true);
  getCampPlans.mockReset().mockResolvedValue({ success: true, data: {
    coming: [
      { id: 12, theme: 'Camp d’été', date_from: '2027-07-10', date_to: '2027-07-17', to_write: 3, to_review: 1 },
      { id: 14, theme: '<img src=x onerror=alert(1)>', date_from: '2027-10-01', date_to: '2027-10-03', to_write: 0, to_review: 0 },
    ],
    past: [{ id: 9, theme: 'Camp d’hiver', date_from: '2026-02-13', date_to: '2026-02-15', to_write: 0, to_review: 0 }],
  } });
});

afterEach(() => screen?.destroy());

test('coming camps come first, each saying what its plan still lacks and leading to its plan, site and overview', async () => {
  await open();
  expect($('#app .page').firstElementChild.matches('.back-link, a, nav')).toBe(true);
  const groups = Array.from(document.querySelectorAll('.camp-plans__group h2')).map((heading) => heading.textContent);
  expect(groups).toEqual(['camp_plans_coming', 'camp_plans_past']);
  const first = document.querySelector('.camp-plans__camp');
  expect(first.textContent).toContain('camp_readiness_left_plan');
  expect(first.textContent).toContain('camp_readiness_left_plan_review');
  expect(first.classList.contains('is-attention')).toBe(true);
  expect(Array.from(first.querySelectorAll('a')).map((link) => link.getAttribute('href')))
    .toEqual(['/camp-plan/12', '/camp-site/12', '/camp-readiness/12']);
  expect(document.querySelectorAll('.camp-plans__camp')[1].textContent).toContain('camp_plan_all_written');
});

test('someone who sees only their own children is not offered the team overview, which would refuse them', async () => {
  hasOrganizationScope.mockReturnValue(false);
  await open();
  const links = Array.from(document.querySelector('.camp-plans__camp').querySelectorAll('a')).map((link) => link.getAttribute('href'));
  expect(links).toEqual(['/camp-plan/12', '/camp-site/12']);
});

test('a camp’s name is shown as text, and names each of its links', async () => {
  await open();
  const second = document.querySelectorAll('.camp-plans__camp')[1];
  expect(second.querySelector('img')).toBeNull();
  expect(second.querySelector('h3').textContent).toBe('<img src=x onerror=alert(1)>');
  expect(second.querySelector('a').textContent).toContain('<img src=x onerror=alert(1)>');
});

test('with no camp planned, the screen says where to add one', async () => {
  getCampPlans.mockResolvedValue({ success: true, data: { coming: [], past: [] } });
  await open();
  expect($('.camp-plan__empty').textContent).toBe('camp_plans_empty');
  expect($('a[href="/yearly-planner"]')).not.toBeNull();
});

test('the link to the unit’s templates is offered only to whoever may write them', async () => {
  hasPermission.mockImplementation((key) => key === 'meetings.view');
  await open();
  expect($('a[href="/camp-plan-templates"]')).toBeNull();
});

test('a failed load is an alert with a retry, never "no camp"', async () => {
  getCampPlans.mockRejectedValueOnce(new Error('fail'));
  await open();
  expect($('[role="alert"]')).not.toBeNull();
  expect($('.camp-plan__empty')).toBeNull();
  $('#camp-plans-retry').click();
  await flush();
  expect(document.querySelectorAll('.camp-plans__camp')).toHaveLength(3);
});

test('a late answer does not draw over the next screen', async () => {
  let resolve;
  getCampPlans.mockReturnValue(new Promise((done) => { resolve = done; }));
  screen = new CampPlans({ lang: 'fr' });
  const loading = screen.init();
  screen.destroy();
  document.getElementById('app').innerHTML = '<p id="next">Next</p>';
  resolve({ success: true, data: { coming: [], past: [] } });
  await loading;
  expect($('#next')).not.toBeNull();
});

test('the screen meets WCAG A/AA', async () => {
  await open();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});
