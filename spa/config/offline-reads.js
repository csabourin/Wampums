/**
 * Offline reads of everyday screens (spa/indexedDB.js,
 * spa/modules/offline/OfflineBaseline.js). Kept apart from spa/config.js so
 * the IndexedDB layer does not depend on the build environment.
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
  /** The everyday screens are read again at most this often per account and unit. */
  BASELINE_MIN_INTERVAL_MS: 15 * MS_PER_MINUTE,
  /** Volunteer-space camps prepared after the overview, in the order it lists them. */
  BASELINE_MAX_CAMPS: 3,
  /** Event the sign-in screen sends once a session is stored. */
  SIGNED_IN_EVENT: 'wampums:signedIn',
});
