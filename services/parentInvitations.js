'use strict';

/**
 * Parent invitations — what an invitation is, and what a link is worth.
 *
 * An admin typing a parent's address is not a registration. Public
 * registration creates a `users` row and a membership immediately, which is
 * right for someone filling the form themselves and wrong for an address a
 * third party typed: it would put an account into the world that its owner
 * never asked for, holding a password they did not choose. So an invitation is
 * a row of its own, and nothing about a real person exists until the person on
 * the other end of the address acts.
 *
 * This module is the reading half of that: what state a link is in, decided
 * from the database at the moment it is asked. The writing half — creating,
 * accepting, revoking — builds on the vocabulary defined here.
 *
 * Two rules shape the state model:
 *
 * 1. **Describing is not acting.** Everything here is read-only. Mail clients
 *    and link scanners fetch URLs before a human sees them, so a GET that
 *    created an account would hand out accounts to security software. The
 *    landing page asks this module what it is looking at; only a later POST
 *    changes anything.
 * 2. **The token asks, the database decides.** Borrowed from
 *    {@link module:services/reactivation}: a token carries no outcome, only an
 *    identity. Whether a link still works is re-derived from current row state
 *    and the current clock, so an invitation revoked on Tuesday is dead on
 *    Tuesday even though the email says otherwise.
 *
 * @module services/parentInvitations
 */

const { digestInvitationToken, isInvitationExpired } = require('../utils/invitation-tokens');

/**
 * What a landing page can be looking at.
 *
 * `ready_new_account` and `ready_existing_account` are separated because the
 * page differs in the one way that matters: whether to ask for a password. An
 * address that already has an account must never be shown a password field on
 * a page reached from an emailed link — that is a password reset wearing a
 * different hat, and it is not what an admin authorised by sending an invite.
 */
const INVITATION_STATE = {
  READY_NEW_ACCOUNT: 'ready_new_account',
  READY_EXISTING_ACCOUNT: 'ready_existing_account',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  INVALID: 'invalid',
};

/**
 * Decide what a link is worth, given the row it points at.
 *
 * Kept pure and separate from the query so the rule can be read in one place
 * and tested without a database.
 *
 * The order of the checks is the substance of the rule:
 *
 * - **Revoked first.** An admin withdrawing an invitation is a deliberate act
 *   and outranks everything else that might also be true of the row.
 * - **Accepted before expiry.** An invitation that was accepted on day two and
 *   looked at on day nine is accepted, not expired. The account it produced
 *   exists; telling that person their link "expired" would send them to ask for
 *   a new invitation instead of to the login page.
 * - **Expiry last, against the clock.** Nothing writes expiry into the row, so
 *   a link dies on its own schedule rather than whenever a job next runs.
 *
 * @param {Object|null} invitation - Row from `parent_invitations`, or null when
 *   no row matched the token
 * @param {Object} [context] - What the decision needs beyond the row
 * @param {boolean} [context.accountExists] - Whether the invited address
 *   already has a `users` row
 * @param {Date} [context.now] - Clock reading, for tests
 * @returns {string} One of {@link INVITATION_STATE}
 */
function classifyInvitation(invitation, { accountExists = false, now = new Date() } = {}) {
  if (!invitation) {
    return INVITATION_STATE.INVALID;
  }
  if (invitation.status === 'revoked') {
    return INVITATION_STATE.REVOKED;
  }
  if (invitation.status === 'accepted') {
    return INVITATION_STATE.ACCEPTED;
  }
  if (invitation.status !== 'pending') {
    // A status the check constraint does not allow. Something is wrong with the
    // row, and an unreadable invitation is not a usable one.
    return INVITATION_STATE.INVALID;
  }
  if (isInvitationExpired(invitation.expires_at, now)) {
    return INVITATION_STATE.EXPIRED;
  }
  return accountExists
    ? INVITATION_STATE.READY_EXISTING_ACCOUNT
    : INVITATION_STATE.READY_NEW_ACCOUNT;
}

/**
 * Whether a state means the link can still be acted on.
 *
 * @param {string} state - One of {@link INVITATION_STATE}
 * @returns {boolean} True when an accept would be allowed to proceed
 */
function isActionableState(state) {
  return state === INVITATION_STATE.READY_NEW_ACCOUNT
    || state === INVITATION_STATE.READY_EXISTING_ACCOUNT;
}

/**
 * Load the invitation a token points at, with the two facts its state depends
 * on that do not live on the row.
 *
 * The lookup is by digest, so the raw token never reaches the database — not as
 * a parameter, not in a query log, not in a slow-query report.
 *
 * `account_exists` is resolved in the same statement rather than in a second
 * round trip, because the answer decides whether the page asks for a password
 * and a gap between the two reads is a gap in which an account could appear.
 *
 * @param {Object} pool - Database pool or client
 * @param {string} token - Raw token from the link
 * @returns {Promise<Object|null>} Invitation row extended with
 *   `organization_name` and `account_exists`, or null when nothing matches
 */
async function findInvitationByToken(pool, token) {
  const digest = digestInvitationToken(token);
  if (!digest) return null;

  const result = await pool.query(
    `SELECT pi.id,
            pi.organization_id,
            pi.email,
            pi.first_name,
            pi.last_name,
            pi.telephone_residence,
            pi.telephone_cellulaire,
            pi.support_contact_name,
            pi.support_contact_email,
            pi.language,
            pi.status,
            pi.expires_at,
            pi.accepted_user_id,
            pi.onboarding_completed_at,
            o.name AS organization_name,
            (u.id IS NOT NULL) AS account_exists
       FROM parent_invitations pi
       JOIN organizations o ON o.id = pi.organization_id
       LEFT JOIN users u ON LOWER(u.email) = pi.email
      WHERE pi.token_digest = $1
      LIMIT 1`,
    [digest]
  );

  return result.rows[0] || null;
}

/**
 * Describe a link to the page that is about to render it, without acting on it.
 *
 * Everything but `invalid` carries the unit's name and the prefilled contact
 * details, so the reader can see who invited them and check the spelling of
 * their own name before committing to anything.
 *
 * `invalid` carries nothing. A token that matches no row and a token that is
 * simply malformed produce the identical answer, because the difference is only
 * of interest to someone probing for live invitations.
 *
 * @param {Object} pool - Database pool
 * @param {string} token - Raw token from the link
 * @param {Object} [options] - Options
 * @param {Date} [options.now] - Clock reading, for tests
 * @param {Object} [options.logger] - Logger
 * @returns {Promise<Object>} `{ state }` plus, when the link resolves, the
 *   details the completion page renders
 */
async function describeInvitation(pool, token, { now = new Date(), logger } = {}) {
  const invitation = await findInvitationByToken(pool, token);
  const state = classifyInvitation(invitation, {
    accountExists: invitation ? invitation.account_exists === true : false,
    now,
  });

  if (state === INVITATION_STATE.INVALID) {
    // Logged without the token: a bearer credential does not go in a log file,
    // and the length is what tells a truncated link from a forged one.
    logger?.info('Parent invitation link rejected', {
      reason: invitation ? 'unreadable_status' : 'no_match',
      tokenLength: typeof token === 'string' ? token.length : 0,
    });
    return { state };
  }

  return {
    state,
    organization_id: invitation.organization_id,
    organization_name: invitation.organization_name,
    email: invitation.email,
    first_name: invitation.first_name,
    last_name: invitation.last_name,
    telephone_residence: invitation.telephone_residence,
    telephone_cellulaire: invitation.telephone_cellulaire,
    support_contact_name: invitation.support_contact_name,
    support_contact_email: invitation.support_contact_email,
    language: invitation.language,
  };
}

module.exports = {
  INVITATION_STATE,
  classifyInvitation,
  isActionableState,
  findInvitationByToken,
  describeInvitation,
};
