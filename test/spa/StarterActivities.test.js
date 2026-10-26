/**
 * @jest-environment jsdom
 *
 * Starter activities: a leader browses the reviewed catalogue, filters it,
 * reads an activity's instructions and precautions, and adds one or several
 * activities to the unit. The server reports what each import did; the screen
 * never claims an addition it did not confirm.
 */
import axe from 'axe-core';
import fs from 'fs';
import path from 'path';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { STARTER_ACTIVITIES: { DURATION_LIMITS_MINUTES: [15, 30, 60] } },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  ...jest.requireActual('../../spa/utils/DOMUtils.js'),
  loadStylesheet: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../spa/api/api-yearly-planner.js', () => ({
  getStarterActivities: jest.fn(),
  importStarterActivities: jest.fn(),
}));

const { StarterActivities } = require('../../spa/modules/yearly-planner/StarterActivities.js');
const api = require('../../spa/api/api-yearly-planner.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');
const {
  STARTER_BRANCHES, STARTER_CATEGORIES, STARTER_SEASONS,
} = require('../../spa/utils/ActivityLibraryUtils.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const ROOT = path.join(__dirname, '../..');
const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/activity_library_starter.json'), 'utf8'));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A catalogue entry as the server describes it to a unit.
 * @param {Object} overrides - Fields that differ
 * @returns {Object} Entry
 */
function activity(overrides = {}) {
  return {
    key: 'game_sardines',
    name: 'Sardines',
    summary: 'Cache-cache inversé.',
    steps: ['Un joueur se cache.', 'Les autres le cherchent.'],
    safety: ['Délimiter la zone de jeu.'],
    material: [],
    variants: ['De nuit, avec des lampes.'],
    category: 'game',
    branches: ['cubs', 'scouts'],
    tags: ['indoor', 'active'],
    seasons: ['autumn', 'winter'],
    duration: { min: 15, max: 25 },
    players_min: 6,
    supervision: 'standard',
    status: 'available',
    library_id: null,
    ...overrides,
  };
}

const ENTRIES = [
  activity(),
  activity({
    key: 'technique_knives', name: 'Couteau', category: 'technique', supervision: 'close',
    tags: ['outdoor'], duration: { min: 45, max: 60 }, material: ['Couteaux pliants'],
    safety: ['Un adulte compétent supervise directement chaque poste.'],
  }),
  activity({ key: 'block_closing', name: 'Clôture', category: 'meeting_block', status: 'present', library_id: 8,
    branches: ['beavers', 'cubs', 'scouts'], duration: { min: 5, max: 10 } }),
  activity({ key: 'block_water_break', name: 'Trêve de l’eau', category: 'meeting_block', status: 'legacy_match',
    branches: ['beavers', 'cubs', 'scouts'], duration: { min: 5, max: 5 } }),
  activity({ key: 'block_inspection', name: 'Inspection', category: 'meeting_block', status: 'ambiguous',
    branches: ['beavers', 'cubs', 'scouts'], duration: { min: 5, max: 10 } }),
];

let app;

/**
 * Open the screen with a catalogue.
 * @param {Object[]} [activities] - Entries
 * @param {string|null} [branch] - The unit's branch
 * @returns {Promise<StarterActivities>} Screen
 */
async function open(activities = ENTRIES, branch = null) {
  api.getStarterActivities.mockResolvedValue({ data: { version: 2, language: 'fr', branch, activities } });
  const screen = new StarterActivities(app);
  await screen.init();
  return screen;
}

const card = (key) => document.querySelector(`[data-starter-key="${key}"]`);
const shownKeys = () => [...document.querySelectorAll('[data-starter-key]')].map((element) => element.dataset.starterKey);

/**
 * Choose a filter value as a person would.
 * @param {string} id - Select id
 * @param {string} value - Option value
 */
function choose(id, value) {
  const select = document.getElementById(id);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '<main id="app"></main>';
  app = { lang: 'fr', showMessage: jest.fn() };
  api.importStarterActivities.mockResolvedValue({
    data: { created: [{ key: 'game_sardines', name: 'Sardines', library_id: 41 }], already_present: [], reconciled: [], restored: [], hidden: [], ambiguous: [] },
  });
});
afterEach(() => closeAllModals());

test('the vocabularies the screen labels are exactly the catalogue\'s', () => {
  expect(STARTER_CATEGORIES).toEqual(Object.keys(catalogue.categories));
  expect(STARTER_BRANCHES).toEqual(Object.keys(catalogue.branches));
  expect(STARTER_SEASONS).toEqual(Object.keys(catalogue.seasons));
});

test('each activity shows its translated category, duration and setting, and what the unit already holds', async () => {
  await open();

  expect(document.querySelector('h1').textContent).toBe('starter_activities_title');
  expect(document.querySelector('#app .back-link, #app a[href="/yearly-planner"]')).not.toBeNull();
  expect(card('game_sardines').textContent).toContain('starter_category_game');
  expect(card('game_sardines').textContent).not.toMatch(/\bgame\b/);
  expect(card('technique_knives').textContent).toContain('starter_close_supervision');
  expect(card('block_closing').textContent).toContain('starter_status_present');
  expect(card('block_closing').querySelector('[data-starter-add], [data-starter-select]')).toBeNull();
  expect(card('block_water_break').querySelector('[data-starter-add]').textContent).toContain('starter_link');
  expect(card('block_inspection').textContent).toContain('starter_status_ambiguous');
  expect(card('block_inspection').querySelector('[data-starter-add]')).toBeNull();
});

test('filters by branch, category, duration and setting, and offers to clear them when nothing matches', async () => {
  await open(ENTRIES, 'cubs');

  expect(document.getElementById('starter-filter-branch').value).toBe('cubs');
  choose('starter-filter-category', 'meeting_block');
  expect(shownKeys()).toEqual(['block_closing', 'block_water_break', 'block_inspection']);
  choose('starter-filter-category', 'all');
  choose('starter-filter-duration', '30');
  expect(shownKeys()).not.toContain('technique_knives');
  choose('starter-filter-setting', 'outdoor');
  expect(shownKeys()).toEqual([]);
  expect(document.querySelector('#starter-listing .empty-state').textContent).toContain('starter_no_match');

  document.getElementById('starter-no-match-reset').click();
  expect(shownKeys()).toHaveLength(ENTRIES.length);
  expect(document.activeElement).toBe(document.getElementById('starter-filter-branch'));
});

test('adding one activity sends its key, reports what happened, and reloads what the unit holds', async () => {
  await open();
  api.getStarterActivities.mockResolvedValue({
    data: { version: 2, language: 'fr', branch: null, activities: [activity({ status: 'present', library_id: 41 }), ...ENTRIES.slice(1)] },
  });

  card('game_sardines').querySelector('[data-starter-add]').click();
  await settle();

  expect(api.importStarterActivities).toHaveBeenCalledWith(['game_sardines']);
  const result = document.getElementById('starter-result');
  expect(result.textContent).toContain('starter_result_created');
  expect(result.textContent).toContain('Sardines');
  expect(document.activeElement).toBe(result);
  expect(card('game_sardines').textContent).toContain('starter_status_present');
  expect(api.getStarterActivities).toHaveBeenCalledTimes(2);
});

test('several activities are added at once, in catalogue order, with each kind of result reported', async () => {
  api.importStarterActivities.mockResolvedValue({
    data: {
      created: [{ key: 'game_sardines', name: 'Sardines' }],
      reconciled: [{ key: 'block_water_break', name: 'Trêve de l’eau', local_name: 'Trève de l\'eau' }],
      already_present: [], restored: [], hidden: [],
      ambiguous: [],
    },
  });
  await open();

  const bulk = document.getElementById('starter-add-selected');
  expect(bulk.disabled).toBe(true);
  document.getElementById('starter-select-block_water_break').click();
  document.getElementById('starter-select-game_sardines').click();
  expect(bulk.disabled).toBe(false);
  expect(bulk.textContent).toContain('starter_add_selected');
  bulk.click();
  await settle();

  expect(api.importStarterActivities).toHaveBeenCalledWith(['game_sardines', 'block_water_break']);
  const result = document.getElementById('starter-result').textContent;
  expect(result).toContain('starter_result_created');
  expect(result).toContain('starter_result_reconciled');
  expect(result).not.toContain('starter_result_ambiguous');
});

test('"select every activity shown" selects only what the filters show and what can be added', async () => {
  await open();
  choose('starter-filter-category', 'meeting_block');

  document.getElementById('starter-select-all').click();
  document.getElementById('starter-add-selected').click();
  await settle();

  expect(api.importStarterActivities).toHaveBeenCalledWith(['block_water_break']);
});

test('a refused or failed import is explained, never reported as added, and can be retried', async () => {
  api.importStarterActivities.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'online_required' }));
  await open();

  card('game_sardines').querySelector('[data-starter-add]').click();
  await settle();

  expect(app.showMessage).toHaveBeenCalledWith('family_operation_online_required', 'error');
  expect(document.getElementById('starter-result').textContent).toBe('');
  const retry = card('game_sardines').querySelector('[data-starter-add]');
  expect(retry.disabled).toBe(false);
  retry.click();
  await settle();
  expect(document.getElementById('starter-result').textContent).toContain('starter_result_created');
});

test('a queued answer is not taken for a confirmed addition', async () => {
  api.importStarterActivities.mockResolvedValueOnce({ queued: true });
  await open();

  card('game_sardines').querySelector('[data-starter-add]').click();
  await settle();

  expect(app.showMessage).toHaveBeenCalledWith('family_operation_unconfirmed', 'error');
  expect(document.getElementById('starter-result').textContent).toBe('');
});

test('the details dialog shows the steps, precautions and material, and adds from there', async () => {
  await open();
  const opener = card('technique_knives').querySelector('[data-starter-details]');
  opener.focus();
  opener.click();

  const dialog = document.querySelector('#starter-details [role="dialog"]');
  expect(dialog.textContent).toContain('starter_steps');
  expect(dialog.textContent).toContain('Un adulte compétent supervise directement chaque poste.');
  expect(dialog.textContent).toContain('Couteaux pliants');
  expect(dialog.textContent).toContain('starter_close_supervision');
  expect((await axe.run(document.getElementById('starter-details'), AXE_OPTIONS)).violations).toEqual([]);

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.getElementById('starter-details')).toBeNull();
  expect(document.activeElement).toBe(opener);

  opener.click();
  document.querySelector('#starter-details [data-starter-add]').click();
  await settle();
  expect(api.importStarterActivities).toHaveBeenCalledWith(['technique_knives']);
  expect(document.getElementById('starter-details')).toBeNull();
  expect(document.activeElement).toBe(document.getElementById('starter-result'));
});

test('names coming from the catalogue or the unit are shown as text', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  api.importStarterActivities.mockResolvedValue({
    data: { created: [], already_present: [], reconciled: [{ key: 'game_sardines', name: hostile }], restored: [], hidden: [], ambiguous: [] },
  });
  await open([activity({ name: hostile, summary: hostile, steps: [hostile] })]);

  expect(document.querySelector('#app img')).toBeNull();
  expect(card('game_sardines').querySelector('h2').textContent).toBe(hostile);
  card('game_sardines').querySelector('[data-starter-add]').click();
  await settle();
  expect(document.querySelector('#app img')).toBeNull();
  expect(document.getElementById('starter-result').textContent).toContain(hostile);
});

test('the catalogue, its filters and its cards have no WCAG A/AA violations', async () => {
  await open();
  expect((await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations).toEqual([]);
});

test('a failed load offers a retry and never looks like an empty catalogue', async () => {
  api.getStarterActivities.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
  const screen = new StarterActivities(app);
  await screen.init();

  expect(document.querySelector('[role="alert"]').textContent).toBe('starter_load_failed');
  expect(document.querySelector('.empty-state')).toBeNull();
  expect(document.querySelector('a[href="/yearly-planner"]')).not.toBeNull();
  api.getStarterActivities.mockResolvedValue({ data: { version: 2, language: 'fr', branch: null, activities: ENTRIES } });
  document.getElementById('starter-retry').click();
  await settle();
  expect(shownKeys()).toHaveLength(ENTRIES.length);
});

test('an empty catalogue says so', async () => {
  await open([]);
  expect(document.querySelector('.empty-state').textContent).toContain('starter_catalogue_empty');
});

test('the loading state is announced and the page is marked busy', () => {
  api.getStarterActivities.mockReturnValue(new Promise(() => {}));
  new StarterActivities(app).init();
  return settle().then(() => {
    expect(document.querySelector('[role="status"]').textContent).toBe('loading');
    expect(document.getElementById('starter-activities').getAttribute('aria-busy')).toBe('true');
  });
});

test('a late answer never draws over the next screen', async () => {
  let resolve;
  api.getStarterActivities.mockReturnValue(new Promise((done) => { resolve = done; }));
  const screen = new StarterActivities(app);
  const pending = screen.init();
  await settle();
  screen.destroy();
  document.getElementById('app').textContent = 'Next screen';
  resolve({ data: { activities: ENTRIES } });
  await pending;
  expect(document.getElementById('app').textContent).toBe('Next screen');
});
