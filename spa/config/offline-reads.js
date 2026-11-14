/**
 * Offline reads of everyday screens (spa/indexedDB.js, spa/api/api-core.js,
 * spa/modules/offline/OfflineBaseline.js, devdocs/OFFLINE_EVERYDAY.md). Kept
 * apart from spa/config.js so the IndexedDB layer does not depend on the
 * build environment.
 */
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

export const OFFLINE_READS = Object.freeze({
  /**
   * How long a copy the server confirmed stays readable offline after its
   * freshness (CONFIG.CACHE_DURATION) has passed. Past it, the copy is removed
   * rather than shown: contact lists must not linger on a lost phone.
   */
  RETENTION_MS: 14 * MS_PER_DAY,
  /** Wakes (return to the app, reconnection) prepare again at most this often. */
  BASELINE_MIN_INTERVAL_MS: 15 * MS_PER_MINUTE,
  /** A prepared read is read again once its copy is this old. */
  BASELINE_ENTRY_MAX_AGE_MS: 30 * MS_PER_MINUTE,
  /** Reads sent at once while preparing, so the screen on display stays quick. */
  BASELINE_CONCURRENCY: 4,
  /** Preparation waits this long after launch, for the first screen to load. */
  BASELINE_START_DELAY_MS: 3000,
  /** Volunteer-space camps prepared after the overview, in the order it lists them. */
  BASELINE_MAX_CAMPS: 3,
  /** Activities whose carpools are prepared: the next ones, within this many days. */
  BASELINE_ACTIVITY_LOOKAHEAD_DAYS: 30,
  BASELINE_MAX_ACTIVITIES: 5,
  /**
   * Days whose roster, attendance, honors and programme are prepared: today,
   * the next days (a trip without signal) and the next meeting.
   */
  BASELINE_DAYS_AHEAD: 3,
  /** Reads a person made on any screen, kept fresh for offline use (most recent first). */
  REGISTRY_MAX_ENTRIES: 120,
  REGISTRY_STORAGE_KEY: 'wampums.offlineReads',
  /** Event the sign-in screen sends once a session is stored. */
  SIGNED_IN_EVENT: 'wampums:signedIn',
});

/**
 * Reads that are never kept on the device. Every other read keeps a copy for
 * offline use, `API.getNoCache` included (network first, copy as fallback).
 * Each entry says why; a new one needs a reason of the same weight.
 */
export const NETWORK_ONLY_READS = Object.freeze([
  // Personal contacts, health and certifications (devdocs/MEMBER_PROFILE.md).
  { pattern: /^v1\/member-profile\//, reason: 'personal contacts and health' },
  { pattern: /^v1\/member-allergies\//, reason: 'personal health' },
  { pattern: /^v1\/member-certifications\//, reason: 'personal certifications' },
  // Consent to share a phone cannot be checked offline (devdocs/VOLUNTEER_SPACE.md).
  { pattern: /^v1\/volunteer-space\/camps\/[^/]+\/contacts\/?$/, reason: 'revocable consented contacts' },
  // Adult health forms of the camp team (devdocs/CAMP_ROSTERS.md).
  { pattern: /^v1\/camp-rosters\//, reason: 'camp team health' },
  // Submitted plans name youth and allergies (src-sw.js isPersonalProfileRequest).
  { pattern: /^v1\/camp-plans\/camps\/[^/]+\/versions(?:\/|$)/, reason: 'submitted camp plan versions' },
  // Secrets and links that expire.
  { pattern: /^v1\/calendar-feed\/?$/, reason: 'personal subscription link' },
  { pattern: /^v1\/resources\/equipment\/[^/]+\/photo\/?$/, reason: 'signed photo URL that expires' },
  { pattern: /^v1\/organizations\/settings\/email-sender\/?$/, reason: 'mail sender configuration' },
  { pattern: /^v1\/google-chat\//, reason: 'integration configuration' },
  // Live access checks and changes that only the server can make.
  { pattern: /^v1\/users\/me\/access\/?$/, reason: 'live access check' },
  { pattern: /^v1\/roles\/matrix\/?$/, reason: 'role editor (online-only changes)' },
  { pattern: /^v1\/organizations\/domains\/?$/, reason: 'unit addresses editor' },
  { pattern: /^v1\/parent-invitations(?:\/|$)/, reason: 'invitations (online-only)' },
  { pattern: /^v1\/parent-onboarding\//, reason: 'family registration (online-only)' },
  { pattern: /^v1\/family-links\/?$/, reason: 'family links (online-only)' },
  { pattern: /^v1\/participant-duplicates\/?$/, reason: 'merging records (online-only)' },
  { pattern: /^v1\/alumni(?:\/|$)/, reason: 'alumni invitations (online-only)' },
  { pattern: /^v1\/scout-years\/(?:transition|transitions|memberships)(?:\/|$)/, reason: 'scout-year change (online-only)' },
  { pattern: /^v1\/transfers\//, reason: 'transfers between units (online-only)' },
  { pattern: /^v1\/yearly-planner\/meetings\/[^/]+\/duplication\/?$/, reason: 'camp duplication (online-only)' },
]);

/**
 * Whether a read must never be kept on the device.
 * @param {string} endpoint - Endpoint as given to API (e.g. `v1/messages`)
 * @returns {boolean}
 */
export function isNetworkOnlyRead(endpoint) {
  const path = String(endpoint || '').replace(/^\/+/, '').replace(/^api\//, '').split('?')[0];
  return NETWORK_ONLY_READS.some(({ pattern }) => pattern.test(path));
}
