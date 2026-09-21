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

const {
  digestInvitationToken,
  generateInvitationToken,
  invitationExpiresAt,
  isInvitationExpired,
} = require('../utils/invitation-tokens');
const { sendEmail, getTranslationsByCode } = require('../utils/index');
const { escapeHtml } = require('../utils/api-helpers');
const { getOrganizationName } = require('./alumni');
const { findMembershipStanding, classifyStanding } = require('./reactivation');

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

/**
 * The state an administrator's list shows.
 *
 * The reader here is not holding a link, so the distinction between "needs a
 * password" and "has an account already" is noise. Both collapse back to the
 * only thing an admin acts on: this invitation is still outstanding.
 *
 * @param {Object} invitation - Row from `parent_invitations`
 * @param {Date} [now] - Clock reading, for tests
 * @returns {string} `pending`, `expired`, `accepted`, `revoked` or `invalid`
 */
function invitationAdminState(invitation, now = new Date()) {
  const state = classifyInvitation(invitation, { accountExists: false, now });
  return isActionableState(state) ? 'pending' : state;
}

/**
 * Every invitation ever issued by one unit, newest first.
 *
 * Accepted and revoked rows are not hidden. An admin asking "did I already
 * invite this family?" is asking about history, and an invitation that vanished
 * on acceptance would make the answer look like no.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Unit whose invitations to list
 * @param {Object} [options] - Options
 * @param {Date} [options.now] - Clock reading, for tests
 * @returns {Promise<Array<Object>>} Invitations with a derived `state`
 */
async function listInvitations(pool, organizationId, { now = new Date() } = {}) {
  const result = await pool.query(
    `SELECT pi.id,
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
            pi.sent_at,
            pi.resend_count,
            pi.accepted_at,
            pi.revoked_at,
            pi.onboarding_completed_at,
            pi.created_at,
            inviter.full_name AS invited_by_name
       FROM parent_invitations pi
       LEFT JOIN users inviter ON inviter.id = pi.invited_by
      WHERE pi.organization_id = $1
      ORDER BY pi.created_at DESC`,
    [organizationId]
  );

  return result.rows.map((row) => ({ ...row, state: invitationAdminState(row, now) }));
}

/**
 * Create a pending invitation, and hand back the one copy of its token.
 *
 * Refuses two things, for different reasons:
 *
 * - **An address that is already an active member.** Inviting them would
 *   promise a registration flow that their existing account makes meaningless,
 *   and the admin almost certainly meant to look them up rather than invite
 *   them. The standing is read through the same helpers the reactivation flow
 *   uses, so "active member" means the same thing in both places.
 * - **A second live invitation for the same address.** Checked here for a clear
 *   answer, and enforced by a partial unique index for the case where two
 *   admins press the button at the same moment. Both paths report the same
 *   refusal, because a race that produced two live links would mean the first
 *   one silently stopped working.
 *
 * The token is returned, never stored. Only its digest reaches the database.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Invitation details, already validated by the route
 * @returns {Promise<Object>} `{ ok: true, invitation, token }`, or
 *   `{ ok: false, reason }` where reason is `already_member` or `already_invited`
 */
async function createInvitation(pool, params) {
  const {
    organizationId,
    email,
    firstName = null,
    lastName = null,
    telephoneResidence = null,
    telephoneCellulaire = null,
    supportContactName = null,
    supportContactEmail = null,
    language = null,
    invitedBy = null,
    now = new Date(),
  } = params;

  const standing = await findMembershipStanding(pool, email, organizationId);
  if (classifyStanding(standing) === 'already_active') {
    return { ok: false, reason: 'already_member' };
  }

  const { token, digest } = generateInvitationToken();

  try {
    const result = await pool.query(
      `INSERT INTO parent_invitations (
         organization_id, email, first_name, last_name,
         telephone_residence, telephone_cellulaire,
         support_contact_name, support_contact_email,
         language, token_digest, expires_at, invited_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        organizationId, email, firstName, lastName,
        telephoneResidence, telephoneCellulaire,
        supportContactName, supportContactEmail,
        language, digest, invitationExpiresAt({ from: now }), invitedBy,
      ]
    );

    return { ok: true, invitation: result.rows[0], token };
  } catch (err) {
    if (err.code === '23505') {
      return { ok: false, reason: 'already_invited' };
    }
    throw err;
  }
}

/**
 * Issue a fresh link for an invitation that is still outstanding.
 *
 * Rotating the token is the point, not a side effect: the old link stops
 * working the moment this runs. An admin who resends because the first mail
 * went astray has no way to know which copy the parent will click, and two live
 * links to the same invitation is one more than the accept path can reason
 * about.
 *
 * Expiry is refreshed too, since the usual reason to resend is that the first
 * link lapsed.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Which invitation, in which unit
 * @returns {Promise<Object>} `{ ok: true, invitation, token }` or
 *   `{ ok: false, reason: 'not_found' }`
 */
async function resendInvitation(pool, { organizationId, invitationId, now = new Date() }) {
  const { token, digest } = generateInvitationToken();

  const result = await pool.query(
    `UPDATE parent_invitations
        SET token_digest = $1,
            expires_at = $2,
            resend_count = resend_count + 1,
            sent_at = NULL,
            updated_at = now()
      WHERE id = $3
        AND organization_id = $4
        AND status = 'pending'
      RETURNING *`,
    [digest, invitationExpiresAt({ from: now }), invitationId, organizationId]
  );

  if (result.rows.length === 0) {
    // Missing, belonging to another unit, or already accepted or revoked. The
    // caller is an authenticated admin, so there is no enumeration concern in
    // saying "not found" — but there is nothing else true to say either.
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true, invitation: result.rows[0], token };
}

/**
 * Withdraw an invitation.
 *
 * The row stays. What it records — that this address was invited on this date
 * by this admin, and then withdrawn — is exactly what someone will want when
 * the family asks why their link stopped working.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Which invitation, in which unit, withdrawn by whom
 * @returns {Promise<Object>} `{ ok: true, invitation }` or
 *   `{ ok: false, reason: 'not_found' }`
 */
async function revokeInvitation(pool, { organizationId, invitationId, revokedBy = null }) {
  const result = await pool.query(
    `UPDATE parent_invitations
        SET status = 'revoked',
            revoked_at = now(),
            revoked_by = $1,
            updated_at = now()
      WHERE id = $2
        AND organization_id = $3
        AND status = 'pending'
      RETURNING *`,
    [revokedBy, invitationId, organizationId]
  );

  if (result.rows.length === 0) {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true, invitation: result.rows[0] };
}

/**
 * Record that the invitation email actually left.
 *
 * Separate from creation, and deliberately after the send. An invitation whose
 * email bounced off a misconfigured provider is still a valid invitation that
 * nobody has received; marking it sent at creation time would make the admin's
 * list claim otherwise, and the parent would be waiting for a mail that never
 * went out.
 *
 * @param {Object} pool - Database pool
 * @param {string} invitationId - Invitation UUID
 * @returns {Promise<void>} Resolves once recorded
 */
async function markInvitationSent(pool, invitationId) {
  await pool.query(
    'UPDATE parent_invitations SET sent_at = now(), updated_at = now() WHERE id = $1',
    [invitationId]
  );
}

/**
 * Escape a value that is about to be interpolated into email HTML.
 *
 * Names and unit names are typed by people and travel into a document that no
 * browser-side sanitiser will ever see. `escapeHtml` expects a string, so the
 * empty cases are handled before it is asked.
 *
 * @param {*} value - Value to render
 * @returns {string} HTML-safe text
 */
function safeText(value) {
  if (value === null || value === undefined) return '';
  return escapeHtml(String(value));
}

/**
 * Build the invitation email.
 *
 * @param {Object} params - Message inputs
 * @param {string} params.language - Language the message is written in
 * @param {string} params.organizationName - Unit name, shown to the reader
 * @param {string} params.completeLink - The one-time completion URL
 * @param {string} [params.firstName] - Prefilled first name, when the admin gave one
 * @param {string} [params.supportContactName] - Who to ask for help
 * @param {string} [params.supportContactEmail] - Where to ask for help
 * @returns {{subject: string, text: string, html: string}} Message parts
 */
function buildInvitationMessage({
  language,
  organizationName,
  completeLink,
  firstName = null,
  supportContactName = null,
  supportContactEmail = null,
}) {
  const t = getTranslationsByCode(language);
  const fallback = getTranslationsByCode('en');
  const pick = (key, literal) => t[key] || fallback[key] || literal;

  const subject = pick('parent_invitation_email_subject', 'Complete your registration with {organization}')
    .replace('{organization}', organizationName);
  const greeting = firstName
    ? pick('parent_invitation_email_greeting', 'Hello {name},').replace('{name}', firstName)
    : pick('parent_invitation_email_greeting_anonymous', 'Hello,');
  const heading = pick('parent_invitation_email_heading', 'Complete your registration');
  const intro = pick(
    'parent_invitation_email_intro',
    '{organization} has started a file for you. Complete your profile to create your account, then add your children — it takes a few minutes.'
  ).replace('{organization}', organizationName);
  const button = pick('parent_invitation_email_button', 'Complete my profile');
  const copyHint = pick('parent_invitation_email_copy_hint', 'Or copy this link:');
  const expiry = pick('parent_invitation_email_expiry', 'This link will expire in 7 days.');
  const ignore = pick(
    'parent_invitation_email_ignore',
    'If you did not expect this, you can ignore this email. Nothing is created until you use the link.'
  );

  const supportLine = supportContactEmail
    ? pick('parent_invitation_email_support', 'Questions? Contact {name} at {email}.')
      .replace('{name}', supportContactName || organizationName)
      .replace('{email}', supportContactEmail)
    : null;

  const text = [
    greeting,
    '',
    intro,
    '',
    completeLink,
    '',
    expiry,
    ...(supportLine ? ['', supportLine] : []),
    '',
    ignore,
  ].join('\n');

  // The link is ours, built from a trusted origin and a token we just minted,
  // so it is safe in an href. Everything else here came from a person.
  const html = `
    <h2>${safeText(heading)}</h2>
    <p>${safeText(greeting)}</p>
    <p>${safeText(intro)}</p>
    <p><a href="${completeLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">${safeText(button)}</a></p>
    <p>${safeText(copyHint)} <a href="${completeLink}">${safeText(completeLink)}</a></p>
    <p><em>${safeText(expiry)}</em></p>
    ${supportLine ? `<p>${safeText(supportLine)}</p>` : ''}
    <p>${safeText(ignore)}</p>
  `;

  return { subject, text, html };
}

/**
 * Send an invitation's link, and record the send only if it happened.
 *
 * Called outside any transaction. A mail provider can take seconds to answer,
 * and holding a row lock across that would let one slow send block an admin's
 * whole invitation list.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Delivery inputs
 * @param {Object} params.invitation - Row returned by create or resend
 * @param {string} params.token - The raw token, for this one email
 * @param {string} params.baseUrl - Trusted origin, resolved by the caller
 * @param {Object} [params.logger] - Logger
 * @returns {Promise<boolean>} Whether the provider accepted the message
 */
async function deliverInvitation(pool, { invitation, token, baseUrl, logger }) {
  const organizationName = await getOrganizationName(pool, invitation.organization_id);
  const completeLink = `${baseUrl}/complete-registration?token=${encodeURIComponent(token)}`;

  const { subject, text, html } = buildInvitationMessage({
    language: invitation.language,
    organizationName,
    completeLink,
    firstName: invitation.first_name,
    supportContactName: invitation.support_contact_name,
    supportContactEmail: invitation.support_contact_email,
  });

  const sent = await sendEmail(invitation.email, subject, text, html, organizationName);

  if (sent) {
    await markInvitationSent(pool, invitation.id);
    logger?.info('Parent invitation sent', {
      organizationId: invitation.organization_id,
      invitationId: invitation.id,
    });
  } else {
    // Left pending and unsent, which is what makes it re-sendable.
    logger?.error('Parent invitation email failed to send', {
      organizationId: invitation.organization_id,
      invitationId: invitation.id,
    });
  }

  return sent;
}

module.exports = {
  INVITATION_STATE,
  classifyInvitation,
  isActionableState,
  invitationAdminState,
  findInvitationByToken,
  describeInvitation,
  listInvitations,
  createInvitation,
  resendInvitation,
  revokeInvitation,
  markInvitationSent,
  buildInvitationMessage,
  deliverInvitation,
};
