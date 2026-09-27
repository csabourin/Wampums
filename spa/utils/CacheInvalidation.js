/**
 * What a write makes stale, and removing it from the cache.
 *
 * A cached entry is found by the API paths it was built from (recorded as
 * `sources` when it is written), not by its key: screens name their keys
 * freely ("points_report", "participants_v2", "attendance_2026-09-27"), so a
 * key-based match missed most of them and a deleted child stayed on the
 * points and attendance screens until the entry expired.
 *
 * Changing the roster (children, groups, accounts linked to children) touches
 * almost every screen, so it clears every cached response except the unit's
 * configuration. Other writes clear their own resource and the screens known
 * to be derived from it.
 *
 * This wide invalidation is only for a connected session. Offline, and in camp
 * mode, the cache is the only copy of the data, so writes there keep clearing
 * just the resource they touched (see `cachePathsForMutation`).
 */
import { clearCacheEntriesWhere } from '../indexedDB.js';
import {
  buildScopedCacheKey,
  cachePathsForMutation,
  normalizeApiPath
} from './OfflineCacheKeys.js';

const API_V1_PREFIX = '/api/v1/';
const SCOPE_SEPARATOR = '|scope:';

/** Resources whose changes reach nearly every screen. */
const ROSTER_RESOURCES = new Set([
  'participants',
  'groups',
  'local-groups',
  'guardians',
  'users',
  'family-links',
  'family-link-requests',
  'parent-invitations',
  'parent-onboarding',
  'participant-duplicates',
  'walk-in-children',
  'transfers',
  'alumni',
  'scout-years',
  'import',
  'offline'
]);

/** Writes under a roster resource that change only the caller's own account. */
const PERSONAL_SUB_RESOURCES = { users: new Set(['me']) };

/**
 * POST endpoints that only read. They change nothing, so they invalidate nothing.
 */
const READ_ONLY_WRITES = [
  '/api/v1/users/permissions/check',
  '/api/v1/transfers/preview'
];

/** Resources whose writes never change shared data (AI queries). */
const UNSHARED_RESOURCES = new Set(['ai']);

/**
 * Configuration kept when the roster changes: nothing in it depends on which
 * children are enrolled.
 */
const STABLE_PATHS = [
  '/api/v1/organizations',
  '/api/v1/roles',
  '/api/v1/public',
  '/api/v1/app-version',
  '/api/v1/users/me',
  '/api/v1/forms/types',
  '/api/v1/forms/structure',
  '/api/v1/forms/formats',
  '/api/v1/form-builder',
  '/api/v1/badges/settings',
  '/api/v1/finance/fee-definitions',
  '/api/v1/budget/categories'
];

/**
 * Screens derived from a resource, beyond the resource itself. A write to the
 * key clears every entry built from any of the listed resources.
 */
const DERIVED_RESOURCES = {
  points: ['points', 'groups', 'participants', 'honors', 'reports', 'dashboards'],
  attendance: ['attendance', 'points', 'participants', 'meetings', 'reports', 'dashboards'],
  honors: ['honors', 'points', 'participants', 'reports', 'dashboards'],
  badges: ['badges', 'program-progress', 'participants', 'reports', 'dashboards'],
  'program-progress': ['program-progress', 'badges', 'reports'],
  meetings: ['meetings', 'attendance', 'activities', 'yearly-planner', 'dashboards'],
  activities: ['activities', 'attendance', 'carpools', 'meetings', 'dashboards'],
  carpools: ['carpools', 'activities'],
  forms: ['forms', 'participants', 'medication', 'reports'],
  medication: ['medication', 'reports'],
  finance: ['finance', 'participants', 'reports', 'dashboards'],
  fundraisers: ['fundraisers', 'calendars', 'finance'],
  calendars: ['calendars', 'fundraisers', 'finance'],
  budget: ['budget', 'expenses', 'revenue'],
  expenses: ['expenses', 'budget'],
  revenue: ['revenue', 'budget'],
  resources: ['resources', 'activities']
};

/**
 * Entries screens compose themselves and store under a bare name, with the
 * resources they were built from. Checked when an entry carries no `sources`.
 * A name ending in "_" or "-" matches every key starting with it.
 */
const SNAPSHOT_SOURCES = [
  ['manage_points_data', ['participants', 'groups', 'points', 'attendance']],
  ['manage_participants_data', ['participants', 'groups', 'users']],
  ['attendance_', ['attendance', 'participants', 'groups', 'activities']],
  ['dashboard_groups', ['groups', 'points']],
  ['dashboard_participant_info', ['participants', 'groups', 'points']],
  ['badge_dashboard_', ['badges', 'participants', 'groups']],
  ['honors_', ['honors', 'participants']],
  ['carpool_', ['carpools', 'activities', 'participants']],
  ['activity_', ['activities']],
  ['incident_reports', ['incidents']],
  ['reunion_', ['meetings']],
  ['form-submission-', ['forms', 'participants']],
  ['fiche-sante-', ['forms', 'participants']],
  ['acceptation-risque-', ['forms', 'participants']]
].map(([name, resources]) => [name, resources.map(toResourcePath)]);

/**
 * @param {string} resource - Resource name, e.g. "points"
 * @returns {string} Its API path, e.g. "/api/v1/points"
 */
function toResourcePath(resource) {
  return `${API_V1_PREFIX}${resource}`;
}

/**
 * @param {string} path - Normalized API path
 * @param {string} prefix - Resource path
 * @returns {boolean} Whether the path is the resource or one of its sub-paths
 */
function isUnder(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * @param {string} key - Stored cache key
 * @returns {string} The key without its user/organization scope suffix
 */
function unscopedKey(key) {
  const index = key.indexOf(SCOPE_SEPARATOR);
  return index === -1 ? key : key.slice(0, index);
}

/**
 * The scope suffix of the signed-in user in the current unit, without the
 * archived-year part, so entries for every year of this unit match.
 * @returns {string} e.g. "|scope:user:u1|org:12"
 */
function currentScope() {
  return buildScopedCacheKey('').replace(/\|year:\d+$/, '');
}

/**
 * @param {string} key - Stored cache key
 * @param {string} scope - Result of currentScope()
 * @returns {boolean} Whether the entry belongs to the current user and unit
 */
function isInScope(key, scope) {
  return key.endsWith(scope) || key.includes(`${scope}|`);
}

/**
 * The API paths an entry was built from.
 * @param {Object} record - Stored cache record
 * @returns {string[]|null} Paths, or null when they cannot be known
 */
function sourcesOf(record) {
  if (Array.isArray(record.sources) && record.sources.length > 0) {
    return record.sources;
  }

  const name = unscopedKey(String(record.key));
  if (name.startsWith('/api/')) {
    return [normalizeApiPath(name)];
  }

  const snapshot = SNAPSHOT_SOURCES.find(([snapshotName]) => (
    /[_-]$/.test(snapshotName) ? name.startsWith(snapshotName) : name === snapshotName
  ));
  return snapshot ? snapshot[1] : null;
}

/**
 * Decide which API paths a write to `endpoint` makes stale.
 *
 * @param {string} endpoint - Endpoint or URL that was written
 * @returns {{ matchesPath: function(string): boolean, clearsUnknown: boolean }|null}
 *   A matcher for affected paths, and whether entries of unknown origin go too;
 *   null when the write changes nothing cached
 */
export function planInvalidation(endpoint) {
  const path = normalizeApiPath(endpoint);
  if (READ_ONLY_WRITES.includes(path)) {
    return null;
  }

  if (!path.startsWith(API_V1_PREFIX)) {
    const paths = cachePathsForMutation(path);
    return paths.length === 0
      ? null
      : { matchesPath: (candidate) => paths.some((prefix) => isUnder(candidate, prefix)), clearsUnknown: false };
  }

  const [resource, subResource] = path.slice(API_V1_PREFIX.length).split('/');
  if (!resource || UNSHARED_RESOURCES.has(resource)) {
    return null;
  }

  const isPersonal = PERSONAL_SUB_RESOURCES[resource]?.has(subResource);
  if (ROSTER_RESOURCES.has(resource) && !isPersonal) {
    return {
      matchesPath: (candidate) => !STABLE_PATHS.some((stable) => isUnder(candidate, stable)),
      clearsUnknown: true
    };
  }

  const prefixes = [
    ...(DERIVED_RESOURCES[resource] || [resource]).map(toResourcePath),
    ...cachePathsForMutation(path)
  ];
  return {
    matchesPath: (candidate) => prefixes.some((prefix) => isUnder(candidate, prefix)),
    clearsUnknown: false
  };
}

/**
 * The plan used when changes may have been missed (the live connection was
 * down): everything but the unit's configuration.
 * @returns {{ matchesPath: function(string): boolean, clearsUnknown: boolean }}
 */
export function planFullRefresh() {
  return planInvalidation(toResourcePath('participants'));
}

/**
 * Remove the current user's cached entries a plan selects.
 *
 * @param {{ matchesPath: function(string): boolean, clearsUnknown: boolean }|null} plan
 * @returns {Promise<{ deletedKeys: string[], matchesPath: function(string): boolean }>}
 *   Removed keys and the path matcher, so callers can tell whether the page
 *   on screen showed any of it
 */
export async function applyInvalidation(plan) {
  if (!plan) {
    return { deletedKeys: [], matchesPath: () => false };
  }

  const scope = currentScope();
  const deletedKeys = await clearCacheEntriesWhere((record) => {
    const key = String(record.key);
    if (!isInScope(key, scope)) {
      return false;
    }
    const sources = sourcesOf(record);
    return sources === null
      ? plan.clearsUnknown
      : sources.some((source) => plan.matchesPath(source));
  });

  return { deletedKeys, matchesPath: plan.matchesPath };
}

/**
 * Invalidate what a write to `endpoint` made stale.
 * @param {string} endpoint - Endpoint or URL that was written
 * @returns {Promise<{ deletedKeys: string[], matchesPath: function(string): boolean }>}
 */
export function invalidateForWrite(endpoint) {
  return applyInvalidation(planInvalidation(endpoint));
}
