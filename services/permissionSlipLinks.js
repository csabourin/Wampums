/**
 * The emailed links of a permission slip (migration 091).
 *
 * Each email carries a link of its own; only its SHA-256 is stored. A link
 * opens its slip for whoever holds it, until the slip's text is reissued (its
 * generation, `permission_slips.access_token`, changes). The token is never
 * logged, stored or returned except in the link it was made for.
 *
 * @module services/permissionSlipLinks
 */
const { generateInvitationToken, digestInvitationToken } = require('../utils/invitation-tokens');

/** A token as a link carries it: base64url, or a UUID from before migration 091. */
const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * SQL condition naming the slip a link digest opens ($n is the digest).
 * @param {string} param - Placeholder of the digest, e.g. '$1'
 * @returns {string} Condition on `ps`
 */
const slipByLinkSql = (param) => `ps.id = (
  SELECT l.slip_id FROM permission_slip_links l
    JOIN permission_slips current ON current.id = l.slip_id AND current.access_token = l.slip_generation
   WHERE l.token_digest = ${param})`;

/**
 * Make a link for one slip of the unit.
 * @param {Object} db - Pool or client
 * @param {number} organizationId - The slip's unit
 * @param {number} slipId - Slip
 * @returns {Promise<string|null>} The token for the link, or null when the unit has no such slip
 */
async function issueSlipLink(db, organizationId, slipId) {
  const { token, digest } = generateInvitationToken();
  const result = await db.query(
    `INSERT INTO permission_slip_links (organization_id, slip_id, slip_generation, token_digest)
     SELECT organization_id, id, access_token, $3 FROM permission_slips
      WHERE id = $1 AND organization_id = $2
     RETURNING id`,
    [slipId, organizationId, digest]
  );
  return result.rows.length ? token : null;
}

/**
 * The digest a link's token is looked up by, or null for a token no link could carry.
 * @param {string} token - Token from the link
 * @returns {string|null} Digest
 */
function linkDigest(token) {
  return typeof token === 'string' && LINK_TOKEN_PATTERN.test(token) ? digestInvitationToken(token) : null;
}

module.exports = { LINK_TOKEN_PATTERN, slipByLinkSql, issueSlipLink, linkDigest };
