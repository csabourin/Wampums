'use strict';

/**
 * Walk-in children — a child who shows up before their family has an account.
 *
 * A scout brings a friend; a family turns up for the first time. The unit wants
 * to take attendance and award points from that first evening, and the parent
 * is not there to register. So a leader or administrator enters the child with the least
 * that identifies them -- name and birth date -- and the one parent address they
 * were given, and the parent is invited.
 *
 * The child is real from the start: a participant, enrolled in the active year,
 * visible to attendance, points and honours like any other. What is pending is
 * only the parent. The child is attached to the invitation, and accepting it
 * links the parent to the child in the same step (services/parentInvitations).
 *
 * Three cases for the address, decided by the database, not the form:
 *
 * - **Already a parent in this unit.** No invitation: they already have an
 *   account here. The child is linked to them on the spot, as a grant by the
 *   staff member who entered the child -- which is what it is.
 * - **Already invited.** The child joins the existing invitation. Siblings who
 *   arrive together, or a week apart, produce one email, not two.
 * - **Anyone else.** A new invitation, through the same path as the invite
 *   screen -- including its refusal to quietly readmit someone an administrator
 *   removed by hand. Only someone who may invite (users.invite) can override
 *   that; a leader is told to ask an administrator.
 *
 * @module services/walkInChildren
 */

const {
  CHILD_CREATION_LOCK_NAMESPACE,
  normalizeName,
  tidyName,
  validateChild,
} = require('./parentOnboarding');
const { ensureActiveScoutYear } = require('./scoutYear');
const { findMembershipStanding, classifyStanding } = require('./reactivation');
const { ACCESS_SOURCE, grantParticipantAccess } = require('./participantAccess');
const { createInvitation, resendInvitation } = require('./parentInvitations');
const { isInvitationExpired } = require('../utils/invitation-tokens');

/**
 * Advisory-lock namespace for one parent address in one unit. Two admins
 * entering siblings under the same address at the same moment must end with
 * one invitation, not two -- the partial unique index would refuse the second,
 * and inside a transaction that refusal would abort everything.
 */
const PARENT_ADDRESS_LOCK_NAMESPACE = 1037;

/** What happened to the parent side of a walk-in. */
const PARENT_OUTCOME = {
  LINKED_EXISTING_ACCOUNT: 'linked_existing_account',
  ADDED_TO_INVITATION: 'added_to_invitation',
  INVITED: 'invited',
  BLOCKED: 'manually_deactivated',
};

/**
 * The unit's children who are on this year's roster but whom no account can
 * see -- the list the walk-in screen works through -- each with the invitation
 * they are waiting on, if any.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Unit
 * @param {Object} [options] - Options
 * @param {Date} [options.now] - Clock reading, for tests
 * @returns {Promise<Array<Object>>} Children, by name
 */
async function listChildrenWithoutParent(pool, organizationId, { now = new Date() } = {}) {
  const scoutYear = await ensureActiveScoutYear(pool, organizationId);
  const result = await pool.query(
    `SELECT p.id,
            p.first_name,
            p.last_name,
            p.date_naissance::text AS date_naissance,
            inv.id AS invitation_id,
            inv.email AS invitation_email,
            inv.expires_at AS invitation_expires_at,
            inv.sent_at AS invitation_sent_at
       FROM participants p
       JOIN participant_enrollments pe
         ON pe.participant_id = p.id
        AND pe.organization_id = $1
        AND pe.scout_year_id = $2
        AND pe.status = 'active'
       LEFT JOIN LATERAL (
         SELECT pi.id, pi.email, pi.expires_at, pi.sent_at
           FROM parent_invitation_participants pip
           JOIN parent_invitations pi ON pi.id = pip.invitation_id
          WHERE pip.participant_id = p.id
            AND pi.organization_id = $1
            AND pi.status = 'pending'
          ORDER BY pi.created_at DESC
          LIMIT 1
       ) inv ON true
      WHERE NOT EXISTS (SELECT 1 FROM user_participants up WHERE up.participant_id = p.id)
      ORDER BY p.last_name, p.first_name`,
    [organizationId, scoutYear.id]
  );

  return result.rows.map((row) => ({
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    date_naissance: row.date_naissance,
    invitation: row.invitation_id
      ? {
        id: row.invitation_id,
        email: row.invitation_email,
        sent_at: row.invitation_sent_at,
        state: isInvitationExpired(row.invitation_expires_at, now) ? 'expired' : 'pending',
      }
      : null,
  }));
}

/**
 * Take a child off every live invitation to a different address.
 *
 * Used when an administrator corrects a mistyped address. An invitation that
 * was sent *for* children and is left with none is withdrawn too: its only
 * purpose was those children, and leaving it live would let whoever reads the
 * wrong inbox create an account in the unit.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {Object} params - Which child, keeping which address
 * @returns {Promise<void>} Resolves once detached
 */
async function detachFromOtherInvitations(client, { organizationId, participantId, keepEmail, adminId }) {
  const detached = await client.query(
    `DELETE FROM parent_invitation_participants pip
      USING parent_invitations pi
      WHERE pi.id = pip.invitation_id
        AND pip.participant_id = $1
        AND pi.organization_id = $2
        AND pi.status = 'pending'
        AND ($3::text IS NULL OR pi.email <> $3)
      RETURNING pip.invitation_id`,
    [participantId, organizationId, keepEmail]
  );

  const touched = [...new Set(detached.rows.map((row) => row.invitation_id))];
  if (touched.length === 0) return;

  await client.query(
    `UPDATE parent_invitations
        SET status = 'revoked', revoked_at = now(), revoked_by = $2, updated_at = now()
      WHERE id = ANY($1::uuid[])
        AND status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM parent_invitation_participants pip WHERE pip.invitation_id = parent_invitations.id
        )`,
    [touched, adminId]
  );
}

/**
 * Find a parent for a child: link an existing account, join an existing
 * invitation, or create one.
 *
 * Decides before it writes: if the address belongs to someone an administrator
 * removed by hand and no reason to reinstate them was given, it returns
 * `manually_deactivated` having changed nothing, and the caller rolls back.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {Object} params - The child, the address, and who is acting
 * @returns {Promise<Object>} `{ kind, invitation?, token?, blocked? }`
 */
async function attachParent(client, {
  organizationId,
  participantId,
  email,
  adminId,
  language,
  deactivationOverrideReason = null,
  now = new Date(),
}) {
  await client.query(
    'SELECT pg_advisory_xact_lock($1, hashtext($2))',
    [PARENT_ADDRESS_LOCK_NAMESPACE, `${organizationId}:${email}`]
  );

  const standing = await findMembershipStanding(client, email, organizationId);

  if (classifyStanding(standing) === 'already_active') {
    await detachFromOtherInvitations(client, { organizationId, participantId, keepEmail: null, adminId });
    await grantParticipantAccess(client, {
      participantId,
      userId: standing.user_id,
      sourceType: ACCESS_SOURCE.ADMIN,
      sourceId: adminId,
      grantedBy: adminId,
    });
    await client.query(
      `INSERT INTO participant_guardians (guardian_id, participant_id)
       SELECT pg.id, $1 FROM parents_guardians pg WHERE pg.user_uuid = $2
       ON CONFLICT (guardian_id, participant_id) DO NOTHING`,
      [participantId, standing.user_id]
    );
    return { kind: PARENT_OUTCOME.LINKED_EXISTING_ACCOUNT };
  }

  const pending = await client.query(
    `SELECT * FROM parent_invitations
      WHERE organization_id = $1 AND email = $2 AND status = 'pending'
      FOR UPDATE`,
    [organizationId, email]
  );

  let invitation = pending.rows[0] || null;
  let token = null;
  let kind = PARENT_OUTCOME.ADDED_TO_INVITATION;

  if (!invitation) {
    const created = await createInvitation(client, {
      organizationId,
      email,
      language,
      invitedBy: adminId,
      deactivationOverrideReason,
      now,
    });
    if (!created.ok) {
      // Only a hand deactivation can refuse here: an active member was handled
      // above, and the address lock rules out a concurrent invitation.
      return {
        kind: PARENT_OUTCOME.BLOCKED,
        blocked: { deactivated_at: created.deactivated_at, deactivated_reason: created.deactivated_reason },
      };
    }
    invitation = created.invitation;
    token = created.token;
    kind = PARENT_OUTCOME.INVITED;
  } else if (isInvitationExpired(invitation.expires_at, now)) {
    // Joining a lapsed invitation would attach the child to a link that no
    // longer works. Refresh it; the email goes out after the commit.
    const resent = await resendInvitation(client, { organizationId, invitationId: invitation.id, now });
    invitation = resent.invitation;
    token = resent.token;
  }

  await detachFromOtherInvitations(client, { organizationId, participantId, keepEmail: email, adminId });
  await client.query(
    `INSERT INTO parent_invitation_participants (invitation_id, participant_id, organization_id, added_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (invitation_id, participant_id) DO NOTHING`,
    [invitation.id, participantId, organizationId, adminId]
  );

  return { kind, invitation, token };
}

/**
 * Enter a walk-in child and invite their parent, in one transaction.
 *
 * Refuses a child already in the unit (same name and birth date, any year): the
 * record exists, and the list offers to invite a parent for it instead. This is
 * the unit-wide rule the staff route uses, not the family rule parents get,
 * because an administrator is adding to the unit, not to a family.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Child, parent address, acting administrator
 * @returns {Promise<Object>} `{ result, participant_id?, parent?, invitation?, token?, existing?, blocked?, error? }`
 */
async function createWalkInChild(pool, params) {
  const {
    organizationId,
    adminId,
    firstName,
    lastName,
    dateOfBirth,
    parentEmail,
    language,
    deactivationOverrideReason = null,
    now = new Date(),
  } = params;

  const invalid = validateChild({ firstName, lastName, dateOfBirth }, now);
  if (invalid) {
    return { result: 'invalid', error: invalid };
  }
  const first = tidyName(firstName);
  const last = tidyName(lastName);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // The same lock parents take when registering a child, so an admin and a
    // parent entering the same child at once cannot both create it.
    await client.query(
      'SELECT pg_advisory_xact_lock($1, hashtext($2))',
      [CHILD_CREATION_LOCK_NAMESPACE, `${normalizeName(first)}|${normalizeName(last)}`]
    );

    const existing = await client.query(
      `SELECT p.id, p.first_name, p.last_name, p.date_naissance::text AS date_naissance
         FROM participants p
        WHERE p.date_naissance = $1
          AND lower(regexp_replace(btrim(p.first_name), '\\s+', ' ', 'g')) = $2
          AND lower(regexp_replace(btrim(p.last_name), '\\s+', ' ', 'g')) = $3
          AND EXISTS (
            SELECT 1 FROM participant_enrollments pe
             WHERE pe.participant_id = p.id AND pe.organization_id = $4
          )
        LIMIT 1`,
      [dateOfBirth, normalizeName(first), normalizeName(last), organizationId]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { result: 'duplicate_child', existing: existing.rows[0] };
    }

    const created = await client.query(
      'INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, $2, $3) RETURNING id',
      [first, last, dateOfBirth]
    );
    const participantId = created.rows[0].id;
    const scoutYear = await ensureActiveScoutYear(client, organizationId);
    await client.query(
      `INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, inscription_date)
       VALUES ($1, $2, $3, CURRENT_DATE)`,
      [participantId, organizationId, scoutYear.id]
    );

    const parent = await attachParent(client, {
      organizationId,
      participantId,
      email: parentEmail,
      adminId,
      language,
      deactivationOverrideReason,
      now,
    });

    if (parent.kind === PARENT_OUTCOME.BLOCKED) {
      await client.query('ROLLBACK');
      return { result: PARENT_OUTCOME.BLOCKED, blocked: parent.blocked };
    }

    await client.query('COMMIT');
    return { result: 'created', participant_id: participantId, parent: parent.kind, invitation: parent.invitation, token: parent.token };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Invite a parent for a child already on the roster -- entered earlier, or with
 * an address that needs correcting.
 *
 * Refused for a child an account can already see: that child has a parent, and
 * a second one joins through a family link, which asks the first parent.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Child, parent address, acting administrator
 * @returns {Promise<Object>} `{ result, parent?, invitation?, token?, blocked? }`
 */
async function inviteParentForChild(pool, params) {
  const {
    organizationId,
    adminId,
    participantId,
    parentEmail,
    language,
    deactivationOverrideReason = null,
    now = new Date(),
  } = params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const child = await client.query(
      `SELECT EXISTS (
                SELECT 1 FROM participant_enrollments
                 WHERE participant_id = $1 AND organization_id = $2
              ) AS in_unit,
              EXISTS (SELECT 1 FROM user_participants WHERE participant_id = $1) AS has_parent`,
      [participantId, organizationId]
    );
    if (!child.rows[0].in_unit) {
      await client.query('ROLLBACK');
      return { result: 'not_found' };
    }
    if (child.rows[0].has_parent) {
      await client.query('ROLLBACK');
      return { result: 'already_has_parent' };
    }

    const parent = await attachParent(client, {
      organizationId,
      participantId,
      email: parentEmail,
      adminId,
      language,
      deactivationOverrideReason,
      now,
    });

    if (parent.kind === PARENT_OUTCOME.BLOCKED) {
      await client.query('ROLLBACK');
      return { result: PARENT_OUTCOME.BLOCKED, blocked: parent.blocked };
    }

    await client.query('COMMIT');
    return { result: 'invited', parent: parent.kind, invitation: parent.invitation, token: parent.token };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Send a fresh link for an invitation that was sent for a child.
 *
 * Leaders may add walk-ins without holding users.invite, and they need to
 * resend the links those produce. They may not resend any other invitation:
 * this refuses one that carries no child, which is the admin's screen's job.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Which invitation, in which unit
 * @returns {Promise<Object>} `{ ok: true, invitation, token }` or `{ ok: false }`
 */
async function resendWalkInInvitation(pool, { organizationId, invitationId, now = new Date() }) {
  const carriesChild = await pool.query(
    'SELECT 1 FROM parent_invitation_participants WHERE invitation_id = $1 AND organization_id = $2 LIMIT 1',
    [invitationId, organizationId]
  );
  if (carriesChild.rows.length === 0) {
    return { ok: false };
  }
  return resendInvitation(pool, { organizationId, invitationId, now });
}

module.exports = {
  resendWalkInInvitation,
  PARENT_OUTCOME,
  listChildrenWithoutParent,
  createWalkInChild,
  inviteParentForChild,
};
