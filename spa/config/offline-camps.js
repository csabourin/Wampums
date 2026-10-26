const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_SECOND = 1000;
const MINUTE_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;
/** Preparation policy shared by the automatic coordinator and device verification. */
export const OFFLINE_CAMPS = Object.freeze({
  LOOKAHEAD_DAYS: 7,
  REFRESH_MS: HOUR_MS,
  RETRY_MS: MINUTE_MS,
  ASSET_CHECK_TIMEOUT_MS: 10000,
  ASSET_SETTLE_MS: 500,
  MAX_DAYS: 14,
  EXPIRY_BUFFER_DAYS: 2,
  DAY_MS: HOURS_PER_DAY * HOUR_MS,
  /** The dashboard speaks of a camp from this long before it starts until it ends. */
  DASHBOARD_NOTICE_MS: HOURS_PER_DAY * HOUR_MS,
});
