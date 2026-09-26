'use strict';

/**
 * Tokens for links that arrive by email and act on behalf of whoever holds them.
 *
 * The other emailed links in this codebase — alumni consent, membership
 * reactivation — are signed JWTs carrying a `purpose` claim. That works when
 * the link's whole meaning is "the bearer controls this address", because such
 * a link has nothing to revoke: it either verifies or it does not.
 *
 * An invitation is different. It has a life: an admin can withdraw it, a resend
 * has to kill the previous link, and accepting it once must make the second
 * click do nothing. None of that can be expressed in a self-contained signed
 * token, because a JWT stays valid until it expires no matter what the database
 * thinks. So these tokens carry no claims at all. They are opaque random
 * strings whose only meaning is the row they match, which puts every question
 * about validity where it can still be answered: in the database, now.
 *
 * What is stored is the SHA-256 of the token, never the token. A read-only leak
 * of `parent_invitations` therefore yields nothing usable — recognising a link
 * and being able to mint one are kept deliberately far apart.
 *
 * Cross-purpose replay needs no `purpose` claim here: an invitation token's
 * digest exists only in the invitations table and a family-link token's only in
 * the requests table, so a token presented to the wrong endpoint matches
 * nothing. The purpose is the lookup.
 *
 * @module utils/invitation-tokens
 */

const { randomBytes, createHash } = require('crypto');

/**
 * 256 bits, which is the point past which guessing stops being a strategy.
 * base64url-encoded this is 43 characters — long enough to be unguessable,
 * short enough that a mail client is unlikely to wrap it.
 */
const TOKEN_BYTE_LENGTH = 32;

/** Hex SHA-256 is 64 characters, which is what the `character(64)` columns hold. */
const TOKEN_DIGEST_LENGTH = 64;

/**
 * How long an emailed link stays usable.
 *
 * Seven days, matching the reactivation link, and for the same reason: a week
 * survives a holiday or a forwarded message without leaving a standing key to
 * a unit sitting in an inbox indefinitely.
 */
const DEFAULT_TOKEN_TTL_DAYS = 7;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Mint a link token and the digest to store beside it.
 *
 * The raw token is returned once, to be put in exactly one email and then
 * forgotten. It must never be logged, persisted, or written into an audit
 * trail: anyone holding it can act as the invited person.
 *
 * @returns {{token: string, digest: string}} The token for the link, and the
 *   digest for the database
 */
function generateInvitationToken() {
  const token = randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
  return { token, digest: digestInvitationToken(token) };
}

/**
 * Reduce a token from a request to the form stored in the database.
 *
 * Returns null rather than a digest for anything that is not a non-empty
 * string, so a missing or malformed `?token=` never reaches the database as a
 * lookup that could match a row by accident.
 *
 * @param {string} token - Raw token as it arrived in the link
 * @returns {string|null} Lower-case hex SHA-256, or null when there is nothing
 *   to hash
 */
function digestInvitationToken(token) {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  return createHash('sha256').update(trimmed, 'utf8').digest('hex');
}

/**
 * The moment a link minted now should stop working.
 *
 * @param {Object} [options] - Expiry inputs
 * @param {number} [options.days] - Lifetime in days
 * @param {Date} [options.from] - Clock reading to count from, for tests
 * @returns {Date} Expiry timestamp
 */
function invitationExpiresAt({ days = DEFAULT_TOKEN_TTL_DAYS, from = new Date() } = {}) {
  return new Date(from.getTime() + days * MILLISECONDS_PER_DAY);
}

/**
 * Whether a stored expiry has passed.
 *
 * A row with no expiry is treated as expired. That direction is deliberate: a
 * missing value means something went wrong when the row was written, and the
 * safe reading of a broken invitation is that it does not work.
 *
 * @param {Date|string|null} expiresAt - Value read from the database
 * @param {Date} [now] - Clock reading, for tests
 * @returns {boolean} True when the link is no longer usable
 */
function isInvitationExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return true;
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return true;
  return expiry.getTime() <= now.getTime();
}

module.exports = {
  TOKEN_BYTE_LENGTH,
  TOKEN_DIGEST_LENGTH,
  DEFAULT_TOKEN_TTL_DAYS,
  generateInvitationToken,
  digestInvitationToken,
  invitationExpiresAt,
  isInvitationExpired,
};
