/**
 * The time zones a unit may choose, each named after the large cities that
 * keep it (config/unit_time_zones.json, shared with the server).
 *
 * @module spa/utils/TimeZoneUtils
 */
import UNIT_TIME_ZONES from '../../config/unit_time_zones.json';
import { localeForLanguage } from './InterfaceLanguageUtils.js';

/** Where a unit is until it says otherwise. */
export const DEFAULT_TIME_ZONE = UNIT_TIME_ZONES.default;

/** Regions in the order shown, each with its zones: `[{ key, zones }]`. */
export const TIME_ZONE_REGIONS = UNIT_TIME_ZONES.regions;

/**
 * Whether a zone is one of those offered by city.
 *
 * @param {string} timeZone - IANA name
 * @returns {boolean} True when the list offers it
 */
export function isOfferedTimeZone(timeZone) {
  return TIME_ZONE_REGIONS.some((region) => region.zones.includes(timeZone));
}

/**
 * Translation key of the cities that keep a zone.
 *
 * @param {string} timeZone - IANA name, e.g. `America/Toronto`
 * @returns {string} Key, e.g. `unit_time_zone_city_america_toronto`
 */
export function timeZoneCityKey(timeZone) {
  return `unit_time_zone_city_${String(timeZone).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

/**
 * Translation key of a region's name.
 *
 * @param {string} regionKey - Region key from the configuration
 * @returns {string} Key, e.g. `unit_time_zone_region_canada`
 */
export function timeZoneRegionKey(regionKey) {
  return `unit_time_zone_region_${regionKey}`;
}

/**
 * A zone's present offset from UTC, as the reader's language writes it
 * ("UTC−5", "GMT-5"). It follows daylight saving time.
 *
 * @param {string} timeZone - IANA name
 * @param {string} lang - Interface language
 * @param {Date} [now] - Instant to describe
 * @returns {string} Offset, or '' when the browser does not know the zone
 */
export function timeZoneOffset(timeZone, lang, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat(localeForLanguage(lang), { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(now);
    return parts.find((part) => part.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

/**
 * The time of day in a zone, written for the reader's language.
 *
 * @param {string} timeZone - IANA name
 * @param {string} lang - Interface language
 * @param {Date} [now] - Instant to describe
 * @returns {string} Time, or '' when the browser does not know the zone
 */
export function timeInZone(timeZone, lang, now = new Date()) {
  try {
    return new Intl.DateTimeFormat(localeForLanguage(lang), { timeZone, hour: 'numeric', minute: '2-digit' }).format(now);
  } catch {
    return '';
  }
}
