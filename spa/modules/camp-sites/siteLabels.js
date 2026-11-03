/**
 * Labels for what a camp site's emergency information still lacks (#1317).
 * The server lists the gaps (`services/campSites.js` emergencyGaps); these are
 * the words for them, the same as the form's field labels.
 *
 * @module spa/modules/camp-sites/siteLabels
 */
import { translate } from '../../app.js';

/** Translation key of each field the server may name as missing. */
export const GAP_LABEL_KEYS = {
  site: 'camp_site_none_chosen',
  phone: 'camp_site_phone',
  address: 'camp_site_address',
  hospital_name: 'camp_site_hospital_name',
  hospital_phone: 'camp_site_hospital_phone',
  hospital_travel_minutes: 'camp_site_hospital_minutes',
  poison_centre_phone: 'camp_site_poison_centre',
  directions_url: 'camp_site_directions',
};

/**
 * @param {{gaps?: string[]}|string[]|null} source - A site carrying its gaps, or the gaps themselves
 * @returns {string[]} What is missing, in words
 */
export function emergencyGapLabels(source) {
  const gaps = Array.isArray(source) ? source : (source?.gaps || []);
  return gaps.map((gap) => translate(GAP_LABEL_KEYS[gap] || 'camp_readiness_unknown'));
}
