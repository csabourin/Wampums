/**
 * Membership Reactivation Service
 *
 * A deactivated parent who wants to register another child used to have no way
 * back in. Login refused them, password reset ignored them, and registering
 * again collided with the global unique index on `users.email`. Every door led
 * to another closed door.
 *
 * The mistake behind that was treating deactivation as a fact about a person.
 * It is a fact about a *membership*: `users` is global and holds the
 * credentials, `user_organizations` is per-unit and holds the access. This
 * module is the door that membership state is allowed to guard — and it is a
 * door, not a wall.
 *
 * Three properties shape it:
 *
 * 1. **The address is the proof.** Like the alumni links in `services/alumni`,
 *    these arrive by email and carry a signed token, because a person locked
 *    out of an account cannot be asked to log in to unlock it. The token names
 *    a user and a unit and nothing else.
 * 2. **The token asks, the database decides.** A token never carries the
 *    outcome. What a click does is re-derived from current membership state at
 *    the moment it lands, so a link minted in June cannot force an outcome that
 *    stopped being right in September.
 * 3. **Routine returns are routine; deliberate removals are not.** A membership
 *    the year transition swept out (`deactivated_reason = 'no_enrolled_child'`)
 *    comes back on the member's own click. A membership an admin deactivated by
 *    hand may have been removed for cause, so it queues for an admin instead.
 *
 * @module services/reactivation
 */

const { signJWTToken, verifyJWTToken } = require('../utils/jwt-config');
const {
  sendEmail,
  getTranslationsByCode,
  getUserEmailLanguage,
} = require('../utils/index');
const { getOrganizationName } = require('./alumni');

/**
 * Token purpose. Distinct from the alumni purposes so that an opt-in link can
 * never be replayed as a reactivation, or the reverse.
 */
const REACTIVATION_PURPOSE = 'membership_reactivation';

/**
 * How long a reactivation link stays valid.
 *
 * Short by the standards of this codebase, and deliberately so: unlike the
 * alumni invitation, which arrives unasked in the middle of June, this link
 * answers a request the person made minutes ago. A week absorbs a forwarded
 * mail or a holiday without leaving a standing key to a unit lying in an inbox.
 */
const REACTIVATION_TOKEN_TTL = '7d';

/** The reason the year transition writes when it sweeps a membership out. */
const ROUTINE_DEACTIVATION_REASON = 'no_enrolled_child';

/**
 * Mint a signed reactivation link token.
 *
 * Carries identity only. `membership_id` is absent for someone who has an
 * account elsewhere but has never belonged to this unit — that person is
 * joining rather than returning, and the difference is read from the database
 * at confirm time, not from the token.
 *
 * @param {Object} subject - Who the link is for
 * @param {string} subject.user_id - User UUID
 * @param {number} subject.organization_id - Organization ID
 * @returns {string} Signed JWT
 */
function issueReactivationToken(subject) {
  return signJWTToken(
    {
      purpose: REACTIVATION_PURPOSE,
      user_id: subject.user_id,
      organization_id: subject.organization_id,
    },
    { expiresIn: REACTIVATION_TOKEN_TTL }
  );
}

/**
 * Verify a reactivation token.
 *
 * @param {string} token - Token from the link
 * @returns {Object|null} Payload, or null when absent, malformed, expired or
 *   minted for another purpose
 */
function verifyReactivationToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  let payload;
  try {
    payload = verifyJWTToken(token);
  } catch (_err) {
    return null;
  }

  if (payload?.purpose !== REACTIVATION_PURPOSE) {
    return null;
  }
  if (!payload.user_id || !payload.organization_id) {
    return null;
  }
  return payload;
}

/**
 * Read the current standing of an email address within one unit.
 *
 * One query answers every branch the flow needs: whether the person has an
 * account at all, whether they belong to this unit, and if so in what state.
 * The LEFT JOIN is what makes "has an account elsewhere" distinguishable from
 * "has no account", which are the two cases registration used to conflate.
 *
 * @param {Object} pool - Database pool or client
 * @param {string} normalizedEmail - Lower-cased, trimmed address
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Object|null>} Standing, or null when no such account
 */
async function findMembershipStanding(pool, normalizedEmail, organizationId) {
  const result = await pool.query(
    `SELECT u.id AS user_id,
            u.email,
            u.full_name,
            uo.id AS membership_id,
            uo.status,
            uo.deactivated_reason,
            uo.reactivation_requested_at
       FROM users u
       LEFT JOIN user_organizations uo
              ON uo.user_id = u.id
             AND uo.organization_id = $2
      WHERE LOWER(u.email) = $1
      LIMIT 1`,
    [normalizedEmail, organizationId]
  );

  return result.rows[0] || null;
}

/**
 * Decide what a standing entitles its holder to, before any email goes out.
 *
 * Kept separate from the acting code so the same rule is readable in one place
 * and testable without a mailbox.
 *
 * @param {Object|null} standing - Row from {@link findMembershipStanding}
 * @returns {string} One of `no_account`, `already_active`, `returning`, `joining`
 */
function classifyStanding(standing) {
  if (!standing) {
    return 'no_account';
  }
  if (!standing.membership_id) {
    return 'joining';
  }
  if (standing.status === 'active') {
    return 'already_active';
  }
  return 'returning';
}

/**
 * Build the email that carries the reactivation link.
 *
 * @param {Object} params - Message inputs
 * @param {string} params.language - Recipient's language code
 * @param {string} params.organizationName - Unit name, shown to the reader
 * @param {string} params.confirmLink - One-click confirmation URL
 * @param {boolean} params.isJoining - True when the reader has an account but
 *   has never belonged to this unit
 * @returns {{subject: string, text: string, html: string}} Message parts
 */
function buildReactivationMessage({ language, organizationName, confirmLink, isJoining }) {
  const t = getTranslationsByCode(language);
  const fallback = getTranslationsByCode('en');
  const pick = (key, literal) => t[key] || fallback[key] || literal;

  const subject = pick('reactivation_email_subject', 'Rejoining {organization}')
    .replace('{organization}', organizationName);
  const heading = pick('reactivation_email_heading', 'Confirm your return');
  const intro = isJoining
    ? pick(
      'reactivation_email_intro_join',
      'You already have a Wampums account, and you asked to use it with {organization}. Confirm below and your account will be added to the unit — your password does not change.'
    ).replace('{organization}', organizationName)
    : pick(
      'reactivation_email_intro_return',
      'Your access to {organization} was closed when you no longer had a child registered. Confirm below to ask for it back — your account, your password and your history were all kept.'
    ).replace('{organization}', organizationName);
  const button = pick('reactivation_email_button', 'Confirm');
  const copyHint = pick('reactivation_email_copy_hint', 'Or copy this link:');
  const expiry = pick('reactivation_email_expiry', 'This link will expire in 7 days.');
  const ignore = pick(
    'reactivation_email_ignore',
    'If you did not ask for this, you can ignore this email. Nothing changes until the link is used.'
  );

  const text = [heading, '', intro, '', confirmLink, '', expiry, '', ignore].join('\n');
  const html = `
    <h2>${heading}</h2>
    <p>${intro}</p>
    <p><a href="${confirmLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">${button}</a></p>
    <p>${copyHint} <a href="${confirmLink}">${confirmLink}</a></p>
    <p><em>${expiry}</em></p>
    <p>${ignore}</p>
  `;

  return { subject, text, html };
}

/**
 * Handle a request for a reactivation link.
 *
 * Answers the same way whatever it finds. The caller is unauthenticated and the
 * question — "does this address belong to a deactivated member of this unit?" —
 * is exactly the question an enumeration probe would ask, so the response
 * carries no answer to it and the timing difference of one email send is the
 * only signal left.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Request inputs
 * @param {string} params.email - Address the person typed, already normalized
 * @param {number} params.organizationId - Unit the request was made against
 * @param {string} params.baseUrl - Trusted origin for the link
 * @param {Object} [params.logger] - Logger
 * @returns {Promise<{requested: boolean}>} Always `{ requested: true }`
 */
async function requestReactivation(pool, { email, organizationId, baseUrl, logger }) {
  const standing = await findMembershipStanding(pool, email, organizationId);
  const outcome = classifyStanding(standing);

  if (outcome === 'no_account' || outcome === 'already_active') {
    logger?.info('Reactivation link not sent', { organizationId, outcome });
    return { requested: true };
  }

  const organizationName = await getOrganizationName(pool, organizationId);
  const language = await getUserEmailLanguage(pool, standing.email, organizationId);
  const token = issueReactivationToken({
    user_id: standing.user_id,
    organization_id: organizationId,
  });
  const confirmLink = `${baseUrl}/reactivate-account?token=${token}`;

  const { subject, text, html } = buildReactivationMessage({
    language,
    organizationName,
    confirmLink,
    isJoining: outcome === 'joining',
  });

  const sent = await sendEmail(standing.email, subject, text, html, organizationName);
  if (!sent) {
    logger?.error('Reactivation email failed to send', {
      organizationId,
      userId: standing.user_id,
    });
  } else {
    logger?.info('Reactivation link sent', { organizationId, outcome });
  }

  return { requested: true };
}

/**
 * Load the membership a token points at, if any.
 *
 * @param {Object} pool - Database pool or client
 * @param {Object} payload - Verified token payload
 * @returns {Promise<Object|null>} Membership row, or null when the user has no
 *   membership in that unit
 */
async function loadMembershipForToken(pool, payload) {
  const result = await pool.query(
    `SELECT id AS membership_id, status, deactivated_reason, reactivation_requested_at
       FROM user_organizations
      WHERE user_id = $1 AND organization_id = $2
      LIMIT 1`,
    [payload.user_id, payload.organization_id]
  );

  return result.rows[0] || null;
}

/**
 * Describe what a reactivation link is about to do, without acting on it.
 *
 * Lets the landing page name the unit and set expectations — restored at once,
 * or passed to an admin — before asking for a click, and lets it say plainly
 * that a link expired instead of failing at the moment the person acts.
 *
 * @param {Object} pool - Database pool
 * @param {string} token - Token from the link
 * @returns {Promise<{state: string, organization_name?: string}>} Link state
 */
async function describeReactivationLink(pool, token) {
  const payload = verifyReactivationToken(token);
  if (!payload) {
    return { state: 'invalid' };
  }

  const userResult = await pool.query(
    'SELECT id FROM users WHERE id = $1',
    [payload.user_id]
  );
  if (userResult.rows.length === 0) {
    return { state: 'invalid' };
  }

  const organizationName = await getOrganizationName(pool, payload.organization_id);
  const membership = await loadMembershipForToken(pool, payload);

  if (!membership) {
    return { state: 'ready_join', organization_name: organizationName };
  }
  if (membership.status === 'active') {
    return { state: 'already_active', organization_name: organizationName };
  }
  if (membership.reactivation_requested_at) {
    return { state: 'pending_approval', organization_name: organizationName };
  }
  if (membership.deactivated_reason === ROUTINE_DEACTIVATION_REASON) {
    return { state: 'ready_reactivate', organization_name: organizationName };
  }
  return { state: 'ready_review', organization_name: organizationName };
}

/**
 * Add a membership for someone who has an account but has never belonged here.
 *
 * The same standing a fresh registration would have produced, minus the second
 * `users` row that the global unique index on email rightly refuses.
 *
 * @param {Object} client - Transaction client
 * @param {Object} payload - Verified token payload
 * @returns {Promise<void>}
 */
async function insertParentMembership(client, payload) {
  const roleResult = await client.query(
    'SELECT id FROM roles WHERE role_name = $1',
    ['parent']
  );

  if (roleResult.rows.length === 0) {
    throw new Error("Role 'parent' not found in roles table");
  }

  await client.query(
    `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
     VALUES ($1, $2, $3, 'active')`,
    [payload.user_id, payload.organization_id, JSON.stringify([roleResult.rows[0].id])]
  );
}

/**
 * Tell the unit's admins that a removed member has asked to come back.
 *
 * Best-effort by design: the request is already committed when this runs, so a
 * mail failure costs a notification, never the request itself. The admins act
 * on it from the scout-year screen, which already reactivates memberships.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Notification inputs
 * @param {number} params.organizationId - Organization ID
 * @param {string} params.organizationName - Unit name
 * @param {string} params.memberName - Who is asking
 * @param {string} params.memberEmail - Their address
 * @param {Object} [params.logger] - Logger
 * @returns {Promise<void>}
 */
async function notifyAdminsOfReactivationRequest(pool, {
  organizationId,
  organizationName,
  memberName,
  memberEmail,
  logger,
}) {
  try {
    const adminResult = await pool.query(
      `SELECT DISTINCT u.email
         FROM users u
         JOIN user_organizations uo ON u.id = uo.user_id
         JOIN roles r ON r.id = ANY(SELECT jsonb_array_elements_text(uo.role_ids)::int)
        WHERE uo.organization_id = $1
          AND uo.status = 'active'
          AND r.role_name IN ('district', 'unitadmin')`,
      [organizationId]
    );

    if (adminResult.rows.length === 0) {
      logger?.warn('Reactivation request has no admin to notify', { organizationId });
      return;
    }

    await Promise.all(adminResult.rows.map(async (admin) => {
      const language = await getUserEmailLanguage(pool, admin.email, organizationId);
      const t = getTranslationsByCode(language);
      const fallback = getTranslationsByCode('en');
      const pick = (key, literal) => t[key] || fallback[key] || literal;

      const subject = pick(
        'reactivation_admin_subject',
        'Reactivation request for {organization}'
      ).replace('{organization}', organizationName);
      const body = pick(
        'reactivation_admin_body',
        'A deactivated member of {organization} has asked for their access back:\n\nName: {name}\nEmail: {email}\n\nThis account was not deactivated by the year transition, so it is waiting for your decision. Review it on the scout year screen.'
      )
        .replace('{organization}', organizationName)
        .replace('{name}', memberName || memberEmail)
        .replace('{email}', memberEmail);

      await sendEmail(admin.email, subject, body, `<p>${body.replace(/\n/g, '<br />')}</p>`, organizationName);
    }));
  } catch (err) {
    logger?.error('Failed to notify admins of reactivation request', {
      organizationId,
      error: err.message,
    });
  }
}

/**
 * Act on a confirmed reactivation link.
 *
 * The branch that matters is the last one. A membership swept out by the year
 * transition is restored on the spot, because nothing was ever decided about
 * that family — they simply ran out of enrolled children. A membership
 * deactivated for any other reason was somebody's decision, and undoing it is
 * that somebody's call, so this records the request and stops.
 *
 * @param {Object} pool - Database pool
 * @param {string} token - Token from the link
 * @param {Object} [logger] - Logger
 * @returns {Promise<{state: string, organization_name?: string}>} Outcome
 */
async function confirmReactivation(pool, token, logger) {
  const payload = verifyReactivationToken(token);
  if (!payload) {
    return { state: 'invalid' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT id, email, full_name FROM users WHERE id = $1',
      [payload.user_id]
    );
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { state: 'invalid' };
    }

    const membership = await loadMembershipForToken(client, payload);
    let state;
    // A repeat click must not mail the admins again: only a request that did not
    // already exist is worth interrupting somebody for.
    let requestIsNew = false;

    if (!membership) {
      await insertParentMembership(client, payload);
      state = 'joined';
    } else if (membership.status === 'active') {
      state = 'already_active';
    } else if (membership.deactivated_reason === ROUTINE_DEACTIVATION_REASON) {
      await client.query(
        `UPDATE user_organizations
            SET status = 'active',
                deactivated_at = NULL,
                deactivated_reason = NULL,
                reactivation_requested_at = NULL
          WHERE id = $1 AND organization_id = $2`,
        [membership.membership_id, payload.organization_id]
      );
      state = 'reactivated';
    } else {
      requestIsNew = !membership.reactivation_requested_at;
      await client.query(
        `UPDATE user_organizations
            SET reactivation_requested_at = COALESCE(reactivation_requested_at, now())
          WHERE id = $1 AND organization_id = $2`,
        [membership.membership_id, payload.organization_id]
      );
      state = 'pending_approval';
    }

    await client.query('COMMIT');

    logger?.info('Reactivation link confirmed', {
      organizationId: payload.organization_id,
      userId: payload.user_id,
      state,
    });

    const organizationName = await getOrganizationName(pool, payload.organization_id);

    // After COMMIT: a mail transport failure must not undo a recorded request.
    if (requestIsNew) {
      await notifyAdminsOfReactivationRequest(pool, {
        organizationId: payload.organization_id,
        organizationName,
        memberName: userResult.rows[0].full_name,
        memberEmail: userResult.rows[0].email,
        logger,
      });
    }

    return { state, organization_name: organizationName };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  REACTIVATION_PURPOSE,
  REACTIVATION_TOKEN_TTL,
  ROUTINE_DEACTIVATION_REASON,
  issueReactivationToken,
  verifyReactivationToken,
  findMembershipStanding,
  classifyStanding,
  buildReactivationMessage,
  notifyAdminsOfReactivationRequest,
  requestReactivation,
  describeReactivationLink,
  confirmReactivation,
};
