/**
 * Time units, so durations read `5 * MS_PER_MINUTE` rather than `5 * 60 * 1000`.
 */
export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;
export const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
export const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
export const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;
export const MS_PER_WEEK = DAYS_PER_WEEK * MS_PER_DAY;

/** Lengths of ISO 8601 text: 2026-11-04, 2026-11, 2026-11-04T18:30, 18:30. */
export const ISO_DATE_LENGTH = 10;
export const ISO_MONTH_LENGTH = 7;
export const ISO_MINUTE_LENGTH = 16;
export const TIME_HH_MM_LENGTH = 5;
/** Width of a zero-padded month, day, hour or minute. */
export const DATE_PART_WIDTH = 2;
