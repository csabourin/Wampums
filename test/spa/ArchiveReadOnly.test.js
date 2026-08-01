/**
 * @jest-environment jsdom
 */

/**
 * Making the archive's read-only nature visible.
 *
 * The API layer already refuses the writes, so this is about not presenting a
 * page full of controls that would all fail on click. What matters is the line
 * it draws: mutating controls go grey, consultation controls — the date picker,
 * the search box, the group filter — stay live, because narrowing what you are
 * looking at is the whole reason to open an archive.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

import { initArchiveReadOnly } from '../../spa/modules/scout-year/ArchiveReadOnly.js';
import {
  setSelectedScoutYear,
  clearSelectedScoutYear
} from '../../spa/modules/scout-year/ScoutYearContext.js';

const ARCHIVED_YEAR = { id: 4, label: '2024-2025', status: 'closed' };

/** Longer than the module's debounce, so the sweep has certainly run. */
const SETTLE_MS = 120;

/**
 * Let the debounced sweep run.
 *
 * Real timers rather than fake ones: jsdom delivers MutationObserver records
 * through its own event loop, which fake timers do not drive, so the observer
 * would never fire.
 *
 * @returns {Promise<void>} Resolves once the sweep has run
 */
function settle() {
  return new Promise(resolve => setTimeout(resolve, SETTLE_MS));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('currentOrganizationId', '12');
  document.body.innerHTML = `
    <div id="scout-year-banner" class="scout-year-banner">
      <select id="scout-year-select"></select>
    </div>
    <div id="app">
      <button id="save">Enregistrer</button>
      <input id="note" type="text" />
      <select id="dateSelect" data-archive-safe></select>
      <input id="search" type="search" data-archive-safe />
      <button id="already-off" disabled>Déjà désactivé</button>
      <a id="back" href="/dashboard">Retour</a>
      <span id="editable-group" contenteditable="true">Louveteaux</span>
    </div>`;
});

test('leaves everything alone on the current year', () => {
  initArchiveReadOnly();

  expect(document.getElementById('save').disabled).toBe(false);
  expect(document.getElementById('app').classList.contains('is-archive-readonly')).toBe(false);
});

test('greys out mutating controls but not the ones used to browse', () => {
  setSelectedScoutYear(ARCHIVED_YEAR);
  initArchiveReadOnly();

  expect(document.getElementById('save').disabled).toBe(true);
  expect(document.getElementById('save').getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById('note').disabled).toBe(true);

  // Consultation controls stay usable.
  expect(document.getElementById('dateSelect').disabled).toBe(false);
  expect(document.getElementById('search').disabled).toBe(false);

  // Navigation is never blocked — disabling links would trap the leader.
  expect(document.getElementById('editable-group').getAttribute('contenteditable')).toBe('false');
  expect(document.getElementById('back').hasAttribute('data-archive-disabled')).toBe(false);

  expect(document.getElementById('app').classList.contains('is-archive-readonly')).toBe(true);
});

test('covers controls rendered after the fact', async () => {
  setSelectedScoutYear(ARCHIVED_YEAR);
  initArchiveReadOnly();

  // A route change replaces the page contents.
  document.getElementById('app').innerHTML = '<button id="late">Ajouter</button>';
  await settle();

  expect(document.getElementById('late').disabled).toBe(true);
});

test('gives the controls back when returning to the current year', async () => {
  setSelectedScoutYear(ARCHIVED_YEAR);
  initArchiveReadOnly();
  expect(document.getElementById('save').disabled).toBe(true);

  clearSelectedScoutYear();
  await settle();

  expect(document.getElementById('save').disabled).toBe(false);
  expect(document.getElementById('save').hasAttribute('aria-disabled')).toBe(false);
  expect(document.getElementById('editable-group').getAttribute('contenteditable')).toBe('true');
});

test('never re-enables a control the page had disabled itself', async () => {
  setSelectedScoutYear(ARCHIVED_YEAR);
  initArchiveReadOnly();

  const own = document.getElementById('already-off');
  expect(own.hasAttribute('data-archive-disabled')).toBe(false);

  clearSelectedScoutYear();
  await settle();

  // Restoring must not hand back a button the page meant to keep off — a Save
  // greyed out because the form is invalid would otherwise come back to life.
  expect(own.disabled).toBe(true);
});
