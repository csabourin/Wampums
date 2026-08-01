/**
 * Alumni Service
 *
 * A family whose last child has left keeps its account, deactivated. That is
 * the safe default — it destroys nothing — but it is not a relationship. This
 * module is how a deactivated membership is offered the chance to become one,
 * and how it leaves again.
 *
 * Three properties hold the whole design together (§8.8 of
 * devdocs/GESTION_ANNEE_SCOUTE.md):
 *
 * 1. **Never automatic.** A year transition posts `inactive` and stops there.
 *    `alumni` is only ever reached through a link the person clicked.
 * 2. **No login.** The ask goes out at the moment access is withdrawn, so
 *    requiring a password would be asking someone to use a door we just locked.
 *    The link carries a short signed token naming the membership, and nothing
 *    else — no address, no child's name, nothing worth intercepting.
 * 3. **Silence is a no.** An invitation that goes unanswered leaves the
 *    membership `inactive`. Nothing here ever infers consent from inaction.
 *
 * @module services/alumni
 */

const { signJWTToken, verifyJWTToken } = require('../utils/jwt-config');
const { sendEmail, getTranslationsByCode, getUserEmailLanguage } = require('../utils/index');

/** Roles that make an account "a parent and nothing more". */
const PARENT_ONLY_ROLES = ['parent', 'guardian', 'demoparent'];

/** Token purposes. A consent token can never be replayed as an unsubscribe. */
const CONSENT_PURPOSE = 'alumni_consent';
const UNSUBSCRIBE_PURPOSE = 'alumni_unsubscribe';

/**
 * How long the opt-in link stays valid.
 *
 * Long, deliberately: this email lands in June, in the middle of everything
 * else that ends a scout year, and the person it is addressed to no longer has
 * any reason to check this application. A fortnight would turn "no answer" into
 * "answered too late".
 */
const CONSENT_TOKEN_TTL = '180d';

/**
 * How long an unsubscribe link stays valid.
 *
 * An unsubscribe link that has expired is a broken promise, so this outlives
 * any plausible mailing. It is issued fresh in every alumni email anyway.
 */
const UNSUBSCRIBE_TOKEN_TTL = '1825d';

/**
 * Mint a signed link token for a membership.
 *
 * @param {Object} membership - Membership the link acts on
 * @param {number} membership.membership_id - `user_organizations.id`
 * @param {string} membership.user_id - Owning user UUID
 * @param {number} membership.organization_id - Organization ID
 * @param {string} purpose - CONSENT_PURPOSE or UNSUBSCRIBE_PURPOSE
 * @returns {string} Signed JWT
 */
function issueAlumniToken(membership, purpose) {
  const ttl = purpose === CONSENT_PURPOSE ? CONSENT_TOKEN_TTL : UNSUBSCRIBE_TOKEN_TTL;
  return signJWTToken(
    {
      purpose,
      membership_id: membership.membership_id,
      user_id: membership.user_id,
      organization_id: membership.organization_id,
    },
    { expiresIn: ttl }
  );
}

/**
 * Verify a link token and confirm it was minted for the expected purpose.
 *
 * @param {string} token - Token from the link
 * @param {string} expectedPurpose - Purpose the caller is willing to honour
 * @returns {Object|null} Payload, or null when absent, invalid, expired or of
 *   the wrong purpose
 */
function verifyAlumniToken(token, expectedPurpose) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  let payload;
  try {
    payload = verifyJWTToken(token);
  } catch (_err) {
    return null;
  }

  if (payload?.purpose !== expectedPurpose) {
    return null;
  }
  if (!payload.membership_id || !payload.organization_id) {
    return null;
  }
  return payload;
}

/**
 * List the memberships that may still be asked to become alumni.
 *
 * Deliberately narrow. A membership qualifies only when it is deactivated,
 * holds no role beyond parent, carries a usable address, and has never been
 * asked before: this email is a courtesy at the end of a relationship, and
 * sending it twice would turn it into a nuisance.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Array<Object>>} Candidate memberships
 */
async function listInvitationCandidates(pool, organizationId) {
  const result = await pool.query(
    `SELECT uo.id AS membership_id,
            uo.user_id,
            uo.organization_id,
            uo.deactivated_at,
            u.email,
            u.full_name
       FROM user_organizations uo
       JOIN users u ON u.id = uo.user_id
      WHERE uo.organization_id = $1
        AND uo.status = 'inactive'
        AND uo.alumni_invited_at IS NULL
        AND u.email IS NOT NULL
        AND u.email <> ''
        AND NOT EXISTS (
          SELECT 1
            FROM jsonb_array_elements_text(uo.role_ids) AS role_id_text
            JOIN roles r ON r.id = role_id_text::integer
           WHERE r.role_name <> ALL ($2::text[])
        )
      ORDER BY u.full_name NULLS LAST, u.email`,
    [organizationId, PARENT_ONLY_ROLES]
  );

  return result.rows;
}

/**
 * List the consented alumni of an organization.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @returns {Promise<Array<Object>>} Alumni memberships with their address
 */
async function listAlumni(pool, organizationId) {
  const result = await pool.query(
    `SELECT uo.id AS membership_id,
            uo.user_id,
            uo.organization_id,
            uo.alumni_consent_at,
            LOWER(u.email) AS email,
            u.full_name
       FROM user_organizations uo
       JOIN users u ON u.id = uo.user_id
      WHERE uo.organization_id = $1
        AND uo.status = 'alumni'
        AND u.email IS NOT NULL
        AND u.email <> ''
      ORDER BY u.full_name NULLS LAST, u.email`,
    [organizationId]
  );

  return result.rows;
}

/**
 * Build the bilingual opt-in email for one candidate.
 *
 * @param {Object} params - Message inputs
 * @param {string} params.language - Language code for this recipient
 * @param {string} params.organizationName - Unit name, shown to the reader
 * @param {string} params.consentLink - One-click opt-in URL
 * @returns {{subject: string, text: string, html: string}} Message parts
 */
function buildInvitationMessage({ language, organizationName, consentLink }) {
  const t = getTranslationsByCode(language);
  const fallback = getTranslationsByCode('en');
  const pick = (key, literal) => t[key] || fallback[key] || literal;

  const subject = pick('alumni_invite_subject', 'Would you like to hear from us?')
    .replace('{organization}', organizationName);
  const heading = pick('alumni_invite_heading', 'Staying in touch is up to you');
  const intro = pick(
    'alumni_invite_intro',
    'Your child is no longer registered with {organization}, so your access has been closed.'
  ).replace('{organization}', organizationName);
  const offer = pick(
    'alumni_invite_offer',
    'If you would like to keep hearing from us once in a while — anniversaries, reunions, calls for volunteers — you can say so with a single click. We will not write to you otherwise.'
  );
  const button = pick('alumni_invite_button', 'Keep me informed');
  const copyHint = pick('alumni_invite_copy_hint', 'Or copy this link:');
  const silence = pick(
    'alumni_invite_silence',
    'If you do nothing, you will not hear from us again. That is a perfectly good answer and no reply is needed.'
  );

  const text = [heading, '', intro, '', offer, '', consentLink, '', silence].join('\n');
  const html = `
    <h2>${heading}</h2>
    <p>${intro}</p>
    <p>${offer}</p>
    <p><a href="${consentLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">${button}</a></p>
    <p>${copyHint} <a href="${consentLink}">${consentLink}</a></p>
    <p><em>${silence}</em></p>
  `;

  return { subject, text, html };
}

/**
 * Build the unsubscribe footer appended to every alumni mailing.
 *
 * @param {Object} params - Message inputs
 * @param {string} params.language - Language code for this recipient
 * @param {string} params.unsubscribeLink - One-click unsubscribe URL
 * @returns {{text: string, html: string}} Footer parts
 */
function buildUnsubscribeFooter({ language, unsubscribeLink }) {
  const t = getTranslationsByCode(language);
  const fallback = getTranslationsByCode('en');
  const label = t.alumni_unsubscribe_footer
    || fallback.alumni_unsubscribe_footer
    || 'You are receiving this as a former member. Unsubscribe:';

  return {
    text: `\n\n---\n${label} ${unsubscribeLink}`,
    html: `<hr /><p style="font-size: 12px; color: #666;">${label} <a href="${unsubscribeLink}">${unsubscribeLink}</a></p>`,
  };
}

/**
 * Resolve the unit's display name for use in an email.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @returns {Promise<string>} Organization name
 */
async function getOrganizationName(pool, organizationId) {
  const result = await pool.query(
    `SELECT COALESCE(
              (SELECT setting_value->>'name'
                 FROM organization_settings
                WHERE organization_id = $1 AND setting_key = 'organization_info'),
              o.name
            ) AS name
       FROM organizations o
      WHERE o.id = $1`,
    [organizationId]
  );
  return result.rows[0]?.name || 'Wampums';
}

/**
 * Send the opt-in email to the given candidates.
 *
 * Marks a membership as invited only when its email actually went out, so a
 * transport failure leaves it a candidate rather than silently consuming the
 * one invitation it was owed.
 *
 * @param {Object} pool - Database pool
 * @param {Object} logger - Winston logger
 * @param {Object} params - Send parameters
 * @param {number} params.organizationId - Organization ID
 * @param {Array<number>} [params.membershipIds] - Restrict to these memberships;
 *   omit to invite every eligible candidate
 * @param {string} params.baseUrl - Origin the links point at
 * @returns {Promise<{invited: number, failed: number, skipped: number}>} Outcome
 */
async function sendAlumniInvitations(pool, logger, { organizationId, membershipIds, baseUrl }) {
  const candidates = await listInvitationCandidates(pool, organizationId);
  const requested = Array.isArray(membershipIds) && membershipIds.length > 0
    ? new Set(membershipIds.map(Number))
    : null;
  const targets = requested
    ? candidates.filter((row) => requested.has(row.membership_id))
    : candidates;

  const skipped = requested ? requested.size - targets.length : 0;
  const organizationName = await getOrganizationName(pool, organizationId);

  const outcomes = await Promise.all(
    targets.map(async (candidate) => {
      const language = await getUserEmailLanguage(pool, candidate.email, organizationId);
      const consentLink = `${baseUrl}/alumni-consent?token=${issueAlumniToken(candidate, CONSENT_PURPOSE)}`;
      const { subject, text, html } = buildInvitationMessage({
        language,
        organizationName,
        consentLink,
      });

      const sent = await sendEmail(candidate.email, subject, text, html, organizationName);
      if (!sent) {
        logger?.error('Alumni invitation failed to send', {
          membershipId: candidate.membership_id,
          organizationId,
        });
        return false;
      }

      await pool.query(
        `UPDATE user_organizations
            SET alumni_invited_at = now()
          WHERE id = $1 AND organization_id = $2 AND status = 'inactive'`,
        [candidate.membership_id, organizationId]
      );
      return true;
    })
  );

  const invited = outcomes.filter(Boolean).length;
  return { invited, failed: outcomes.length - invited, skipped };
}

/**
 * Describe what a consent link is about to do, without acting on it.
 *
 * Lets the landing page name the unit before asking for a click, and lets it
 * say plainly that a link is expired or already used instead of failing at the
 * moment the person acts.
 *
 * @param {Object} pool - Database pool
 * @param {string} token - Token from the link
 * @returns {Promise<{state: string, organization_name?: string}>} Link state
 */
async function describeConsentInvitation(pool, token) {
  const payload = verifyAlumniToken(token, CONSENT_PURPOSE);
  if (!payload) {
    return { state: 'invalid' };
  }

  const result = await pool.query(
    `SELECT status, alumni_consent_at
       FROM user_organizations
      WHERE id = $1 AND organization_id = $2`,
    [payload.membership_id, payload.organization_id]
  );

  const membership = result.rows[0];
  if (!membership) {
    return { state: 'invalid' };
  }

  const organizationName = await getOrganizationName(pool, payload.organization_id);
  if (membership.status === 'alumni') {
    return { state: 'already_consented', organization_name: organizationName };
  }
  if (membership.status === 'active') {
    return { state: 'membership_active', organization_name: organizationName };
  }
  return { state: 'ready', organization_name: organizationName };
}

/**
 * Record an opt-in.
 *
 * Only a deactivated membership can consent. A membership that became active
 * again — the family came back — is left alone: it already has a relationship,
 * and downgrading it to alumni would take away access the person now has.
 *
 * @param {Object} pool - Database pool
 * @param {string} token - Token from the link
 * @returns {Promise<{state: string, organization_name?: string}>} Outcome
 */
async function recordConsent(pool, token) {
  const payload = verifyAlumniToken(token, CONSENT_PURPOSE);
  if (!payload) {
    return { state: 'invalid' };
  }

  const result = await pool.query(
    `UPDATE user_organizations
        SET status = 'alumni',
            alumni_consent_at = COALESCE(alumni_consent_at, now()),
            alumni_opted_out_at = NULL
      WHERE id = $1
        AND organization_id = $2
        AND status = 'inactive'
      RETURNING id`,
    [payload.membership_id, payload.organization_id]
  );

  const organizationName = await getOrganizationName(pool, payload.organization_id);
  if (result.rows.length > 0) {
    return { state: 'consented', organization_name: organizationName };
  }

  return { ...(await describeConsentInvitation(pool, token)), organization_name: organizationName };
}

/**
 * Record a one-click unsubscribe.
 *
 * Returns the membership to `inactive` — the state it would have been in had
 * the person never answered — and keeps the timestamp as proof the request was
 * honoured. Idempotent: clicking twice is not an error, because the person
 * asking to be left alone should never be shown a failure.
 *
 * @param {Object} pool - Database pool
 * @param {string} token - Token from the link
 * @returns {Promise<{state: string, organization_name?: string}>} Outcome
 */
async function recordOptOut(pool, token) {
  const payload = verifyAlumniToken(token, UNSUBSCRIBE_PURPOSE);
  if (!payload) {
    return { state: 'invalid' };
  }

  await pool.query(
    `UPDATE user_organizations
        SET status = 'inactive',
            alumni_opted_out_at = now(),
            alumni_consent_at = NULL
      WHERE id = $1
        AND organization_id = $2
        AND status = 'alumni'`,
    [payload.membership_id, payload.organization_id]
  );

  const organizationName = await getOrganizationName(pool, payload.organization_id);
  return { state: 'unsubscribed', organization_name: organizationName };
}

module.exports = {
  CONSENT_PURPOSE,
  UNSUBSCRIBE_PURPOSE,
  PARENT_ONLY_ROLES,
  issueAlumniToken,
  verifyAlumniToken,
  listInvitationCandidates,
  listAlumni,
  buildInvitationMessage,
  buildUnsubscribeFooter,
  getOrganizationName,
  sendAlumniInvitations,
  describeConsentInvitation,
  recordConsent,
  recordOptOut,
};
