/**
 * @jest-environment jsdom
 */

/**
 * The camp plan's written sections (#1318).
 *
 * Held here: every section and the bad-weather games say when they are still
 * to write; a stable section says whether it shows the unit's template or a
 * text modified for this camp; someone who may only look sees text, no editor;
 * a section saves with the version loaded and redraws alone, keeping what is
 * typed elsewhere; going back to the template asks first; a refusal is shown
 * by its section, never as saved; games are added, reordered and removed with
 * buttons; the unit's point rules are recalled; names are shown as text; the
 * screen meets WCAG A/AA; a late answer does not draw over the next screen.
 *
 * @module test/spa/CampPlan
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn(() => true),
  isDemoUser: jest.fn(() => false),
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  hasActiveDialog: () => false, confirm: jest.fn(), prompt: jest.fn(), alert: jest.fn(),
}));
jest.mock('../../spa/api/api-camp-plans.js', () => ({
  getCampPlan: jest.fn(), saveCampPlanSection: jest.fn(), saveCampPlanRainGames: jest.fn(),
  getCampPlanTemplates: jest.fn(), saveCampPlanTemplate: jest.fn(),
}));
jest.mock('../../spa/api/api-yearly-planner.js', () => ({ getActivityLibrary: jest.fn() }));

const api = require('../../spa/api/api-camp-plans.js');
const { getActivityLibrary } = require('../../spa/api/api-yearly-planner.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
const { confirm } = require('../../spa/utils/DialogUtils.js');
const { CampPlan } = require('../../spa/modules/camp-plan/CampPlan.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const KEYS = ['vcpref_wanted', 'vcpref_chosen', 'vcpref_prepared', 'vcpref_realized', 'vcpref_evaluated', 'vcpref_celebrated',
  'theme', 'motivation', 'rules_of_life', 'camp_rules', 'code_of_ethics', 'emergency_procedures'];
const UNIT = ['rules_of_life', 'camp_rules', 'code_of_ethics', 'emergency_procedures'];

/** @returns {Object} One section as the server answers it */
function section(key, overrides = {}) {
  return {
    key, unit_section: UNIT.includes(key), source: 'empty', modified_for_camp: false, body_html: null, body_text: null,
    needs_review: false, version: 0, template_version: UNIT.includes(key) ? 0 : null, template_html: null, ...overrides,
  };
}

/** @returns {Object} A camp plan with a theme written, rules from the unit and modified rules */
function plan(overrides = {}) {
  const sections = KEYS.map((key) => section(key));
  const set = (key, values) => { sections[KEYS.indexOf(key)] = section(key, values); };
  set('theme', { source: 'camp', body_html: '<p>The <strong>lost</strong> forest</p>', body_text: 'The lost forest', version: 2 });
  set('rules_of_life', { source: 'template', body_html: '<p>Respect everyone.</p>', template_html: '<p>Respect everyone.</p>', template_version: 3 });
  set('camp_rules', { source: 'camp', modified_for_camp: true, body_html: '<p>Lake rules</p>', version: 1, template_html: '<p>Unit rules</p>', template_version: 1 });
  set('vcpref_wanted', { source: 'camp', needs_review: true, body_html: '<p>Voted in May</p>', version: 1 });
  return {
    camp: { id: 12, theme: 'Camp d’été', date_from: '2027-07-10', date_to: '2027-07-17', is_cancelled: false },
    sections,
    rain_games: [
      { id: 31, name: 'Fictional relay', description: 'Two teams.', material: 'Ball', estimated_duration_min: 20, estimated_duration_max: 30, is_active: true },
      { id: 32, name: '<img src=x onerror=alert(1)>', description: null, material: null, estimated_duration_min: null, estimated_duration_max: null, is_active: false },
    ],
    motivation: { attendance_present: 1, honor_award: 5, badge_earn: 0, badge_level_up: 10 },
    gaps: { to_write: ['vcpref_chosen', 'motivation'], to_review: ['vcpref_wanted'] },
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);
let app;
let screen;

async function open() {
  screen = new CampPlan(app, { meetingId: 12 });
  await screen.init();
  await flush();
  return screen;
}

/** Type into a section's editor, as the editor's input would. */
function type(key, html) {
  const area = $(`#camp-plan-${key}-text`);
  area.innerHTML = html;
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  window.history.replaceState(null, '', '/camp-plan/12');
  document.body.innerHTML = '<main id="app"></main>';
  app = { showMessage: jest.fn(), lang: 'fr' };
  Object.values(api).forEach((fn) => fn.mockReset());
  getActivityLibrary.mockReset();
  confirm.mockReset();
  api.getCampPlan.mockResolvedValue({ success: true, data: plan() });
  getActivityLibrary.mockResolvedValue({ success: true, data: [{ id: 31, name: 'Fictional relay' }, { id: 33, name: 'Fictional quiz' }] });
  hasPermission.mockReset();
  hasPermission.mockImplementation(() => true);
});

afterEach(() => {
  screen?.destroy();
});

test('the plan opens with the way back, then says what is still to do', async () => {
  await open();
  const page = $('#app .page');
  expect(page.firstElementChild.matches('.back-link, a, nav')).toBe(true);
  expect($('h1').textContent).toBe('camp_plan_title');
  const summary = $('#camp-plan-summary').textContent;
  expect(summary).toContain('camp_plan_left');
  expect(summary).toContain('camp_readiness_left_plan');
  expect(summary).toContain('camp_readiness_left_plan_review');
});

test('one part is shown at a time; the quick navigation says, in words, what each part still lacks', async () => {
  await open();
  const nav = $('nav#camp-plan-nav');
  expect(nav.getAttribute('aria-label')).toBe('camp_plan_nav_label');
  const buttons = [...nav.querySelectorAll('button')];
  expect(buttons.map((button) => button.dataset.campPlanPart)).toEqual(['vcpref', 'story', 'unit', 'rain']);
  expect(buttons[0].getAttribute('aria-current')).toBe('step');
  // V.C.P.R.E.F.: one to write, one to reread; story: motivation to write; rules: complete.
  expect(buttons[0].textContent).toContain('camp_readiness_left_plan');
  expect(buttons[0].textContent).toContain('camp_readiness_left_plan_review');
  expect(buttons[2].textContent).toContain('camp_plan_part_done');
  expect(buttons[2].classList.contains('is-attention')).toBe(false);
  const visible = () => [...document.querySelectorAll('[data-camp-plan-panel]')].filter((panel) => !panel.hidden).map((panel) => panel.dataset.campPlanPanel);
  expect(visible()).toEqual(['vcpref']);
});

test('choosing a part shows it, moves focus to its heading and keeps it in the address, keeping unsaved text elsewhere', async () => {
  await open();
  type('vcpref_chosen', '<p>Unsaved choice</p>');
  $('#camp-plan-nav [data-camp-plan-part="unit"]').click();
  expect(document.activeElement).toBe($('#camp-plan-group-unit'));
  expect($('[data-camp-plan-panel="unit"]').hidden).toBe(false);
  expect($('[data-camp-plan-panel="vcpref"]').hidden).toBe(true);
  expect($('#camp-plan-nav [data-camp-plan-part="unit"]').getAttribute('aria-current')).toBe('step');
  expect($('#camp-plan-nav [data-camp-plan-part="vcpref"]').hasAttribute('aria-current')).toBe(false);
  expect(window.location.search).toBe('?part=unit');

  // The pager at the end of a part leads to the next and previous parts.
  $('[data-camp-plan-panel="unit"] .camp-plan__pager-next').click();
  expect($('[data-camp-plan-panel="rain"]').hidden).toBe(false);
  $('[data-camp-plan-panel="rain"] [data-camp-plan-part="unit"]').click();
  $('[data-camp-plan-panel="unit"] [data-camp-plan-part="story"]').click();
  $('[data-camp-plan-panel="story"] [data-camp-plan-part="vcpref"]').click();
  expect($('#camp-plan-vcpref_chosen-text').innerHTML).toContain('Unsaved choice');
  expect($('[data-camp-plan-panel="vcpref"] [data-camp-plan-part="story"]').textContent).toContain('camp_plan_next_part');
});

test('a link naming a part opens the plan on it', async () => {
  window.history.replaceState(null, '', '/camp-plan/12?part=rain');
  await open();
  expect($('[data-camp-plan-panel="rain"]').hidden).toBe(false);
  expect($('#camp-plan-nav [data-camp-plan-part="rain"]').getAttribute('aria-current')).toBe('step');
  window.history.replaceState(null, '', '/camp-plan/12?part=unknown');
  screen.destroy();
  await open();
  expect($('[data-camp-plan-panel="vcpref"]').hidden).toBe(false);
});

test('each section says where its text comes from, in words', async () => {
  await open();
  const chip = (key) => $(`#camp-plan-block-${key} .camp-plan__chip`).textContent;
  expect(chip('vcpref_chosen')).toBe('camp_plan_state_to_write');
  expect(chip('vcpref_wanted')).toBe('camp_plan_state_to_review');
  expect(chip('theme')).toBe('camp_plan_state_written');
  expect(chip('rules_of_life')).toBe('camp_plan_state_template');
  expect(chip('camp_rules')).toBe('camp_plan_state_modified');
  // Only a text modified for this camp offers to go back to the template.
  expect($('#camp-plan-block-camp_rules [data-camp-plan-revert]')).not.toBeNull();
  expect($('#camp-plan-block-rules_of_life [data-camp-plan-revert]')).toBeNull();
});

test('the unit’s point rules are recalled under the motivation system, leaving out what gives none', async () => {
  await open();
  const reminder = $('#camp-plan-motivation-reminder').textContent;
  expect(reminder).toContain('camp_plan_motivation_attendance');
  expect(reminder).toContain('camp_plan_motivation_honor');
  expect(reminder).toContain('camp_plan_motivation_badge_level');
  expect(reminder).not.toMatch(/camp_plan_motivation_badge(?!_level)/);
});

test('someone who may only look reads the texts and sees no editor', async () => {
  hasPermission.mockImplementation((key) => key === 'meetings.view');
  await open();
  expect(document.querySelector('.rte')).toBeNull();
  expect(document.querySelector('form')).toBeNull();
  expect($('#camp-plan-block-theme strong').textContent).toBe('lost');
  expect($('#camp-plan-block-vcpref_chosen .camp-plan__empty').textContent).toBe('camp_plan_state_to_write');
  expect(getActivityLibrary).not.toHaveBeenCalled();
});

test('saving a section sends its text with the version loaded and redraws it alone, keeping text typed elsewhere', async () => {
  await open();
  type('motivation', '<p>Unsaved motivation</p>');
  type('theme', '<p>The <b>found</b> forest</p>');
  api.saveCampPlanSection.mockResolvedValue({ success: true, data: {
    section: section('theme', { source: 'camp', body_html: '<p>The <strong>found</strong> forest</p>', version: 3 }),
    gaps: { to_write: ['vcpref_chosen'], to_review: [] },
  } });
  $('#camp-plan-form-theme').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();

  expect(api.saveCampPlanSection).toHaveBeenCalledWith(12, 'theme', { body_html: '<p>The <b>found</b> forest</p>', expected_version: 2 });
  expect(app.showMessage).toHaveBeenCalledWith('camp_plan_saved', 'success');
  expect($('#camp-plan-motivation-text').innerHTML).toContain('Unsaved motivation');
  expect(document.activeElement).toBe($('#camp-plan-theme-title'));
  expect($('#camp-plan-summary').textContent).not.toContain('camp_readiness_left_plan_review');
  // The quick navigation follows what was saved.
  expect($('#camp-plan-nav [data-camp-plan-part="vcpref"]').textContent).not.toContain('camp_readiness_left_plan_review');
});

test('saving the unit’s template unchanged does not make it “modified for this camp”', async () => {
  await open();
  $('#camp-plan-form-rules_of_life').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(api.saveCampPlanSection).not.toHaveBeenCalled();
  expect(app.showMessage).toHaveBeenCalledWith('camp_plan_unchanged', 'info');
});

test('going back to the unit’s template asks first; declining changes nothing', async () => {
  await open();
  confirm.mockResolvedValueOnce(false);
  $('#camp-plan-block-camp_rules [data-camp-plan-revert]').click();
  await flush();
  expect(api.saveCampPlanSection).not.toHaveBeenCalled();

  confirm.mockResolvedValueOnce(true);
  api.saveCampPlanSection.mockResolvedValue({ success: true, data: {
    section: section('camp_rules', { source: 'template', body_html: '<p>Unit rules</p>', template_html: '<p>Unit rules</p>', template_version: 1 }),
    gaps: plan().gaps,
  } });
  $('#camp-plan-block-camp_rules [data-camp-plan-revert]').click();
  await flush();
  await flush();
  expect(api.saveCampPlanSection).toHaveBeenCalledWith(12, 'camp_rules', { body_html: '', expected_version: 1 });
  expect($('#camp-plan-block-camp_rules .camp-plan__chip').textContent).toBe('camp_plan_state_template');
});

test('a refused save is shown by its section as an alert, never as saved', async () => {
  await open();
  type('theme', '<p>Mine</p>');
  api.saveCampPlanSection.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409, data: { message: 'camp_plan_version_conflict' } }));
  $('#camp-plan-form-theme').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  const error = $('#camp-plan-theme-error');
  expect(error.hidden).toBe(false);
  expect(error.getAttribute('role')).toBe('alert');
  expect(app.showMessage).not.toHaveBeenCalledWith('camp_plan_saved', 'success');
  // The editor names its error, and keeps the text typed.
  expect($('#camp-plan-theme-text').getAttribute('aria-describedby')).toContain('camp-plan-theme-error');
  expect($('#camp-plan-theme-text').innerHTML).toContain('Mine');
  type('theme', '<p>Mine, again</p>');
  expect(error.hidden).toBe(true);
});

test('games are added from the library, reordered and removed with buttons', async () => {
  await open();
  // A game already chosen is not offered again.
  const options = [...document.querySelectorAll('#camp-plan-rain-choice option')].map((option) => option.textContent);
  expect(options).toEqual(['Fictional quiz']);

  api.saveCampPlanRainGames.mockResolvedValue({ success: true, data: { rain_games: plan().rain_games, gaps: plan().gaps } });
  $('#camp-plan-rain-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(api.saveCampPlanRainGames).toHaveBeenLastCalledWith(12, [31, 32, 33]);

  const down = $('[data-camp-plan-rain-move="0"][data-direction="1"]');
  expect(down.getAttribute('aria-label')).toBe('camp_plan_rain_game_down');
  expect($('[data-camp-plan-rain-move="0"][data-direction="-1"]').disabled).toBe(true);
  down.click();
  await flush();
  expect(api.saveCampPlanRainGames).toHaveBeenLastCalledWith(12, [32, 31]);

  $('[data-camp-plan-rain-remove="1"]').click();
  await flush();
  expect(api.saveCampPlanRainGames).toHaveBeenLastCalledWith(12, [31]);
});

test('a refused game list is reported as an error and the list stays as saved', async () => {
  await open();
  api.saveCampPlanRainGames.mockRejectedValue(Object.assign(new Error('Bad'), { status: 400, data: { message: 'camp_plan_rain_game_unavailable' } }));
  $('[data-camp-plan-rain-remove="0"]').click();
  await flush();
  expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
  expect(document.querySelectorAll('.camp-plan__game')).toHaveLength(2);
  expect($('#camp-plan-rain').getAttribute('aria-busy')).toBeNull();
});

test('a game’s name from the library is shown as text, and one withdrawn since says so', async () => {
  await open();
  const names = [...document.querySelectorAll('.camp-plan__game h4')];
  expect(names[1].textContent).toContain('<img src=x onerror=alert(1)>');
  expect(document.querySelector('.camp-plan__game img')).toBeNull();
  expect(names[1].textContent).toContain('camp_plan_rain_game_hidden');
});

test('a library that failed to load says so; the plan is still readable', async () => {
  getActivityLibrary.mockRejectedValue(new Error('offline'));
  await open();
  expect($('#camp-plan-rain [role="alert"]').textContent).toBe('camp_plan_library_failed');
  expect($('#camp-plan-form-theme')).not.toBeNull();
});

test('a cancelled camp is read, not written', async () => {
  api.getCampPlan.mockResolvedValue({ success: true, data: plan({ camp: { ...plan().camp, is_cancelled: true } }) });
  await open();
  expect($('[role="status"]').textContent).toBe('camp_readiness_cancelled');
  expect(document.querySelector('form')).toBeNull();
});

test('a failed load is an alert with a retry, never an empty plan', async () => {
  api.getCampPlan.mockRejectedValueOnce(Object.assign(new Error('fail'), { status: 500 }));
  await open();
  expect($('[role="alert"]')).not.toBeNull();
  $('#camp-plan-retry').click();
  await flush();
  expect($('h1').textContent).toBe('camp_plan_title');
  expect($('#camp-plan-summary')).not.toBeNull();
});

test('a late answer does not draw over the next screen', async () => {
  let resolve;
  api.getCampPlan.mockReturnValue(new Promise((done) => { resolve = done; }));
  screen = new CampPlan(app, { meetingId: 12 });
  const loading = screen.init();
  screen.destroy();
  document.getElementById('app').innerHTML = '<p id="next">Next screen</p>';
  resolve({ success: true, data: plan() });
  await loading;
  expect($('#next')).not.toBeNull();
});

test('the plan meets WCAG A/AA in every part, for an editor and for a reader', async () => {
  await open();
  for (const part of ['vcpref', 'story', 'unit', 'rain']) {
    $(`#camp-plan-nav [data-camp-plan-part="${part}"]`).click();
    // eslint-disable-next-line no-await-in-loop -- each part is checked in turn
    expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
  }
  screen.destroy();
  hasPermission.mockImplementation((key) => key === 'meetings.view');
  await open();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});
