'use strict';

/**
 * Calendar subscriptions: the private link a calendar app polls.
 *
 * A link stands for its holder, the way an emailed invitation does, so it is
 * an opaque token of which only the digest is stored (utils/invitation-tokens).
 * It says who the feed is for, never what they may see: the route re-checks
 * membership and activities.view on every fetch (middleware/auth.js).
 *
 * @module services/calendarFeeds
 */

const { generateInvitationToken, digestInvitationToken } = require('../utils/invitation-tokens');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');

/** Where calendar apps fetch a feed, under the unit's public address. */
const FEED_PATH = '/api/v1/calendar-feeds';

/**
 * The link to give a calendar app, and the webcal:// form that opens the
 * subscription dialog of the person's own calendar app.
 *
 * @param {string} baseUrl - The unit's public origin (https://…)
 * @param {string} token - Raw token, shown once
 * @returns {{url: string, webcal_url: string}} Both forms of the link
 */
function feedUrls(baseUrl, token) {
  const url = `${baseUrl.replace(/\/+$/, '')}${FEED_PATH}/${token}.ics`;
  return { url, webcal_url: url.replace(/^https?:\/\//i, 'webcal://') };
}

/**
 * The person's active link, without its token (which is not kept).
 *
 * @param {import('pg').Pool} pool - Database pool
 * @param {{organizationId: number, userId: string}} owner - Unit and account
 * @returns {Promise<{active: boolean, created_at: ?string, last_used_at: ?string}>}
 */
async function getFeedStatus(pool, { organizationId, userId }) {
  const result = await pool.query(
    `SELECT created_at, last_used_at FROM calendar_feed_tokens
      WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [organizationId, userId]
  );
  const feed = result.rows[0];
  return {
    active: Boolean(feed),
    created_at: feed?.created_at || null,
    last_used_at: feed?.last_used_at || null,
  };
}

/**
 * Make a new link, revoking the person's previous one in the same transaction.
 * The raw token leaves this function once, inside the URL, and is never
 * stored or logged. The unit's address is resolved first: a link stored but
 * never shown would have replaced a working one for nothing.
 *
 * @param {import('pg').Pool} pool - Database pool
 * @param {{organizationId: number, userId: string}} owner - Unit and account
 * @returns {Promise<{url: string, webcal_url: string, created_at: string}>}
 */
async function createFeed(pool, { organizationId, userId }) {
  const baseUrl = await resolveOrganizationBaseUrl(pool, organizationId);
  const { token, digest } = generateInvitationToken();
  const client = await pool.connect();
  let createdAt;
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE calendar_feed_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [organizationId, userId]
    );
    const inserted = await client.query(
      `INSERT INTO calendar_feed_tokens (organization_id, user_id, token_digest)
       VALUES ($1, $2, $3) RETURNING created_at`,
      [organizationId, userId, digest]
    );
    createdAt = inserted.rows[0].created_at;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ...feedUrls(baseUrl, token), created_at: createdAt };
}

/**
 * Disable the person's link. Doing it twice is harmless.
 *
 * @param {import('pg').Pool} pool - Database pool
 * @param {{organizationId: number, userId: string}} owner - Unit and account
 * @returns {Promise<boolean>} Whether a link was active
 */
async function revokeFeed(pool, { organizationId, userId }) {
  const result = await pool.query(
    `UPDATE calendar_feed_tokens SET revoked_at = CURRENT_TIMESTAMP
      WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [organizationId, userId]
  );
  return result.rowCount > 0;
}

/**
 * Who an active link stands for, from the token in a feed URL.
 *
 * @param {import('pg').Pool} pool - Database pool
 * @param {string} token - Token from the URL, with or without ".ics"
 * @returns {Promise<?{id: number, organizationId: number, userId: string}>}
 *   The link's holder, or null for an unknown, revoked or malformed token
 */
async function findActiveFeed(pool, token) {
  const digest = digestInvitationToken(String(token || '').replace(/\.ics$/i, ''));
  if (!digest) {
    return null;
  }
  const result = await pool.query(
    `SELECT id, organization_id, user_id FROM calendar_feed_tokens
      WHERE token_digest = $1 AND revoked_at IS NULL`,
    [digest]
  );
  const feed = result.rows[0];
  return feed ? { id: feed.id, organizationId: Number(feed.organization_id), userId: feed.user_id } : null;
}

/**
 * Note that a calendar app fetched the feed.
 *
 * @param {import('pg').Pool} pool - Database pool
 * @param {number} feedId - Link id
 * @returns {Promise<void>}
 */
async function recordFeedUse(pool, feedId) {
  await pool.query('UPDATE calendar_feed_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1', [feedId]);
}

module.exports = {
  FEED_PATH,
  feedUrls,
  getFeedStatus,
  createFeed,
  revokeFeed,
  findActiveFeed,
  recordFeedUse,
};
