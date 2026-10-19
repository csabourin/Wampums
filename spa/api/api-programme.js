/**
 * The day's programme, for the leaders' "now / next" bar.
 *
 * @module spa/api/api-programme
 */
import { API } from './api-core.js';
import { CONFIG } from '../config.js';

/**
 * The programme running on a day: a meeting's timeline, or one day of a camp.
 * Kept for a day, as the copy to fall back on when offline, so the bar keeps
 * working at camp; the bar itself always asks the server first.
 *
 * @param {string} date - The phone's day, YYYY-MM-DD
 * @param {{forceRefresh?: boolean, cacheDuration?: number}} [options]
 * @returns {Promise<Object>} API response; `data` is null when nothing is planned
 */
export function getDayProgramme(date, options = {}) {
  return API.get('v1/meetings/programme', { date }, {
    cacheDuration: options.cacheDuration ?? CONFIG.CACHE_DURATION.LONG,
    forceRefresh: options.forceRefresh === true,
  });
}
