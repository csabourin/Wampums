'use strict';

/**
 * Family links — two parents agreeing to share their children's files.
 *
 * One parent naming another's address is an assertion, not a fact. The person
 * on the other end may be the child's other parent, or a new partner, or a
 * stranger whose address was mistyped. So asking changes nothing: a request is
 * a row and an email, and access moves only when the person who received that
 * email opens it and says yes. Opening it is not saying yes — mail scanners
 * open links too.
 *
 * What a link shares, and what it deliberately does not:
 *
 * - **Each side's own children in this unit**, both ways, at the moment of
 *   acceptance — and every child either of them registers here afterwards.
 * - **Not children held through some other link.** If A is linked to B and B
 *   links to C, C does not see A's children. Each person shares what they hold
 *   for a reason of their own, which is what `participant_access_grants`
 *   records and `user_participants` never could.
 * - **Not children in other units.** The link is made in one unit and is
 *   consent about that unit.
 *
 * Revoking a link takes back exactly what it gave, and nothing either parent
 * holds for another reason.
 *
 * @module services/familyLinks
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
const {
  ACCEPTANCE_RESULT,
  insertParentMembership,
  upsertGuardianContact,
  attachExistingAccount,
  createVerifiedAccount,
  isHandDeactivatedMembership,
} = require('./accountProvisioning');
const {
  ACCESS_SOURCE,
  grantParticipantAccess,
  revokeGrantsFromSource,
  listOwnChildrenInUnit,
} = require('./participantAccess');
const { DETECTED_VIA, flagDuplicatesAmong } = require('./duplicateCandidates');

/** What a family-link landing page can be looking at. */
const FAMILY_LINK_STATE = {
  READY_NEW_ACCOUNT: 'ready_new_account',
  READY_EXISTING_ACCOUNT: 'ready_existing_account',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
  // The parent who asked is no longer an active member of the unit, so there
  // is no longer anyone to link with.
  UNAVAILABLE: 'unavailable',
  INVALID: 'invalid',
};

/** What accepting did. */
const FAMILY_LINK_RESULT = {
  LINKED: 'linked',
  ALREADY_LINKED: 'already_linked',
};

/**
 * Order two user ids the way `family_links` stores them.
 *
 * The table's check constraint compares them as uuids; comparing the
 * lower-cased canonical text gives the same order, since uuid comparison is
 * bytewise and canonical text is fixed-width hex.
 *
 * @param {string} a - User UUID
 * @param {string} b - User UUID
 * @returns {[string, string]} Low, high
 */
function orderPair(a, b) {
  const [x, y] = [String(a).toLowerCase(), String(b).toLowerCase()];
  return x < y ? [x, y] : [y, x];
}

/**
 * Decide what a link is worth, given the request it points at.
 *
 * Mirrors the invitation rule: what someone did to the request outranks the
 * clock, and the clock is read now rather than written into the row. One
 * addition — a request whose sender has since left the unit is `unavailable`,
 * because accepting it would link the reader to a family that is not here.
 *
 * @param {Object|null} request - Row from `family_link_requests`
 * @param {Object} context - Facts that do not live on the row
 * @param {boolean} context.accountExists - The target address has an account
 * @param {boolean} context.requesterActive - The sender is still an active member
 * @param {Date} [context.now] - Clock reading, for tests
 * @returns {string} One of {@link FAMILY_LINK_STATE}
 */
function classifyFamilyLinkRequest(request, { accountExists, requesterActive, now = new Date() }) {
  if (!request) return FAMILY_LINK_STATE.INVALID;
  if (request.status === 'revoked') return FAMILY_LINK_STATE.REVOKED;
  if (request.status === 'accepted') return FAMILY_LINK_STATE.ACCEPTED;
  if (request.status === 'declined') return FAMILY_LINK_STATE.DECLINED;
  if (request.status !== 'pending') return FAMILY_LINK_STATE.INVALID;
  if (isInvitationExpired(request.expires_at, now)) return FAMILY_LINK_STATE.EXPIRED;
  if (!requesterActive) return FAMILY_LINK_STATE.UNAVAILABLE;
  return accountExists ? FAMILY_LINK_STATE.READY_EXISTING_ACCOUNT : FAMILY_LINK_STATE.READY_NEW_ACCOUNT;
}

/**
 * A request with everything its state depends on: whether the target address
 * has an account, and whether the sender is still an active member here.
 *
 * Both statements are fixed when the module loads. The locking variant is the
 * same text with a lock clause appended, so no request ever influences which
 * SQL runs — only its parameter.
 */
const REQUEST_BY_DIGEST = `
  SELECT r.*,
         requester.full_name AS requester_name,
         requester.language_preference AS requester_language,
         (target.id IS NOT NULL) AS account_exists,
         target.id AS target_user_id,
         target.full_name AS target_full_name,
         COALESCE(uo.status = 'active', false) AS requester_active
    FROM family_link_requests r
    JOIN users requester ON requester.id = r.requester_user_id
    LEFT JOIN users target ON LOWER(target.email) = r.target_email
    LEFT JOIN user_organizations uo
           ON uo.user_id = r.requester_user_id AND uo.organization_id = r.organization_id
   WHERE r.token_digest = $1
   LIMIT 1`;

const REQUEST_BY_DIGEST_FOR_UPDATE = `${REQUEST_BY_DIGEST}
   FOR UPDATE OF r`;

/**
 * Load a request by token together with everything its state depends on.
 *
 * @param {Object} client - Database client
 * @param {string} digest - SHA-256 of the token
 * @param {Object} [options] - Options
 * @param {boolean} [options.lock] - Lock the request row for the transaction
 * @returns {Promise<Object|null>} Request row, extended, or null
 */
async function loadRequestByDigest(client, digest, { lock = false } = {}) {
  const result = await client.query(lock ? REQUEST_BY_DIGEST_FOR_UPDATE : REQUEST_BY_DIGEST, [digest]);
  return result.rows[0] || null;
}

/**
 * Whether two people already share an active link in a unit.
 *
 * @param {Object} client - Database client
 * @param {number} organizationId - Unit
 * @param {string} a - User UUID
 * @param {string} b - User UUID
 * @returns {Promise<number|null>} The link's id, or null
 */
async function findActiveLink(client, organizationId, a, b) {
  const [low, high] = orderPair(a, b);
  const result = await client.query(
    `SELECT id FROM family_links
      WHERE organization_id = $1 AND user_id_low = $2 AND user_id_high = $3 AND status = 'active'`,
    [organizationId, low, high]
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Ask another parent to share a family.
 *
 * Refuses, before anything is written or sent:
 *
 * - `self` — the address is the requester's own.
 * - `no_children` — the requester has no child of their own in this unit, so
 *   there is nothing to share and no family to join. This also keeps the
 *   request from being a way to mail arbitrary addresses from the unit's name.
 * - `already_linked` — the two are already linked here.
 * - `already_requested` — an outstanding request to that address exists;
 *   resending it is the way to ask again.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Request
 * @param {string} params.requesterId - The parent asking
 * @param {number} params.organizationId - Unit
 * @param {string} params.targetEmail - Normalized address of the other parent
 * @param {Date} [params.now] - Clock reading, for tests
 * @returns {Promise<Object>} `{ ok: true, request, token }` or `{ ok: false, reason }`
 */
async function createFamilyLinkRequest(pool, { requesterId, organizationId, targetEmail, now = new Date() }) {
  const requester = await pool.query('SELECT LOWER(email) AS email FROM users WHERE id = $1', [requesterId]);
  if (requester.rows[0]?.email === targetEmail) {
    return { ok: false, reason: 'self' };
  }

  const ownChildren = await listOwnChildrenInUnit(pool, requesterId, organizationId);
  if (ownChildren.length === 0) {
    return { ok: false, reason: 'no_children' };
  }

  const target = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [targetEmail]);
  if (target.rows[0] && await findActiveLink(pool, organizationId, requesterId, target.rows[0].id)) {
    return { ok: false, reason: 'already_linked' };
  }

  const { token, digest } = generateInvitationToken();
  try {
    const created = await pool.query(
      `INSERT INTO family_link_requests
         (organization_id, requester_user_id, target_email, token_digest, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [organizationId, requesterId, targetEmail, digest, invitationExpiresAt({ from: now })]
    );
    return { ok: true, request: created.rows[0], token };
  } catch (err) {
    if (err.code === '23505') {
      return { ok: false, reason: 'already_requested' };
    }
    throw err;
  }
}

/**
 * Issue a fresh link for a request still waiting, invalidating the old one.
 *
 * Only the parent who asked may resend their own request.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Which request, whose, and where
 * @returns {Promise<Object>} `{ ok: true, request, token }` or `{ ok: false, reason: 'not_found' }`
 */
async function resendFamilyLinkRequest(pool, { requesterId, organizationId, requestId, now = new Date() }) {
  const { token, digest } = generateInvitationToken();
  const result = await pool.query(
    `UPDATE family_link_requests
        SET token_digest = $1,
            expires_at = $2,
            resend_count = resend_count + 1,
            sent_at = NULL,
            updated_at = now()
      WHERE id = $3 AND organization_id = $4 AND requester_user_id = $5 AND status = 'pending'
      RETURNING *`,
    [digest, invitationExpiresAt({ from: now }), requestId, organizationId, requesterId]
  );
  if (result.rows.length === 0) {
    return { ok: false, reason: 'not_found' };
  }
  return { ok: true, request: result.rows[0], token };
}

/**
 * Withdraw a request before it is answered.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Which request, whose, and where
 * @returns {Promise<boolean>} Whether a pending request was withdrawn
 */
async function withdrawFamilyLinkRequest(pool, { requesterId, organizationId, requestId }) {
  const result = await pool.query(
    `UPDATE family_link_requests
        SET status = 'revoked', responded_at = now(), updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND requester_user_id = $3 AND status = 'pending'`,
    [requestId, organizationId, requesterId]
  );
  return result.rowCount > 0;
}

/**
 * Escape a value on its way into email HTML.
 *
 * @param {*} value - Value to render
 * @returns {string} HTML-safe text
 */
function safeText(value) {
  if (value === null || value === undefined) return '';
  return escapeHtml(String(value));
}

/**
 * Build the email that carries a family-link request.
 *
 * The consent is explained here as well as on the page, in plain terms: what
 * becomes visible, to whom, and that nothing happens until the reader confirms.
 * Someone receiving this by mistake should be able to tell from the email alone
 * that ignoring it is safe.
 *
 * @param {Object} params - Message inputs
 * @returns {{subject: string, text: string, html: string}} Message parts
 */
function buildFamilyLinkMessage({ language, organizationName, requesterName, reviewLink }) {
  const t = getTranslationsByCode(language);
  const fallback = getTranslationsByCode('en');
  const pick = (key, literal) => t[key] || fallback[key] || literal;
  const fill = (text) => text
    .replace('{requester}', requesterName)
    .replace('{organization}', organizationName);

  const subject = fill(pick('family_link_email_subject', '{requester} would like to share a family file with you'));
  const heading = pick('family_link_email_heading', 'Share your family file');
  const intro = fill(pick(
    'family_link_email_intro',
    '{requester}, a parent at {organization}, would like to connect with you as a co-parent.'
  ));
  const consent = pick(
    'family_link_email_consent',
    'If you accept, you will each be able to see and manage the files of your children in this unit — those already registered and any either of you adds later. Nothing is shared until you confirm on the page this link opens.'
  );
  const button = pick('family_link_email_button', 'Review the request');
  const copyHint = pick('parent_invitation_email_copy_hint', 'Or copy this link:');
  const expiry = pick('parent_invitation_email_expiry', 'This link will expire in 7 days.');
  const ignore = pick(
    'family_link_email_ignore',
    'If you do not know this person, or do not want to share, you can decline on that page or simply ignore this email.'
  );

  const text = [heading, '', intro, '', consent, '', reviewLink, '', expiry, '', ignore].join('\n');
  const html = `
    <h2>${safeText(heading)}</h2>
    <p>${safeText(intro)}</p>
    <p>${safeText(consent)}</p>
    <p><a href="${reviewLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">${safeText(button)}</a></p>
    <p>${safeText(copyHint)} <a href="${reviewLink}">${safeText(reviewLink)}</a></p>
    <p><em>${safeText(expiry)}</em></p>
    <p>${safeText(ignore)}</p>
  `;

  return { subject, text, html };
}

/**
 * Send a request's link, and record the send only if it happened.
 *
 * Written in the requester's language, falling back to the unit's. The reader's
 * own preference is unknown — they may not have an account.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Delivery inputs
 * @returns {Promise<boolean>} Whether the provider accepted the message
 */
async function deliverFamilyLinkRequest(pool, { request, token, baseUrl, logger }) {
  const context = await pool.query(
    `SELECT u.full_name, u.email, u.language_preference, o.default_language
       FROM users u, organizations o
      WHERE u.id = $1 AND o.id = $2`,
    [request.requester_user_id, request.organization_id]
  );
  const row = context.rows[0] || {};
  const organizationName = await getOrganizationName(pool, request.organization_id);
  const reviewLink = `${baseUrl}/family-link?token=${encodeURIComponent(token)}`;

  const { subject, text, html } = buildFamilyLinkMessage({
    language: row.language_preference || row.default_language || 'fr',
    organizationName,
    requesterName: row.full_name || row.email,
    reviewLink,
  });

  const sent = await sendEmail(request.target_email, subject, text, html, organizationName);
  if (sent) {
    await pool.query(
      'UPDATE family_link_requests SET sent_at = now(), updated_at = now() WHERE id = $1',
      [request.id]
    );
    logger?.info('Family link request sent', { organizationId: request.organization_id, requestId: request.id });
  } else {
    logger?.error('Family link request email failed to send', {
      organizationId: request.organization_id,
      requestId: request.id,
    });
  }
  return sent;
}

/**
 * Describe a request to the page about to render it, without acting on it.
 *
 * Tells the reader who is asking, from which unit, and how many children their
 * acceptance would open to them — a count, not names. The link may have
 * reached the wrong person; a name is information a stranger should not get
 * from a typo.
 *
 * @param {Object} pool - Database pool
 * @param {string} token - Raw token from the link
 * @param {Object} [options] - Options
 * @returns {Promise<Object>} `{ state }` plus details when the link resolves
 */
async function describeFamilyLinkRequest(pool, token, { now = new Date(), logger } = {}) {
  const digest = digestInvitationToken(token);
  const request = digest ? await loadRequestByDigest(pool, digest) : null;
  const state = classifyFamilyLinkRequest(request, {
    accountExists: request?.account_exists === true,
    requesterActive: request?.requester_active === true,
    now,
  });

  if (state === FAMILY_LINK_STATE.INVALID) {
    logger?.info('Family link request rejected', {
      reason: request ? 'unreadable_status' : 'no_match',
      tokenLength: typeof token === 'string' ? token.length : 0,
    });
    return { state };
  }

  const sharedChildren = await listOwnChildrenInUnit(pool, request.requester_user_id, request.organization_id);

  return {
    state,
    organization_name: await getOrganizationName(pool, request.organization_id),
    requester_name: request.requester_name,
    email: request.target_email,
    shared_children_count: sharedChildren.length,
  };
}

/**
 * Share each side's own children with the other, on the strength of one link.
 *
 * @param {Object} client - Client inside the acceptance transaction
 * @param {Object} params - Who, where, and through which link
 * @returns {Promise<void>} Resolves once both directions are granted
 */
async function shareChildrenAcrossLink(client, { organizationId, linkId, a, b }) {
  const [aChildren, bChildren] = [
    await listOwnChildrenInUnit(client, a, organizationId),
    await listOwnChildrenInUnit(client, b, organizationId),
  ];

  const grants = [
    ...aChildren.map((participantId) => ({ participantId, userId: b, grantedBy: a })),
    ...bChildren.map((participantId) => ({ participantId, userId: a, grantedBy: b })),
  ];

  for (const grant of grants) {
    // Sequential: one transaction, one connection.
    // eslint-disable-next-line no-await-in-loop
    await grantParticipantAccess(client, {
      ...grant,
      sourceType: ACCESS_SOURCE.FAMILY_LINK,
      sourceId: linkId,
    });
  }
}

/**
 * Accept a request: make or attach the reader's account, and link the family.
 *
 * One transaction, opened by locking the request, for the reason the
 * invitation flow does it: two submissions settle into one outcome.
 *
 * Refusals that write nothing:
 * - the link is no longer actionable (see {@link classifyFamilyLinkRequest})
 * - `password_required` / `name_required` — a new account needs both
 * - `membership_blocked` — the reader's membership in this unit was closed by
 *   an administrator. A parent's request is not an administrator's decision,
 *   and must not become a back door into a unit someone was removed from.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Acceptance inputs
 * @param {Object} [options] - Options
 * @returns {Promise<Object>} `{ state, result?, error?, organization_name? }`
 */
async function acceptFamilyLinkRequest(pool, params, { now = new Date(), logger } = {}) {
  const {
    token,
    password = null,
    firstName = null,
    lastName = null,
    telephoneResidence = null,
    telephoneCellulaire = null,
  } = params;

  const digest = digestInvitationToken(token);
  if (!digest) {
    return { state: FAMILY_LINK_STATE.INVALID };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const request = await loadRequestByDigest(client, digest, { lock: true });
    const state = classifyFamilyLinkRequest(request, {
      accountExists: request?.account_exists === true,
      requesterActive: request?.requester_active === true,
      now,
    });

    if (state !== FAMILY_LINK_STATE.READY_NEW_ACCOUNT && state !== FAMILY_LINK_STATE.READY_EXISTING_ACCOUNT) {
      await client.query('ROLLBACK');
      return { state };
    }

    const organizationId = request.organization_id;
    let recipientId = request.target_user_id;

    if (state === FAMILY_LINK_STATE.READY_NEW_ACCOUNT) {
      if (!password) {
        await client.query('ROLLBACK');
        return { state, error: 'password_required' };
      }
      if (!firstName || !lastName) {
        await client.query('ROLLBACK');
        return { state, error: 'name_required' };
      }

      recipientId = await createVerifiedAccount(client, {
        email: request.target_email,
        password,
        fullName: `${firstName} ${lastName}`.trim(),
        language: request.requester_language,
      });
      await insertParentMembership(client, recipientId, organizationId);
      await upsertGuardianContact(client, {
        userId: recipientId,
        email: request.target_email,
        firstName,
        lastName,
        telephoneResidence,
        telephoneCellulaire,
      });
    } else {
      if (recipientId === request.requester_user_id) {
        await client.query('ROLLBACK');
        return { state: FAMILY_LINK_STATE.INVALID };
      }

      const membership = await client.query(
        'SELECT status, deactivated_reason FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
        [recipientId, organizationId]
      );
      if (isHandDeactivatedMembership(membership.rows[0])) {
        await client.query('ROLLBACK');
        return { state, error: 'membership_blocked' };
      }

      // Joins the unit if they were not in it, or comes back from a routine
      // year-transition deactivation. The hand-deactivated case was refused
      // above, so this cannot land in the approval queue.
      const joined = await attachExistingAccount(client, recipientId, organizationId);
      if (joined !== ACCEPTANCE_RESULT.ALREADY_MEMBER) {
        await upsertGuardianContact(client, {
          userId: recipientId,
          email: request.target_email,
          accountFullName: request.target_full_name,
        });
      }
    }

    let result = FAMILY_LINK_RESULT.LINKED;
    let linkId = await findActiveLink(client, organizationId, request.requester_user_id, recipientId);

    if (linkId) {
      result = FAMILY_LINK_RESULT.ALREADY_LINKED;
    } else {
      const [low, high] = orderPair(request.requester_user_id, recipientId);
      const created = await client.query(
        `INSERT INTO family_links (organization_id, user_id_low, user_id_high, created_from_request_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [organizationId, low, high, request.id]
      );
      linkId = created.rows[0].id;
      await shareChildrenAcrossLink(client, {
        organizationId,
        linkId,
        a: request.requester_user_id,
        b: recipientId,
      });

      // Each parent may have registered the same child before they were linked,
      // here or in another unit. Neither parent is told; the unit's
      // administrators are, and decide.
      const flagged = await flagDuplicatesAmong(client, {
        organizationId,
        userIds: [request.requester_user_id, recipientId],
        detectedVia: DETECTED_VIA.FAMILY_LINK,
      });
      if (flagged.length > 0) {
        logger?.info('Possible duplicate children flagged for review', {
          organizationId,
          linkId,
          candidates: flagged.length,
        });
      }
    }

    await client.query(
      `UPDATE family_link_requests
          SET status = 'accepted', responded_at = now(), responded_user_id = $1, updated_at = now()
        WHERE id = $2`,
      [recipientId, request.id]
    );

    await client.query('COMMIT');

    logger?.info('Family link request accepted', { organizationId, requestId: request.id, linkId, result });

    return {
      state,
      result,
      link_id: linkId,
      email: request.target_email,
      organization_name: await getOrganizationName(pool, organizationId),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505' && err.constraint === 'users_email_key') {
      return { state: FAMILY_LINK_STATE.READY_EXISTING_ACCOUNT, error: 'account_just_created' };
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Decline a request. Nothing is shared and nothing is created; the sender sees
 * that it was declined.
 *
 * @param {Object} pool - Database pool
 * @param {string} token - Raw token from the link
 * @param {Object} [options] - Options
 * @returns {Promise<Object>} `{ state }`, and `declined: true` when it was
 */
async function declineFamilyLinkRequest(pool, token, { now = new Date() } = {}) {
  const digest = digestInvitationToken(token);
  if (!digest) {
    return { state: FAMILY_LINK_STATE.INVALID };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await loadRequestByDigest(client, digest, { lock: true });
    const state = classifyFamilyLinkRequest(request, {
      accountExists: request?.account_exists === true,
      // Declining needs no one on the other side. A request from someone who
      // has since left can still be turned down, so it stops appearing.
      requesterActive: true,
      now,
    });

    if (state !== FAMILY_LINK_STATE.READY_NEW_ACCOUNT && state !== FAMILY_LINK_STATE.READY_EXISTING_ACCOUNT) {
      await client.query('ROLLBACK');
      return { state };
    }

    await client.query(
      `UPDATE family_link_requests
          SET status = 'declined', responded_at = now(), updated_at = now()
        WHERE id = $1`,
      [request.id]
    );
    await client.query('COMMIT');
    return { state, declined: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * A parent's links and outstanding requests in one unit.
 *
 * @param {Object} pool - Database pool
 * @param {string} userId - The parent
 * @param {number} organizationId - Unit
 * @param {Object} [options] - Options
 * @returns {Promise<Object>} `{ links, requests }`
 */
async function listFamilyLinks(pool, userId, organizationId, { now = new Date() } = {}) {
  const links = await pool.query(
    `SELECT fl.id,
            fl.created_at,
            partner.id AS partner_id,
            partner.full_name AS partner_name,
            partner.email AS partner_email
       FROM family_links fl
       JOIN users partner
         ON partner.id = CASE WHEN fl.user_id_low = $1 THEN fl.user_id_high ELSE fl.user_id_low END
      WHERE fl.organization_id = $2
        AND fl.status = 'active'
        AND (fl.user_id_low = $1 OR fl.user_id_high = $1)
      ORDER BY fl.created_at`,
    [userId, organizationId]
  );

  const requests = await pool.query(
    `SELECT id, target_email, status, sent_at, expires_at, responded_at, created_at
       FROM family_link_requests
      WHERE requester_user_id = $1 AND organization_id = $2
      ORDER BY created_at DESC`,
    [userId, organizationId]
  );

  return {
    links: links.rows,
    requests: requests.rows.map((row) => ({
      ...row,
      state: row.status === 'pending' && isInvitationExpired(row.expires_at, now) ? 'expired' : row.status,
    })),
  };
}

/**
 * End a family link. Either parent may, without the other's agreement — no one
 * can be kept in a shared family they want out of.
 *
 * Takes back exactly the access this link granted. A child either parent can
 * see for any other reason stays visible to them.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Who, where, which link
 * @returns {Promise<Object>} `{ ok: true, revoked, removed }` or `{ ok: false }`
 */
async function endFamilyLink(pool, { userId, organizationId, linkId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ended = await client.query(
      `UPDATE family_links
          SET status = 'revoked', revoked_at = now(), revoked_by = $1
        WHERE id = $2
          AND organization_id = $3
          AND status = 'active'
          AND (user_id_low = $1 OR user_id_high = $1)
        RETURNING id`,
      [userId, linkId, organizationId]
    );

    if (ended.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false };
    }

    const { revoked, removed } = await revokeGrantsFromSource(client, {
      sourceType: ACCESS_SOURCE.FAMILY_LINK,
      sourceId: linkId,
    });
    await client.query('COMMIT');
    return { ok: true, revoked, removed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  FAMILY_LINK_STATE,
  FAMILY_LINK_RESULT,
  orderPair,
  classifyFamilyLinkRequest,
  createFamilyLinkRequest,
  resendFamilyLinkRequest,
  withdrawFamilyLinkRequest,
  buildFamilyLinkMessage,
  deliverFamilyLinkRequest,
  describeFamilyLinkRequest,
  acceptFamilyLinkRequest,
  declineFamilyLinkRequest,
  listFamilyLinks,
  endFamilyLink,
};
