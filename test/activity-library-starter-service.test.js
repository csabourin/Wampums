/**
 * The starter import's rules that need no database: which activities a new
 * unit receives, which language is copied, which selections are refused,
 * what a copy keeps, and how meeting templates name their catalogue blocks.
 *
 * @module test/activity-library-starter-service
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const catalogue = require('../config/activity_library_starter.json');
const meetingSectionsJson = require('../config/meeting_sections.json');
const {
  StarterSelectionError,
  buildLibraryCopy,
  chooseStarterLanguage,
  selectDefaultStarterKeys,
  starterBranchForSection,
  validateStarterSelection,
} = require('../services/activityLibraryStarter');

const byKey = (key) => catalogue.activities.find((activity) => activity.key === key);

describe('the default selection', () => {
  test('a cub unit receives every standard cub activity and no close-supervision one', () => {
    const keys = selectDefaultStarterKeys('cubs');

    keys.forEach((key) => {
      expect(byKey(key).branches).toContain('cubs');
      expect(byKey(key).supervision).toBe('standard');
    });
    expect(keys).toHaveLength(catalogue.activities
      .filter((activity) => activity.branches.includes('cubs') && activity.supervision === 'standard').length);
    expect(keys).not.toEqual(expect.arrayContaining(['technique_knives']));
  });

  test('a unit without a catalogue branch receives what suits every branch, meeting blocks included', () => {
    const keys = selectDefaultStarterKeys(starterBranchForSection('general'));
    const blocks = catalogue.activities.filter((activity) => activity.category === 'meeting_block').map((a) => a.key);

    expect(keys).toEqual(expect.arrayContaining(blocks));
    keys.forEach((key) => expect(byKey(key).branches).toEqual(['beavers', 'cubs', 'scouts']));
    expect(keys.some((key) => byKey(key).supervision === 'close')).toBe(false);
  });

  test('venturers and rovers have no catalogue branch of their own', () => {
    expect(starterBranchForSection('pioneers')).toBeNull();
    expect(starterBranchForSection('rovers')).toBeNull();
    expect(starterBranchForSection('scouts')).toBe('scouts');
  });

  test('is never the whole catalogue', () => {
    ['beavers', 'cubs', 'scouts', null].forEach((branch) => {
      expect(selectDefaultStarterKeys(branch).length).toBeLessThan(catalogue.activities.length);
    });
  });
});

describe('the copy language', () => {
  test.each([
    ['fr', null, 'fr'],
    ['en', { fallback: 'fr' }, 'en'],
    ['uk', { enabled: ['uk'], fallback: 'fr' }, 'fr'],
    ['it', { enabled: ['it'], fallback: 'en' }, 'en'],
    ['id', null, 'en'],
    [undefined, { fallback: 'de' }, 'en'],
  ])('a unit speaking %s with %j gets %s', (language, setting, expected) => {
    expect(chooseStarterLanguage(language, setting)).toBe(expected);
  });
});

describe('a selection', () => {
  test('keeps catalogue order and drops duplicates', () => {
    expect(validateStarterSelection(['game_sardines', 'block_arrival', 'game_sardines']))
      .toEqual(['block_arrival', 'game_sardines']);
  });

  test('naming the withdrawn game is refused, never mapped to another game', () => {
    expect(() => validateStarterSelection(['game_den_ball'])).toThrow(StarterSelectionError);
    try {
      validateStarterSelection(['game_den_ball']);
    } catch (error) {
      expect(error.errors).toEqual([expect.objectContaining({ code: 'starter_activity_retired', key: 'game_den_ball' })]);
    }
  });

  test('a list too long to be a person\'s choice is refused', () => {
    expect(() => validateStarterSelection(Array(201).fill('game_sardines'))).toThrow(StarterSelectionError);
  });
});

describe('a copy', () => {
  test('keeps the instructions, precautions, variants and planning details, in one language', () => {
    const source = byKey('expression_campfire');
    const copy = buildLibraryCopy(source, 'en');

    expect(copy).toMatchObject({
      name: source.en.name,
      description: source.en.summary,
      category: 'expression',
      tags: source.tags,
      durationMin: source.duration.min,
      durationMax: source.duration.max,
      material: source.en.material.join('\n'),
    });
    expect(copy.metadata).toMatchObject({
      starter_key: 'expression_campfire',
      starter_language: 'en',
      steps: source.en.steps,
      safety: source.en.safety,
      variants: source.en.variants,
      supervision: 'close',
      players_min: source.players.min,
      seasons: source.seasons,
      branches: source.branches,
    });
  });

  test('an activity with no special equipment stores no material', () => {
    const noMaterial = catalogue.activities.find((activity) => activity.fr.material.length === 0);
    expect(buildLibraryCopy(noMaterial, 'fr').material).toBeNull();
  });
});

describe('meeting templates and catalogue blocks', () => {
  test('each linked template names an active meeting block that every branch can use', () => {
    const links = Object.values(meetingSectionsJson.starterBlocks);

    expect(links).toEqual(['block_arrival', 'block_water_break', 'block_closing']);
    links.forEach((key) => {
      expect(byKey(key)).toMatchObject({ category: 'meeting_block', supervision: 'standard' });
      expect(byKey(key).branches).toEqual(['beavers', 'cubs', 'scouts']);
    });
  });

  test('the linked templates exist in every configured section', () => {
    Object.values(meetingSectionsJson.sections).forEach((section) => {
      const keys = section.activityTemplates.map((template) => template.activityKey);
      expect(keys).toEqual(expect.arrayContaining(Object.keys(meetingSectionsJson.starterBlocks)));
    });
  });

  test('the closing block presents its spiritual moment as secular and optional, in both languages', () => {
    const closing = byKey('block_closing');
    expect(closing.fr.safety.join(' ')).toMatch(/laïque et facultative/);
    expect(closing.en.safety.join(' ')).toMatch(/secular and optional/);
  });

  test('the SPA copy of the section configuration links the same blocks', () => {
    // An ES module that Jest does not transform outside spa/: evaluate its object literal.
    const source = fs.readFileSync(path.join(__dirname, '../config/meeting_sections.js'), 'utf8');
    const spaSections = vm.runInNewContext(`(${source.replace(/^[\s\S]*?export default\s*/, '').replace(/;\s*$/, '')})`);
    expect(spaSections.starterBlocks).toEqual(meetingSectionsJson.starterBlocks);
    expect(spaSections.sections).toEqual(meetingSectionsJson.sections);
  });
});
