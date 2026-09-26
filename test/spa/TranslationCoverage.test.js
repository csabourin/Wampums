/**
 * Every key the web app asks for exists in English and in French.
 *
 * `npm run lint:i18n-parity` checks that en.json and fr.json hold the same
 * keys. It cannot see a key the code uses that is missing from *both* -- and
 * `translate()` echoes an unknown key back verbatim, so the screen shows
 * `walk_in_title` to a parent instead of a sentence. This suite reads the code.
 *
 * Three nets, because keys reach `translate()` three ways:
 *
 * 1. Literal calls, `translate('some_key')`, anywhere in the SPA. Unit
 *    vocabulary may redirect a key to a template key; that counts as present.
 * 2. Keys held in lookup tables -- `{ expired: 'family_link_expired' }` -- which
 *    no call site names. For the family-access screens and the emails they
 *    send, every string shaped like one of their keys must exist.
 * 3. Keys built from a state, `family_request_state_${state}`, expanded over
 *    every state the server can return.
 *
 * @module test/spa/TranslationCoverage
 */

import fs from 'fs';
import path from 'path';

import { getVocabularyTemplateKey } from '../../spa/utils/UnitVocabularyUtils.js';

const ROOT = path.join(__dirname, '../..');
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/en.json'), 'utf8'));
const fr = JSON.parse(fs.readFileSync(path.join(ROOT, 'lang/fr.json'), 'utf8'));

/**
 * Every .js file under a directory.
 *
 * @param {string} dir - Directory relative to the repo root
 * @returns {Array<string>} File paths
 */
function jsFiles(dir) {
  const out = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  }(path.join(ROOT, dir)));
  return out;
}

/**
 * Source with block and line comments removed, so a key named in prose does
 * not count as used.
 *
 * @param {string} file - Path
 * @returns {string} Code only
 */
function code(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Whether a key renders as a sentence in a language.
 *
 * @param {string} key - Translation key
 * @param {Object} table - en or fr
 * @returns {boolean} Present, directly or through unit vocabulary
 */
function present(key, table) {
  return key in table || (getVocabularyTemplateKey(key) || '') in table;
}

/**
 * Keys missing from either language, with where they were found.
 *
 * @param {Array<[string, string]>} uses - [key, where]
 * @returns {Array<string>} Human-readable misses
 */
function missing(uses) {
  return uses
    .filter(([key]) => !present(key, en) || !present(key, fr))
    .map(([key, where]) => `${key} (${where}; en:${present(key, en)} fr:${present(key, fr)})`);
}

const FEATURE_FILES = [
  ...jsFiles('spa/modules/family-access'),
  ...jsFiles('spa/modules/parent-invitations'),
  ...jsFiles('spa/modules/participant-duplicates'),
  ...jsFiles('spa/modules/parent-onboarding'),
  ...jsFiles('spa/modules/walk-in'),
  path.join(ROOT, 'services/parentInvitations.js'),
  path.join(ROOT, 'services/familyLinks.js'),
];

/** The prefixes the family-access keys use; a string shaped like one is a key. */
const FEATURE_KEY = /^(walk_in|family_link|family_access|family_request|parent_invitations?|participant_duplicates|onboarding|complete_registration|account_(?:email|password|name)|tile_(walk_in|parent_invitations|participant_duplicates))_[a-z0-9_]+$/;

test('every literal translate() call in the SPA has English and French', () => {
  const uses = [];
  for (const file of jsFiles('spa')) {
    for (const match of code(file).matchAll(/\btranslate\(\s*['"]([a-zA-Z0-9_.-]+)['"]\s*\)/g)) {
      uses.push([match[1], path.relative(ROOT, file)]);
    }
  }

  expect(uses.length).toBeGreaterThan(1000);
  expect(missing(uses)).toEqual([]);
});

test('every key held in a lookup table by the family-access screens and emails exists', () => {
  const uses = [];
  for (const file of FEATURE_FILES) {
    for (const match of code(file).matchAll(/['"`]([a-z0-9_]+)['"`]/g)) {
      if (FEATURE_KEY.test(match[1])) uses.push([match[1], path.relative(ROOT, file)]);
    }
  }

  expect(uses.length).toBeGreaterThan(100);
  expect(missing(uses)).toEqual([]);
});

test('every key built from a state exists for each state the server returns', () => {
  const built = [
    ...['pending', 'expired', 'accepted', 'revoked', 'invalid'].map((s) => [`parent_invitation_state_${s}`, 'ParentInvitations']),
    ...['pending', 'expired', 'accepted', 'declined', 'revoked'].map((s) => [`family_request_state_${s}`, 'FamilyAccess']),
    ...['same', 'different'].map((s) => [`participant_duplicates_decided_${s}`, 'ParticipantDuplicates']),
  ];

  expect(missing(built)).toEqual([]);
});

test('the dashboard tiles have labels in both languages', () => {
  const tiles = fs.readFileSync(path.join(ROOT, 'spa/config/dashboard-tiles.js'), 'utf8');
  const labels = [...tiles.matchAll(/label: "([a-z0-9_]+)"/g)].map((m) => [m[1], 'dashboard-tiles']);

  expect(labels.length).toBeGreaterThan(20);
  expect(missing(labels)).toEqual([]);
});
