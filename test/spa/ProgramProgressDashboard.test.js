/**
 * @jest-environment jsdom
 */

/**
 * The programme progress stream: the "Programme" tab of Progression, and the
 * parent's view of their children's progress.
 *
 * Held here: it says it is loading, then lists what each youth achieved; a
 * failed load is an error with a retry, never an empty stream; an empty
 * stream says so inside the table; choosing a youth reloads for that youth;
 * names from people are shown as text; the parent's view has no filter; a
 * late answer does not draw over the next screen; and it meets WCAG A/AA.
 *
 * @module test/spa/ProgramProgressDashboard
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {},
  getStorageKey: (key) => key,
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  getProgramProgressStream: jest.fn(),
}));

const { getProgramProgressStream } = require('../../spa/ajax-functions.js');
const { ProgramProgressDashboard } = require('../../spa/modules/program-progress/ProgramProgressDashboard.js');
const { ParentProgramProgress } = require('../../spa/modules/program-progress/ParentProgramProgress.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const STREAM = {
  items: [
    { participant_name: 'Léa Parent', source_key: 'badge_presentation', title: 'Castor curieux', status: 'recorded', event_at: '2026-10-01' },
  ],
  participants: [
    { id: 1, first_name: 'Léa', last_name: 'Parent' },
    { id: 2, first_name: 'Noé', last_name: 'Tremblay' },
  ],
  summary: { total: 1, by_source: { badge_presentation: 1 } },
};

/** @returns {Promise<void>} Let pending promises settle */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** @returns {HTMLElement} The page root */
function app() {
  return document.getElementById('app');
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  getProgramProgressStream.mockReset();
});

test('says it is loading, then lists what each youth achieved', async () => {
  let release;
  getProgramProgressStream.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  const page = new ProgramProgressDashboard({ showMessage: jest.fn() });

  const pending = page.init();
  expect(app().querySelector('[aria-busy="true"] [role="status"]').textContent).toBe('loading');

  release({ success: true, data: STREAM });
  await pending;

  expect(app().querySelector('[aria-busy="true"]')).toBeNull();
  const cells = [...app().querySelectorAll('tbody td')].map((cell) => cell.textContent.trim());
  expect(cells.slice(0, 3)).toEqual(['Léa Parent', 'program_progress_source_badge_presentation', 'Castor curieux']);
});

test('a failed load is an error with a retry, not an empty stream', async () => {
  getProgramProgressStream
    .mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503 }))
    .mockResolvedValueOnce({ success: true, data: STREAM });
  const page = new ProgramProgressDashboard({ showMessage: jest.fn() });

  await page.init();

  expect(app().querySelector('[role="alert"]').textContent).toBe('error_loading_data');
  expect(app().textContent).not.toContain('program_progress_empty');
  expect(app().querySelector('table')).toBeNull();

  app().querySelector('#program-progress-retry').click();
  await flush();

  expect(app().querySelector('[role="alert"]')).toBeNull();
  expect(app().querySelector('tbody td').textContent.trim()).toBe('Léa Parent');
});

test('an empty stream says so in a row of the table', async () => {
  getProgramProgressStream.mockResolvedValueOnce({ success: true, data: { items: [], participants: [], summary: { total: 0, by_source: {} } } });

  await new ProgramProgressDashboard({ showMessage: jest.fn() }).init();

  const cell = app().querySelector('tbody tr td');
  expect(cell.textContent).toBe('program_progress_empty');
  expect(cell.getAttribute('colspan')).toBe('5');
});

test('choosing a youth reloads the stream for that youth', async () => {
  getProgramProgressStream.mockResolvedValue({ success: true, data: STREAM });
  await new ProgramProgressDashboard({ showMessage: jest.fn() }).init();

  const filter = app().querySelector('#program-progress-participant-filter');
  filter.value = '2';
  filter.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();

  expect(getProgramProgressStream).toHaveBeenLastCalledWith({ participant_id: 2 });
  expect(app().querySelector('#program-progress-participant-filter').value).toBe('2');
});

test('names and titles holding markup are shown as text', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  getProgramProgressStream.mockResolvedValueOnce({
    success: true,
    data: {
      items: [{ participant_name: hostile, source_key: 'credential', title: hostile, status: hostile }],
      participants: [{ id: 1, first_name: hostile, last_name: '' }],
      summary: { total: 1, by_source: {} },
    },
  });

  await new ProgramProgressDashboard({ showMessage: jest.fn() }).init();

  expect(app().querySelector('img')).toBeNull();
  expect(app().querySelector('tbody td').textContent).toBe(hostile);
  expect(app().querySelector('option[value="1"]').textContent).toBe(hostile);
});

test('the parent view has a back link to the parent dashboard and no youth filter', async () => {
  getProgramProgressStream.mockResolvedValueOnce({ success: true, data: STREAM });

  await new ParentProgramProgress({ showMessage: jest.fn() }).init();

  const first = app().querySelector('.container').firstElementChild;
  expect(first.tagName).toBe('A');
  expect(first.getAttribute('href')).toBe('/parent-dashboard');
  expect(app().querySelector('#program-progress-participant-filter')).toBeNull();
});

test('embedded in Progression, it draws neither a back link nor a second heading', async () => {
  getProgramProgressStream.mockResolvedValueOnce({ success: true, data: STREAM });

  await new ProgramProgressDashboard({ showMessage: jest.fn() }, { embedded: true }).init();

  expect(app().querySelector('h1')).toBeNull();
  expect(app().querySelector('a[href="/dashboard"]')).toBeNull();
});

test('an answer that arrives after the person left does not draw over the next screen', async () => {
  let release;
  getProgramProgressStream.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  const page = new ProgramProgressDashboard({ showMessage: jest.fn() });
  const pending = page.init();

  page.destroy();
  app().textContent = 'next screen';
  release({ success: true, data: STREAM });
  await pending;

  expect(app().textContent).toBe('next screen');
});

test('the stream meets WCAG A/AA', async () => {
  getProgramProgressStream.mockResolvedValueOnce({ success: true, data: STREAM });
  await new ProgramProgressDashboard({ showMessage: jest.fn() }).init();

  const results = await axe.run(app(), AXE_OPTIONS);

  expect(results.violations).toEqual([]);
});

test('statuses are shown in the page\'s language, and an unknown one as "other", never raw', async () => {
  getProgramProgressStream.mockResolvedValueOnce({
    success: true,
    data: {
      items: [
        { participant_name: 'Léa', source_key: 'oas_competency', title: 'Camping 3', status: 'in_progress' },
        { participant_name: 'Léa', source_key: 'top_award_review', title: 'Revue', status: 'revisions_required' },
        { participant_name: 'Léa', source_key: 'credential', title: 'Premiers soins', status: 'surprise_value' },
      ],
      participants: [],
      summary: { total: 3, by_source: {} },
    },
  });

  await new ProgramProgressDashboard({ showMessage: jest.fn() }).init();

  const statuses = [...app().querySelectorAll('tbody tr')].map((row) => row.children[3].textContent.trim());
  expect(statuses).toEqual([
    'program_progress_status_in_progress',
    'program_progress_status_revisions_required',
    'program_progress_status_other',
  ]);
});

test('a record without a title of its own is described by its source, not by an internal key', async () => {
  getProgramProgressStream.mockResolvedValueOnce({
    success: true,
    data: {
      items: [
        { participant_name: 'Léa', source_key: 'pab_review', title: 'pab_review', status: 'recorded' },
        { participant_name: 'Léa', source_key: 'credential', title: null, status: 'active' },
      ],
      participants: [],
      summary: { total: 2, by_source: {} },
    },
  });

  await new ProgramProgressDashboard({ showMessage: jest.fn() }).init();

  const titles = [...app().querySelectorAll('tbody tr')].map((row) => row.children[2].textContent.trim());
  expect(titles).toEqual(['program_progress_source_pab_review', 'program_progress_source_credential']);
});
