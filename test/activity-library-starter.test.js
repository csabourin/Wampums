/**
 * The starter activity library (config/activity_library_starter.json) is copied
 * into units, so every entry must be complete in both languages, use only the
 * declared branches, categories and tags, and say how to stay safe when an
 * activity needs close supervision. Old names map to exactly one entry, so the
 * copies units already hold can be matched to it.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'config', 'activity_library_starter.json');
const raw = fs.readFileSync(FILE, 'utf8');
const library = JSON.parse(raw);
const { activities } = library;

const LANGUAGES = ['fr', 'en'];
const LIST_FIELDS = ['material', 'steps', 'safety', 'variants'];
const SUPERVISION = ['standard', 'close'];
const ORIGINS = ['units', 'new'];
const REVIEWS = ['draft', 'to_confirm', 'reviewed'];

const duplicates = (values) => values.filter((value, index) => values.indexOf(value) !== index);

describe('starter activity library', () => {
  it('has no byte-order mark and no double-encoded text', () => {
    expect(raw.charCodeAt(0)).not.toBe(0xFEFF);
    expect(raw).not.toMatch(/Ã|â€|Â|�/);
  });

  it('names every branch, category, tag and season in both languages', () => {
    for (const group of ['branches', 'categories', 'tags', 'seasons']) {
      for (const [key, labels] of Object.entries(library[group])) {
        for (const language of LANGUAGES) {
          expect([group, key, language, typeof labels[language]]).toEqual([group, key, language, 'string']);
        }
      }
    }
  });

  it('gives every activity a unique key', () => {
    const keys = activities.map((activity) => activity.key);
    expect(duplicates(keys)).toEqual([]);
    expect(keys.filter((key) => !/^[a-z][a-z0-9_]*$/.test(key))).toEqual([]);
  });

  it('uses only declared branches, categories and tags', () => {
    const invalid = activities.filter((activity) =>
      !(activity.category in library.categories)
      || activity.branches.length === 0
      || activity.branches.some((branch) => !(branch in library.branches))
      || activity.tags.some((tag) => !(tag in library.tags)));
    expect(invalid.map((activity) => activity.key)).toEqual([]);
  });

  it('gives every activity a name and a summary in French and English', () => {
    const incomplete = activities.filter((activity) => LANGUAGES.some((language) =>
      !activity[language]?.name?.trim() || !activity[language]?.summary?.trim()));
    expect(incomplete.map((activity) => activity.key)).toEqual([]);
  });

  it('keeps the same lists, item for item, in both languages', () => {
    const mismatched = activities.filter((activity) => LIST_FIELDS.some((field) =>
      (activity.fr[field] || []).length !== (activity.en[field] || []).length));
    expect(mismatched.map((activity) => activity.key)).toEqual([]);
  });

  it('gives each activity a distinct name in each language', () => {
    for (const language of LANGUAGES) {
      expect(duplicates(activities.map((activity) => activity[language].name.toLowerCase()))).toEqual([]);
    }
  });

  it('has sensible durations and group sizes', () => {
    const invalid = activities.filter(({ duration, players }) =>
      !Number.isInteger(duration.min) || !Number.isInteger(duration.max)
      || duration.min <= 0 || duration.min > duration.max
      || (players && (!Number.isInteger(players.min) || players.min < 1)));
    expect(invalid.map((activity) => activity.key)).toEqual([]);
  });

  it('spells out safety rules for every activity that needs close supervision', () => {
    expect(activities.filter((activity) => !SUPERVISION.includes(activity.supervision))
      .map((activity) => activity.key)).toEqual([]);
    const unsafe = activities.filter((activity) => activity.supervision === 'close'
      && LANGUAGES.some((language) => !(activity[language].safety || []).length));
    expect(unsafe.map((activity) => activity.key)).toEqual([]);
  });

  it('says what is left to confirm on every entry awaiting a leader', () => {
    expect(activities.filter((activity) => !ORIGINS.includes(activity.origin) || !REVIEWS.includes(activity.review))
      .map((activity) => activity.key)).toEqual([]);
    expect(activities.filter((activity) => activity.review === 'to_confirm' && !activity.review_note?.trim())
      .map((activity) => activity.key)).toEqual([]);
  });

  it('gives every reviewed activity usable instructions, equipment lists and precautions in both languages', () => {
    const reviewed = activities.filter((activity) => activity.review === 'reviewed');
    expect(reviewed.length).toBeGreaterThan(0);
    for (const activity of reviewed) {
      expect(activity.players).toEqual(expect.objectContaining({ min: expect.any(Number) }));
      for (const language of LANGUAGES) {
        for (const field of LIST_FIELDS) {
          expect(Array.isArray(activity[language][field])).toBe(true);
          expect(activity[language][field].every((text) => typeof text === 'string' && text.trim().length > 0)).toBe(true);
        }
        // No-equipment activities and activities without a proposed variant use [].
        expect(activity[language].steps.length).toBeGreaterThan(1);
        expect(activity[language].safety.length).toBeGreaterThan(0);
      }
    }
  });

  it('declares a valid season and setting for every activity', () => {
    const invalid = activities.filter((activity) => !activity.seasons?.length
      || activity.seasons.some((season) => !(season in library.seasons))
      || !activity.tags.some((tag) => ['indoor', 'outdoor'].includes(tag)));
    expect(invalid.map((activity) => activity.key)).toEqual([]);
  });

  it('keeps withdrawn activities out of the selectable list without losing their old names', () => {
    const retired = library.retired_activities;
    expect(retired.find((activity) => activity.key === 'game_den_ball')).toMatchObject({
      legacy_names: ['Jeu : Ballon tanières'],
    });
    const activeKeys = activities.map((activity) => activity.key);
    for (const activity of retired) {
      expect(activeKeys).not.toContain(activity.key);
      for (const language of LANGUAGES) {
        expect(activity.reason[language].trim().length).toBeGreaterThan(0);
      }
    }
    expect(duplicates([...activities, ...retired].flatMap((activity) => activity.legacy_names))).toEqual([]);
  });

  it('keeps pigeon ball targets on the floor rather than on gym benches', () => {
    const pigeonBall = activities.find((activity) => activity.key === 'game_pigeon_ball');
    for (const language of LANGUAGES) {
      const setup = [pigeonBall[language].summary, ...pigeonBall[language].material, ...pigeonBall[language].steps].join(' ');
      expect(setup).toMatch(/\bsol\b|\bfloor\b/);
      expect(setup).not.toMatch(/\bbanc\b|\bbench\b/i);
    }
  });

  it('maps each old name to exactly one activity, and only the units’ own activities have old names', () => {
    const legacy = activities.flatMap((activity) => activity.legacy_names);
    expect(duplicates(legacy)).toEqual([]);
    expect(activities.filter((activity) => activity.origin === 'new' && activity.legacy_names.length)
      .map((activity) => activity.key)).toEqual([]);
    expect(activities.filter((activity) => activity.origin === 'units' && !activity.legacy_names.length)
      .map((activity) => activity.key)).toEqual([]);
  });

  it('offers games for the youngest, the oldest and every branch', () => {
    const games = activities.filter((activity) => activity.category === 'game');
    const branches = Object.keys(library.branches);
    for (const branch of branches) {
      expect([branch, games.filter((game) => game.branches.includes(branch)).length >= 10]).toEqual([branch, true]);
    }
    expect(games.filter((game) => branches.every((branch) => game.branches.includes(branch))).length)
      .toBeGreaterThanOrEqual(10);
  });
});
