/**
 * @jest-environment jsdom
 */

/**
 * The rows of a meeting's agenda, as the meeting preparation screen draws them.
 *
 * Held here: every field of a row is named after its activity, so a screen
 * reader can tell rows apart; what leaders typed (activity, person in charge,
 * material) comes back as text in the fields, never as markup; and the agenda
 * meets WCAG A/AA.
 *
 * @module test/spa/ActivityManagerRows
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: { UI: { MEETING_REORDER_LONG_PRESS_DELAY: 450, MEETING_REORDER_MOVE_TOLERANCE: 10 } },
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  debugError: jest.fn(),
}));

jest.mock('../../spa/utils/meetingSections.js', () => ({
  getSectionActivityTemplates: jest.fn(() => []),
}));

import { ActivityManager } from '../../spa/modules/ActivityManager.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const HOSTILE = '"><img src=x onerror=alert(1)>';

/**
 * @param {Object[]} rows - Agenda rows
 * @returns {HTMLElement} The rendered agenda
 */
function renderAgenda(rows) {
  document.body.innerHTML = '<main><h1>Meeting</h1><div id="activities-list"></div></main>';
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  const manager = new ActivityManager({ lang: 'fr' }, [{ full_name: 'Akela' }], [{ id: 1, activity: 'Accueil' }]);
  manager.setSelectedActivities(rows);
  manager.renderActivitiesTable();
  return document.getElementById('activities-list');
}

test('every field of a row is named after its activity', () => {
  const list = renderAgenda([
    { id: 1, activity: 'Accueil', time: '18:45', duration: '00:15', responsable: 'Akela', materiel: '', position: 0 },
  ]);
  const row = list.querySelector('.activity-row');

  const names = ['.activity-time', '.activity-duration', '.activity-select', '.activity-responsable', '.activity-materiel', '.edit-activity-btn']
    .map((selector) => row.querySelector(selector).getAttribute('aria-label'));

  expect(names).toEqual([
    'time — Accueil', 'duration — Accueil', 'activity — Accueil',
    'responsable — Accueil', 'materiel — Accueil', 'edit — Accueil',
  ]);
});

test('what leaders typed comes back as text in the fields, never as markup', () => {
  const list = renderAgenda([
    { id: 1, activity: HOSTILE, time: '18:45', duration: '00:15', responsable: HOSTILE, materiel: HOSTILE, position: 0 },
  ]);
  const row = list.querySelector('.activity-row');

  expect(list.querySelector('img')).toBeNull();
  expect(row.querySelector('.activity-select').value).toBe(HOSTILE);
  expect(row.querySelector('.responsable-input').value).toBe(HOSTILE);
  expect(row.querySelector('.activity-materiel').value).toBe(HOSTILE);
});

test('the agenda meets WCAG A/AA', async () => {
  renderAgenda([
    { id: 1, activity: 'Accueil', time: '18:45', duration: '00:15', responsable: 'Akela', materiel: 'Foulards', position: 0 },
    { id: 2, activity: 'Jeu libre', time: '19:00', duration: '00:20', responsable: 'Baloo', materiel: '', position: 1, isDefault: true },
  ]);

  const results = await axe.run(document.querySelector('main'), AXE_OPTIONS);

  expect(results.violations).toEqual([]);
});
