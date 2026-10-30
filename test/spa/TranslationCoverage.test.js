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
      if (entry.isDirectory()) {walk(full);}
      else if (entry.name.endsWith('.js')) {out.push(full);}
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
      if (FEATURE_KEY.test(match[1])) {uses.push([match[1], path.relative(ROOT, file)]);}
    }
  }

  expect(uses.length).toBeGreaterThan(100);
  expect(missing(uses)).toEqual([]);
});

/** @returns {string[]} The statuses ProgramProgressDashboard labels, read from its source */
function programProgressStatuses() {
  const source = code(path.join(ROOT, 'spa/modules/program-progress/ProgramProgressDashboard.js'));
  const list = source.match(/PROGRAM_PROGRESS_STATUSES = \[([^\]]*)\]/)[1];
  return [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

/** @returns {string[]} The kinds of offline change OfflineManager names when one is refused */
function offlineMutationKinds() {
  const source = code(path.join(ROOT, 'spa/modules/OfflineManager.js'));
  return [...new Set([...source.matchAll(/kind: '([a-z_]+)'/g)].map((match) => match[1]))];
}

/**
 * @param {string} name - A constant of the sign-in screen holding a list of strings
 * @returns {string[]} Its values, read from the source
 */
function loginList(name) {
  const source = code(path.join(ROOT, 'spa/modules/session/Login.js'));
  return [...source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

/** @returns {string[]} The kinds of family task the parent dashboard labels, read from its source */
function familyTaskKinds() {
  const source = code(path.join(ROOT, 'spa/modules/dashboard/FamilyTasks.js'));
  const table = source.match(/FAMILY_TASK_KIND = Object\.freeze\(\{([^}]*)\}/)[1];
  return [...table.matchAll(/: '([a-z_]+)'/g)].map((match) => match[1]);
}

/** @returns {string[]} The catalogue's units of measure, from the list the server validates against */
function equipmentUnits() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'config/equipment_units.json'), 'utf8')).units;
}

/** @returns {string[]} The equipment category keys, from the list the server validates against */
function equipmentCategories() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'config/equipment_categories.json'), 'utf8')).categories;
}

/**
 * @param {string} vocabulary - categories, branches or seasons
 * @returns {string[]} The starter catalogue's keys for it
 */
function starterVocabulary(vocabulary) {
  const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/activity_library_starter.json'), 'utf8'));
  return Object.keys(catalogue[vocabulary]);
}

/** @returns {string[]} The orders the equipment picker offers, read from its source */
function materialSorts() {
  const source = code(path.join(ROOT, 'spa/modules/resources/MaterialManagement.js'));
  return [...source.match(/MATERIAL_SORTS = \[([^\]]*)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

/** @returns {Object} Volunteer types and requirements, from the list the server validates against */
function volunteerConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'config/volunteer_shifts.json'), 'utf8'));
}

test('every key built from a state exists for each state the server returns', () => {
  const built = [
    ...['pending', 'expired', 'accepted', 'revoked', 'invalid'].map((s) => [`parent_invitation_state_${s}`, 'ParentInvitations']),
    ...['pending', 'expired', 'accepted', 'declined', 'revoked'].map((s) => [`family_request_state_${s}`, 'FamilyAccess']),
    ...['same', 'different'].map((s) => [`participant_duplicates_decided_${s}`, 'ParticipantDuplicates']),
    ...[...programProgressStatuses(), 'other'].map((s) => [`program_progress_status_${s}`, 'ProgramProgressDashboard']),
    ['sync.rejected', 'OfflineManager'],
    ...[...offlineMutationKinds(), 'other'].map((kind) => [`sync.rejected_kind_${kind}`, 'OfflineManager']),
    ...loginList('DEMO_VIEWS').flatMap((view) => [[`demo_view_${view}`, 'Login'], [`demo_view_${view}_text`, 'Login']]),
    ...loginList('DEMO_REFUSALS').map((refusal) => [refusal, 'Login']),
    ...familyTaskKinds().map((kind) => [`family_tasks_kind_${kind}`, 'FamilyTasks']),
    ...['one', 'other'].map((form) => [`family_tasks_count_${form}`, 'FamilyTasks']),
    ...['treatment', 'administration'].map((kind) => [`authorization_kind_${kind}`, 'FamilyTasks']),
    ...equipmentCategories().map((key) => [`equipment_category_${key}`, 'EquipmentCategoryUtils']),
    ...equipmentUnits().map((key) => [`equipment_unit_${key}`, 'EquipmentUnitUtils']),
    ...materialSorts().map((sort) => [`material_sort_${sort}`, 'MaterialManagement']),
    ...starterVocabulary('categories').map((key) => [`starter_category_${key}`, 'ActivityLibraryUtils']),
    ...starterVocabulary('branches').map((key) => [`starter_branch_${key}`, 'ActivityLibraryUtils']),
    ...starterVocabulary('seasons').map((key) => [`starter_season_${key}`, 'ActivityLibraryUtils']),
    ...['indoor', 'outdoor'].map((key) => [`starter_setting_${key}`, 'ActivityLibraryUtils']),
    ...volunteerConfig().types.map((type) => [`volunteer_type_${type.key}`, 'VolunteerTypeUtils']),
    ...volunteerConfig().requirements.map((key) => [`volunteer_requirement_${key}`, 'VolunteerTypeUtils']),
    ...['missing', 'expired', 'expiring', 'valid'].map((state) => [`volunteers_check_${state}`, 'Volunteers']),
  ];

  expect(programProgressStatuses().length).toBeGreaterThan(10);
  expect(offlineMutationKinds()).toEqual(expect.arrayContaining(['attendance', 'medication', 'badges']));
  expect(loginList('DEMO_VIEWS')).toEqual(['parent', 'leader']);
  expect(familyTaskKinds()).toEqual(['permission', 'form', 'review', 'authorization', 'payment', 'equipment']);
  expect(equipmentCategories()).toContain('other');
  expect(equipmentUnits()).toContain('each');
  expect(materialSorts()).toEqual(['category', 'name', 'available']);

  expect(missing(built)).toEqual([]);
});

test('every demo mission has a title and a text in both languages', () => {
  const source = code(path.join(ROOT, 'spa/modules/demo/DemoBanner.js'));
  const missionKeys = [...source.matchAll(/\{ key: '([a-z_]+)', href:/g)].map((match) => match[1]);
  const keys = missionKeys.flatMap((key) => [
    [`demo_mission_${key}_title`, 'DemoBanner'], [`demo_mission_${key}_text`, 'DemoBanner'],
  ]);

  expect(missionKeys).toEqual(expect.arrayContaining(['points', 'attendance', 'family', 'leader_view']));
  expect(missing(keys)).toEqual([]);
});

test('the dashboard tiles have labels in both languages', () => {
  const tiles = fs.readFileSync(path.join(ROOT, 'spa/config/dashboard-tiles.js'), 'utf8');
  const labels = [...tiles.matchAll(/label: ["']([a-z0-9_]+)["']/g)].map((m) => [m[1], 'dashboard-tiles']);

  expect(labels.length).toBeGreaterThan(20);
  expect(missing(labels)).toEqual([]);
});


test('the role matrix has translated names for the permission catalog and all lock reasons', () => {
  const files = [path.join(ROOT, 'attached_assets/permissions_list.sql'),
    ...fs.readdirSync(path.join(ROOT, 'migrations')).filter((name) => name.endsWith('.sql')).map((name) => path.join(ROOT, 'migrations', name))];
  const keys = new Set(files.flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/'([a-z_]+\.[a-z_]+)'/g)]
    .map((match) => match[1]).filter((key) => !key.startsWith('public.'))));
  const uses = [...keys].map((key) => [`role_permission_${key.replaceAll('.', '_')}`, 'role matrix catalog']);
  for (const reason of ['system_role', 'district_only', 'linked_finance', 'linked_ai', 'not_held', 'view_required', 'demo']) {
    uses.push([`role_matrix_lock_${reason}`, 'role matrix locks']);
  }
  expect(missing(uses)).toEqual([]);
});


test('every shared task status has a label in both languages', () => {
  const { TASK_STATUSES } = require('../../config/tasks');
  const config = fs.readFileSync(path.join(ROOT, 'spa/config.js'), 'utf8');
  const labels = [...config.match(/STATUS_KEYS:\s*\{([^}]+)\}/)[1].matchAll(/([a-z_]+): '([^']+)'/g)];
  expect(labels.map((match) => match[1])).toEqual(TASK_STATUSES);
  expect(missing([...labels.map((match) => [match[2], 'shared task status']), ['role_category_tasks', 'role matrix category']])).toEqual([]);
});

test('every key the starter activity screen holds in a lookup table exists', () => {
  const file = path.join(ROOT, 'spa/modules/yearly-planner/StarterActivities.js');
  const keys = [...code(file).matchAll(/'(starter_[a-z_]+)'/g)].map((match) => [match[1], 'StarterActivities']);

  expect(keys.length).toBeGreaterThan(10);
  expect(missing(keys)).toEqual([]);
});


test('every permission sending state has English and French labels', () => {
  const file = 'spa/modules/activities/AuthorizationResult.js';
  const source = code(path.join(ROOT, file));
  const uses = [...source.matchAll(/['"](authorization_state_[a-z_]+)['"]/g)].map((match) => [match[1], file]);
  expect(uses.length).toBeGreaterThan(5);
  expect(missing(uses)).toEqual([]);
});


test('every equipment lot state, duty and transition has labels in both languages', () => {
  const rules = require('../../config/camp_equipment_lots.json');
  const uses = [
    ...rules.LOT_ROLES.map((role) => [`camp_lot_${role}`, 'lot duties']),
    ...rules.LOT_STATES.flatMap((state) => [[`camp_lot_${state}`, 'lot states'], [`camp_lot_mark_${state}`, 'lot actions']]),
  ];
  expect(missing(uses)).toEqual([]);
});
