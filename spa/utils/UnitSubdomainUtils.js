/**
 * A unit's subdomain, as the creation form suggests and checks it. The rules
 * are config/unit_subdomains.json, which the server applies too
 * (utils/unitSubdomains.js); a test keeps both readings equal.
 *
 * @module spa/utils/UnitSubdomainUtils
 */
import subdomainConfig from '../../config/unit_subdomains.json';

const RESERVED = new Set(subdomainConfig.reserved);
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const COMBINING_MARKS = /[̀-ͯ]/g;

/** The domain every unit's subdomain sits under. */
export const UNIT_BASE_DOMAIN = subdomainConfig.baseDomain;
/** The longest label DNS allows. */
export const SUBDOMAIN_MAX_LENGTH = subdomainConfig.maxLength;

/**
 * A subdomain drawn from a unit's name: accents dropped, every other
 * character a hyphen. "Meute 6e Lac-aux-Castors" → "meute-6e-lac-aux-castors".
 *
 * @param {string} name - The unit's name
 * @returns {string} A suggestion, or '' when the name gives too little
 */
export function suggestSubdomain(name) {
  const slug = String(name ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, subdomainConfig.maxLength)
    .replace(/-+$/, '');
  return slug.length >= subdomainConfig.minLength ? slug : '';
}

/**
 * Why a subdomain cannot be used, as the server would say it.
 *
 * @param {string} value - What the person typed
 * @returns {string|null} `subdomain_required`, `subdomain_invalid`, `subdomain_reserved`, or null
 */
export function subdomainProblem(value) {
  const subdomain = String(value ?? '').trim().toLowerCase();
  if (!subdomain) {
    return 'subdomain_required';
  }
  if (subdomain.length < subdomainConfig.minLength
    || subdomain.length > subdomainConfig.maxLength
    || !LABEL_PATTERN.test(subdomain)
    || subdomain.includes('--')) {
    return 'subdomain_invalid';
  }
  return RESERVED.has(subdomain) ? 'subdomain_reserved' : null;
}
