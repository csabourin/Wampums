'use strict';

/**
 * Account provisioning — turning an emailed link into a person in a unit.
 *
 * Two flows arrive at the same place: an admin's invitation, and one parent's
 * request to share a family with another. Both end with someone who proved they
 * read mail sent to an address, and who must come out the other side with an
 * account, a parent membership in the unit, and a guardian contact record the
 * unit can reach them through. Both must also leave an existing account's
 * password and profile alone, and neither may quietly undo a membership an
 * administrator closed by hand.
 *
 * Those rules live here once, so the two flows cannot drift apart on them.
 *
 * @module services/accountProvisioning
 */

const bcrypt = require('bcryptjs');
const { ROUTINE_DEACTIVATION_REASON } = require('./reactivation');
const { syncAccountNamesForGuardians } = require('./accountNames');

/**
 * What acceptance did.
 *
 * Distinct from {@link INVITATION_STATE}, which describes a link before anyone
 * acts on it. These say what happened, because the page that follows differs:
 * a new account is already signed in conceptually and goes to onboarding, an
 * existing one goes to the login form, and a membership an admin deactivated by
 * hand goes nowhere until a human looks at it.
 */
const ACCEPTANCE_RESULT = {
  ACCOUNT_CREATED: 'account_created',
  MEMBERSHIP_ADDED: 'membership_added',
  ALREADY_MEMBER: 'already_member',
  PENDING_APPROVAL: 'pending_approval',
};

/** Cost factor for password hashing, matching the registration route. */
const PASSWORD_HASH_ROUNDS = 10;

/**
 * Give the invited person a membership in the unit: the roles a leader's
 * invitation carries, or else the parent role.
 *
 * @param {Object} client - Client inside the acceptance transaction
 * @param {string} userId - User UUID
 * @param {number} organizationId - Unit
 * @param {number[]|null} [roleIds] - Roles of a leader's invitation
 * @returns {Promise<void>} Resolves once the membership exists
 */
async function insertParentMembership(client, userId, organizationId, roleIds = null) {
  if (Array.isArray(roleIds) && roleIds.length > 0) {
    await client.query(
      `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
       VALUES ($1, $2, $3, 'active')`,
      [userId, organizationId, JSON.stringify(roleIds)]
    );
    return;
  }

  await client.query(
    `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
     VALUES ($1, $2, $3, 'active')`,
    [userId, organizationId, JSON.stringify([await findParentRoleId(client)])]
  );
}

/**
 * The built-in parent role, which every family membership holds.
 *
 * @param {Object} client - Database client
 * @returns {Promise<number>} Role id
 */
async function findParentRoleId(client) {
  const roleResult = await client.query(
    'SELECT id FROM roles WHERE role_name = $1',
    ['parent']
  );

  if (roleResult.rows.length === 0) {
    throw new Error("Role 'parent' not found in roles table");
  }
  return roleResult.rows[0].id;
}

/**
 * Make an active member of the unit one of its families too: a member named
 * a child's parent who holds no family (linked-scope) role receives the parent
 * role, so the parent features reach them.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {string} userId - Member UUID
 * @param {number} organizationId - Unit
 * @returns {Promise<{previousRoleIds: number[], newRoleIds: number[]}|null>}
 *   The change, or null when they already had a family role
 */
async function ensureFamilyRole(client, userId, organizationId) {
  const membership = await client.query(
    `SELECT uo.id, uo.role_ids,
            EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
                JOIN roles r ON r.id = role_id_text::integer
               WHERE r.data_scope = 'linked'
            ) AS has_family_role
       FROM user_organizations uo
      WHERE uo.user_id = $1 AND uo.organization_id = $2
      FOR UPDATE`,
    [userId, organizationId]
  );
  const row = membership.rows[0];
  if (!row || row.has_family_role) {
    return null;
  }
  const previousRoleIds = (row.role_ids || []).map(Number);
  await addMembershipRoles(client, row.id, [await findParentRoleId(client)]);
  const updated = await client.query('SELECT role_ids FROM user_organizations WHERE id = $1', [row.id]);
  return { previousRoleIds, newRoleIds: (updated.rows[0].role_ids || []).map(Number) };
}

/**
 * Add a leader invitation's roles to a membership, keeping those it has.
 *
 * @param {Object} client - Client inside the acceptance transaction
 * @param {number} membershipId - user_organizations id
 * @param {number[]|null} roleIds - Roles to add
 * @returns {Promise<void>}
 */
async function addMembershipRoles(client, membershipId, roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    return;
  }
  await client.query(
    `UPDATE user_organizations
        SET role_ids = (
          SELECT COALESCE(jsonb_agg(DISTINCT (role.value #>> '{}')::int), '[]'::jsonb)
            FROM jsonb_array_elements(COALESCE(role_ids, '[]'::jsonb) || $2::jsonb) AS role
        )
      WHERE id = $1`,
    [membershipId, JSON.stringify(roleIds)]
  );
}

/**
 * Split a display name into the two columns `parents_guardians` insists on.
 *
 * Both are NOT NULL, and someone who has had an account for years may have
 * nothing but a single-word `full_name` behind it. This never invents a person
 * — it only finds something non-empty to put in a column that cannot be empty,
 * and it is used exclusively when creating a contact record that does not yet
 * exist.
 *
 * @param {string|null} fullName - The account's display name
 * @param {string} email - The address, used when there is no name at all
 * @returns {{prenom: string, nom: string}} Given name and surname
 */
function splitFullName(fullName, email) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { prenom: parts[0], nom: parts.slice(1).join(' ') };
  }
  const single = parts[0] || String(email).split('@')[0];
  return { prenom: single, nom: single };
}

/**
 * Make sure the unit can reach this person, and that the contact record knows
 * which account it belongs to.
 *
 * `parents_guardians` is keyed by address, so a row may already exist — an
 * import, or another unit's registration, will have put one there. That is why
 * this updates before it inserts rather than leaning on one upsert: the two
 * cases want opposite things from the same values.
 *
 * When a record exists, a supplied value wins and a missing one changes
 * nothing, so a parent correcting the spelling of their own name makes it
 * stick while an acceptance that supplies nothing leaves an imported record
 * exactly as it was. When no record exists, one is created, falling back to the
 * account's own name for the two columns that may not be null.
 *
 * `user_uuid` is the exception in both directions: an existing link is never
 * reassigned, because the record already belongs to somebody.
 *
 * @param {Object} client - Client inside the acceptance transaction
 * @param {Object} params - Contact details
 * @returns {Promise<number>} Guardian ID
 */
async function upsertGuardianContact(client, {
  userId,
  email,
  firstName = null,
  lastName = null,
  telephoneResidence = null,
  telephoneCellulaire = null,
  accountFullName = null,
}) {
  const updated = await client.query(
    `UPDATE parents_guardians
        SET nom = COALESCE($2, nom),
            prenom = COALESCE($3, prenom),
            telephone_residence = COALESCE($4, telephone_residence),
            telephone_cellulaire = COALESCE($5, telephone_cellulaire),
            user_uuid = COALESCE(user_uuid, $6)
      WHERE courriel = $1
      RETURNING id`,
    [email, lastName, firstName, telephoneResidence, telephoneCellulaire, userId]
  );

  let guardianId = updated.rows[0]?.id;

  if (!guardianId) {
    const fallback = splitFullName(accountFullName, email);
    const inserted = await client.query(
      `INSERT INTO parents_guardians
         (nom, prenom, courriel, telephone_residence, telephone_cellulaire, user_uuid)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (courriel) DO UPDATE SET
         user_uuid = COALESCE(parents_guardians.user_uuid, EXCLUDED.user_uuid)
       RETURNING id`,
      [
        lastName || fallback.nom,
        firstName || fallback.prenom,
        email,
        telephoneResidence,
        telephoneCellulaire,
        userId,
      ]
    );
    guardianId = inserted.rows[0].id;
  }

  // guardian_users is the older of the two mappings and is still what several
  // read paths join through, so both are written. Dropping it here would make a
  // freshly invited parent invisible to code that has not migrated to user_uuid.
  await client.query(
    'INSERT INTO guardian_users (guardian_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [guardianId, userId]
  );

  // The record this account owns names it (services/accountNames.js).
  await syncAccountNamesForGuardians(client, [guardianId]);

  return guardianId;
}

/**
 * Name an account's contact record among these children's guardians.
 *
 * Access to a child (user_participants) and being one of its guardians
 * (participant_guardians) are separate records. The guardian list is what the
 * child's file, its emergency contacts and "Écrire aux familles" read, so a
 * parent given access without it is a parent the unit cannot see. The record
 * attached is the one the account owns (user_uuid); an account without one is
 * left alone, as the Parent/Guardian form offers it pre-filled from the account.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {Object} params - Account and children
 * @param {string} params.userId - User UUID
 * @param {number[]} params.participantIds - Children to attach the record to
 * @returns {Promise<void>} Resolves once linked
 */
async function linkGuardianContactToChildren(client, { userId, participantIds }) {
  if (!participantIds.length) {
    return;
  }
  await client.query(
    `INSERT INTO participant_guardians (guardian_id, participant_id)
     SELECT pg.id, child.id
       FROM parents_guardians pg
       CROSS JOIN unnest($2::int[]) AS child(id)
      WHERE pg.user_uuid = $1
     ON CONFLICT (guardian_id, participant_id) DO NOTHING`,
    [userId, participantIds]
  );
}

/**
 * Bring an existing account into the unit.
 *
 * Three situations, and the difference between the last two is the whole reason
 * this is not one UPDATE:
 *
 * - **No membership.** They have an account elsewhere and are joining. Add it.
 * - **Deactivated by the year transition.** Routine: the household simply had
 *   no child enrolled. Restore it.
 * - **Deactivated by an administrator by hand.** Restored only if the inviting
 *   admin was shown that removal and confirmed it, which the invitation records.
 *   Without that confirmation — the usual cause being a removal that happened
 *   after the invitation went out — the acceptance is recorded but access is
 *   not granted, and the existing approval queue gets the request. Nothing
 *   quietly undoes a removal nobody looked at.
 *
 * @param {Object} client - Client inside the acceptance transaction
 * @param {string} userId - User UUID
 * @param {number} organizationId - Unit
 * @param {Object} [options] - Options
 * @param {boolean} [options.overrideDeactivation] - The inviting admin confirmed
 *   a hand deactivation should be undone
 * @param {number[]|null} [options.roleIds] - Roles of a leader's invitation,
 *   added to the membership whenever access is granted
 * @returns {Promise<string>} One of {@link ACCEPTANCE_RESULT}
 */
async function attachExistingAccount(client, userId, organizationId, { overrideDeactivation = false, roleIds = null } = {}) {
  const membership = await client.query(
    `SELECT id, status, deactivated_reason
       FROM user_organizations
      WHERE user_id = $1 AND organization_id = $2
      FOR UPDATE`,
    [userId, organizationId]
  );

  if (membership.rows.length === 0) {
    await insertParentMembership(client, userId, organizationId, roleIds);
    return ACCEPTANCE_RESULT.MEMBERSHIP_ADDED;
  }

  const existing = membership.rows[0];

  if (existing.status === 'active') {
    await addMembershipRoles(client, existing.id, roleIds);
    return ACCEPTANCE_RESULT.ALREADY_MEMBER;
  }

  if (existing.deactivated_reason === ROUTINE_DEACTIVATION_REASON || overrideDeactivation) {
    await client.query(
      `UPDATE user_organizations
          SET status = 'active',
              deactivated_at = NULL,
              deactivated_reason = NULL,
              reactivation_requested_at = NULL
        WHERE id = $1`,
      [existing.id]
    );
    await addMembershipRoles(client, existing.id, roleIds);
    return ACCEPTANCE_RESULT.MEMBERSHIP_ADDED;
  }

  await client.query(
    `UPDATE user_organizations
        SET reactivation_requested_at = COALESCE(reactivation_requested_at, now())
      WHERE id = $1`,
    [existing.id]
  );
  return ACCEPTANCE_RESULT.PENDING_APPROVAL;
}

/**
 * Create a verified account for an address whose owner just proved control of it.
 *
 * Verified on the strength of the emailed token: reading the mail is what an
 * activation email would have asked for, and asking twice proves nothing more.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {Object} account - Account details
 * @param {string} account.email - Normalized address, taken from the stored
 *   invitation or request, never from the form
 * @param {string} account.password - Plain password, hashed here
 * @param {string|null} account.fullName - Display name
 * @param {string|null} [account.language] - Preferred language
 * @returns {Promise<string>} New user UUID
 */
async function createVerifiedAccount(client, { email, password, fullName, language = null }) {
  const created = await client.query(
    `INSERT INTO users (email, password, full_name, is_verified, language_preference)
     VALUES ($1, $2, $3, true, $4)
     RETURNING id`,
    [email, await bcrypt.hash(password, PASSWORD_HASH_ROUNDS), fullName || null, language]
  );
  return created.rows[0].id;
}

/**
 * Whether a membership row was closed by a person rather than by the calendar.
 *
 * Only the year transition's own reason counts as routine. Everything else —
 * an admin's click, a transfer, a reason nobody recorded — was somebody's
 * decision.
 *
 * @param {Object|null} membership - Row with `status` and `deactivated_reason`
 * @returns {boolean} True when inactive for a non-routine reason
 */
function isHandDeactivatedMembership(membership) {
  return Boolean(membership)
    && membership.status !== 'active'
    && membership.deactivated_reason !== ROUTINE_DEACTIVATION_REASON;
}

module.exports = {
  ACCEPTANCE_RESULT,
  PASSWORD_HASH_ROUNDS,
  insertParentMembership,
  ensureFamilyRole,
  splitFullName,
  upsertGuardianContact,
  linkGuardianContactToChildren,
  attachExistingAccount,
  createVerifiedAccount,
  isHandDeactivatedMembership,
};
