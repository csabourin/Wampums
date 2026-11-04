/**
 * @jest-environment jsdom
 */

/**
 * The unit's camp plan templates (#1318): each stable section says whether it
 * is written, saves on its own with the version loaded, reports a refusal next
 * to itself, and the screen meets WCAG A/AA.
 *
 * @module test/spa/CampPlanTemplates
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true), isDemoUser: jest.fn(() => false) }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ hasActiveDialog: () => false, confirm: jest.fn(), prompt: jest.fn(), alert: jest.fn() }));
jest.mock('../../spa/api/api-camp-plans.js', () => ({ getCampPlanTemplates: jest.fn(), saveCampPlanTemplate: jest.fn() }));

const api = require('../../spa/api/api-camp-plans.js');
const { isDemoUser } = require('../../spa/utils/PermissionUtils.js');
const { CampPlanTemplates } = require('../../spa/modules/camp-plan/CampPlanTemplates.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const TEMPLATES = [
  { key: 'rules_of_life', body_html: '<p>Respect <em>everyone</em>.</p>', body_text: 'Respect everyone.', version: 2 },
  { key: 'camp_rules', body_html: null, body_text: null, version: 0 },
  { key: 'code_of_ethics', body_html: null, body_text: null, version: 0 },
  { key: 'emergency_procedures', body_html: null, body_text: null, version: 0 },
];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);
let app;
let screen;

async function open() {
  screen = new CampPlanTemplates(app);
  await screen.init();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  app = { showMessage: jest.fn(), lang: 'en' };
  api.getCampPlanTemplates.mockReset().mockResolvedValue({ success: true, data: TEMPLATES });
  api.saveCampPlanTemplate.mockReset();
  isDemoUser.mockReturnValue(false);
});

afterEach(() => screen?.destroy());

test('each template says whether it is written yet', async () => {
  await open();
  expect($('#camp-plan-template-block-rules_of_life .camp-plan__chip').textContent).toBe('camp_plan_state_written');
  expect($('#camp-plan-template-block-camp_rules .camp-plan__chip').textContent).toBe('camp_plan_state_to_write');
  expect($('#camp-plan-template-rules_of_life-text').innerHTML).toContain('<em>everyone</em>');
});

test('a template saves on its own with the version loaded', async () => {
  await open();
  const area = $('#camp-plan-template-camp_rules-text');
  area.innerHTML = '<p>Stay within the trees.</p>';
  $('#camp-plan-template-rules_of_life-text').innerHTML = '<p>Unsaved elsewhere</p>';
  api.saveCampPlanTemplate.mockResolvedValue({ success: true, data: { key: 'camp_rules', body_html: '<p>Stay within the trees.</p>', version: 1 } });
  $('#camp-plan-template-form-camp_rules').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(api.saveCampPlanTemplate).toHaveBeenCalledWith('camp_rules', { body_html: '<p>Stay within the trees.</p>', expected_version: 0 });
  expect(app.showMessage).toHaveBeenCalledWith('camp_plan_template_saved', 'success');
  expect($('#camp-plan-template-block-camp_rules .camp-plan__chip').textContent).toBe('camp_plan_state_written');
  expect($('#camp-plan-template-rules_of_life-text').innerHTML).toContain('Unsaved elsewhere');
  expect(document.activeElement).toBe($('#camp-plan-template-camp_rules-title'));
});

test('a refusal is shown next to its template, never as saved', async () => {
  await open();
  api.saveCampPlanTemplate.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409 }));
  $('#camp-plan-template-form-rules_of_life').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  const error = $('#camp-plan-template-rules_of_life-error');
  expect(error.hidden).toBe(false);
  expect(error.getAttribute('role')).toBe('alert');
  expect(app.showMessage).not.toHaveBeenCalled();
});

test('a demo account reads the templates without an editor', async () => {
  isDemoUser.mockReturnValue(true);
  await open();
  expect(document.querySelector('form')).toBeNull();
  expect($('#camp-plan-template-block-rules_of_life em').textContent).toBe('everyone');
});

test('a failed load is an alert with a retry', async () => {
  api.getCampPlanTemplates.mockRejectedValueOnce(new Error('fail'));
  await open();
  expect($('[role="alert"]')).not.toBeNull();
  $('#camp-plan-templates-retry').click();
  await flush();
  expect($('#camp-plan-template-form-camp_rules')).not.toBeNull();
});

test('the templates screen meets WCAG A/AA', async () => {
  await open();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});
