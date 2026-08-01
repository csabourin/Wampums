'use strict';

const DEFAULT_PUBLIC_BASE_URL = 'https://wampums.app';

function normalizeOrigin(value) {
  if (!value || typeof value !== 'string' || value.includes('*')) return null;
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch (_error) {
    return null;
  }
}

/**
 * Resolve a trusted origin for links sent by email.
 * Request headers are deliberately not accepted as input.
 */
async function resolveOrganizationBaseUrl(pool, organizationId) {
  const configured = normalizeOrigin(process.env.PUBLIC_BASE_URL || process.env.APP_URL);
  if (configured) return configured;

  if (pool && organizationId) {
    const { rows } = await pool.query(
      `SELECT domain
         FROM organization_domains
        WHERE organization_id = $1
          AND domain NOT LIKE '%*%'
        ORDER BY created_at ASC, domain ASC
        LIMIT 1`,
      [organizationId]
    );
    const organizationOrigin = normalizeOrigin(rows[0]?.domain);
    if (organizationOrigin) return organizationOrigin;
  }

  return DEFAULT_PUBLIC_BASE_URL;
}

module.exports = { DEFAULT_PUBLIC_BASE_URL, normalizeOrigin, resolveOrganizationBaseUrl };
