/**
 * @jest-environment jsdom
 *
 * Meeting templates linked to starter blocks: arrival, water break and closing
 * name their catalogue entry by key (config/meeting_sections.json
 * `starterBlocks`), so meeting preparation uses the unit's own copy of the
 * block, its name and its precautions, in whatever language and wording the
 * unit keeps. A template the unit renamed keeps its own text.
 */
import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugWarn: jest.fn(), debugError: jest.fn() }));
// Jest does not transform config/ ES modules; this mirrors its shape.
jest.mock('../../config/meeting_sections.js', () => ({
  __esModule: true,
  default: {
    defaultSection: 'cubs',
    starterBlocks: {
      activity_welcome_cubs: 'block_arrival',
      activity_water_break: 'block_water_break',
      activity_prayer_departure: 'block_closing',
    },
    sections: { cubs: { activityTemplates: [] } },
  },
}));

import { getTemplateStarterKey } from '../../spa/utils/meetingSections.js';
import { ActivityManager, activityDescriptionText } from '../../spa/modules/meetings/ActivityManager.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

const CLOSING_COPY = {
  id: 12,
  activity: 'Clôture : messages, prière et départ',
  type: 'meeting_block',
  description: 'Fin de la rencontre : messages pour les parents, prière et départ encadré.',
  precautions: ['La réflexion spirituelle reste laïque et facultative.'],
  starter_key: 'block_closing',
};

const TEMPLATES = [
  { time: '18:45', duration: '00:10', activityKey: 'activity_welcome_cubs', typeKey: 'activity_type_preparation' },
  { time: '19:25', duration: '00:05', activityKey: 'activity_water_break', typeKey: 'activity_type_pause' },
  { time: '20:40', duration: '00:05', activityKey: 'activity_prayer_departure', typeKey: 'activity_type_conclusion' },
];

/**
 * @param {Object[]} libraryActivities - The unit's library, as v1/meetings/activities lists it
 * @param {Object[]} templates - The unit's section templates
 * @returns {ActivityManager} Manager with placeholders built
 */
function prepare(libraryActivities, templates = TEMPLATES) {
  const manager = new ActivityManager({ lang: 'fr' }, [], libraryActivities, { activityTemplates: templates });
  manager.setSelectedActivities(manager.initializePlaceholderActivities());
  return manager;
}

test('a linked template uses the unit\'s copy of its starter block', () => {
  const manager = prepare([CLOSING_COPY]);
  const closing = manager.selectedActivities.find((row) => row.activityKey === 'activity_prayer_departure');

  expect(closing.activity).toBe(CLOSING_COPY.activity);
  expect(closing.description).toBe(CLOSING_COPY.description);
});

test('without a copy, the template keeps its translated label', () => {
  const manager = prepare([]);
  expect(manager.selectedActivities.map((row) => row.activity))
    .toEqual(['activity_welcome_cubs', 'activity_water_break', 'activity_prayer_departure']);
});

test('a template the unit renamed keeps its own text', () => {
  const custom = [{ ...TEMPLATES[2], activity: 'Mot du soir' }];
  const manager = prepare([CLOSING_COPY], custom);

  expect(getTemplateStarterKey(custom[0])).toBeNull();
  expect(manager.selectedActivities[0].activity).toBe('Mot du soir');
});

test('an explicit starterKey links a template whatever its label key', () => {
  expect(getTemplateStarterKey({ activityKey: 'activity_custom', starterKey: 'block_opening' })).toBe('block_opening');
  expect(getTemplateStarterKey({ activityKey: 'activity_big_game' })).toBeNull();
  expect(getTemplateStarterKey({ activityKey: 'activity_water_break' })).toBe('block_water_break');
});

test('the closing block\'s description says its spiritual moment is secular and optional', () => {
  document.body.innerHTML = '<main><h1>Meeting</h1><div id="activities-list"></div></main>';
  window.requestAnimationFrame = (callback) => { callback(); return 1; };
  const manager = prepare([CLOSING_COPY]);
  manager.renderActivitiesTable();

  const button = document.querySelector('.description-btn');
  expect(button.getAttribute('aria-label')).toBe(`description — ${CLOSING_COPY.activity}`);
  expect(button.dataset.description).toBe(activityDescriptionText(CLOSING_COPY));
  expect(button.dataset.description).toContain('laïque et facultative');
  return axe.run(document.getElementById('activities-list'), AXE_OPTIONS)
    .then((results) => expect(results.violations).toEqual([]));
});

test('a description joins the summary and precautions, skipping what is empty', () => {
  expect(activityDescriptionText({ description: 'Résumé', precautions: ['Un', '', 'Deux'] })).toBe('Résumé\nUn\nDeux');
  expect(activityDescriptionText({ description: null, precautions: null })).toBe('');
  expect(activityDescriptionText(undefined)).toBe('');
});
