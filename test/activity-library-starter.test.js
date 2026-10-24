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
const REVIEWS = ['draft', 'to_confirm'];

const duplicates = (values) => values.filter((value, index) => values.indexOf(value) !== index);

describe('starter activity library', () => {
  it('has no byte-order mark and no double-encoded text', () => {
    expect(raw.charCodeAt(0)).not.toBe(0xFEFF);
    expect(raw).not.toMatch(/Ã|â€|Â|�/);
  });

  it('names every branch, category and tag in both languages', () => {
    for (const group of ['branches', 'categories', 'tags']) {
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
