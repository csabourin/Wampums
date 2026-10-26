'use strict';

/**
 * A unit's subdomain: the address its members sign in at, and the one emailed
 * links name (utils/public-url.js). The rules live in
 * config/unit_subdomains.json, which the SPA reads too, so the form refuses
 * what the server would.
 *
 * @module utils/unitSubdomains
 */

const subdomainConfig = require('../config/unit_subdomains.json');

const RESERVED = new Set(subdomainConfig.reserved);

/**
 * One DNS label: lowercase letters, digits and inner hyphens, never two in a
 * row (`xn--` is how browsers spell internationalized names).
 */
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Why a subdomain cannot be used, or null when it can.
 *
 * @param {string} subdomain - Label, already trimmed and lowercased
 * @returns {string|null} `subdomain_invalid`, `subdomain_reserved` or null
 */
function subdomainProblem(subdomain) {
  if (subdomain.length < subdomainConfig.minLength
    || subdomain.length > subdomainConfig.maxLength
    || !LABEL_PATTERN.test(subdomain)
    || subdomain.includes('--')) {
    return 'subdomain_invalid';
  }
  return RESERVED.has(subdomain) ? 'subdomain_reserved' : null;
}

/**
 * Read the subdomain of a unit being created.
 *
 * @param {*} value - `subdomain` from the request body
 * @returns {{subdomain: string|null, hostname: string|null, problem: string|null}}
 *   The label and the hostname stored in organization_domains, or the reason it was refused
 */
function readUnitSubdomain(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { subdomain: null, hostname: null, problem: 'subdomain_required' };
  }
  const subdomain = value.trim().toLowerCase();
  const problem = subdomainProblem(subdomain);
  return problem
    ? { subdomain: null, hostname: null, problem }
    : { subdomain, hostname: `${subdomain}.${subdomainConfig.baseDomain}`, problem: null };
}

module.exports = { subdomainConfig, readUnitSubdomain };
