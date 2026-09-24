'use strict';

/**
 * Parent onboarding — a family registering its own children.
 *
 * Until now only staff could create a participant. The route that does it,
 * `POST /participants/save`, is guarded by `participants.create`, a key that
 * lets its holder add anyone to the unit, and a parent must not hold that. What
 * a parent needs is narrower and different in kind: to add a child *to their
 * own family*. This module is that, guarded by `participants.create_own`, and
 * the difference is not the permission name but the guarantee — a child made
 * here is always linked to the person who made it, in the same transaction,
 * or it is not made at all.
 *
 * "Family" means the requesting parent plus everyone they share an active
 * family link with in this unit. That set is what a new child is shared with,
 * and it is also the set duplicates are judged against: two unrelated families
 * may each have a Léa Tremblay born the same day, and neither should be told
 * the other exists.
 *
 * A child is one `participants` row however many units they belong to. A
 * youth can be a cub in 6A and a beaver helper in 6H, and that is two
 * enrollments of one person, not two people. So when a parent registers a
 * child they already have in another unit, that child is enrolled here rather
 * than created again — and their forms, medical record and history stay
 * attached to one person.
 *
 * @module services/parentOnboarding
 */

const { ensureActiveScoutYear } = require('./scoutYear');
const { ACCESS_SOURCE, grantParticipantAccess } = require('./participantAccess');
const { getOrganizationName } = require('./alumni');

/**
 * Advisory-lock namespace for child creation, so it cannot collide with the
 * migration runner's lock or anyone else's. The second key is a hash of the
 * unit and the child's normalized name.
 */
const CHILD_CREATION_LOCK_NAMESPACE = 1036;

/**
 * The oldest a participant can plausibly be at registration. The Rover section
 * ends at 25; a birth date further back than this is a typo (2016 typed as
 * 1916), not a member.
 */
const MAX_PARTICIPANT_AGE_YEARS = 26;

/** Longest a name may be, matching the column width. */
const MAX_NAME_LENGTH = 255;

/** What creating a child did, or why it did not. */
const CHILD_RESULT = {
  CREATED: 'created',
  REENROLLED: 'reenrolled',
  ENROLLED_EXISTING: 'enrolled_existing',
  DUPLICATE: 'duplicate_child',
  SIMILAR: 'similar_child_exists',
  INVALID: 'invalid',
};

/**
 * Put a name in the form two spellings of it are compared in.
 *
 * Case and runs of whitespace are the differences a person does not notice
 * typing; accents are not normalized, because "Léa" and "Lea" can be two
 * different children and guessing otherwise would merge them.
 *
 * @param {*} value - Raw name
 * @returns {string} Trimmed, single-spaced, lower-cased name
 */
function normalizeName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Tidy a name for storage without changing what the person typed.
 *
 * @param {*} value - Raw name
 * @returns {string} Trimmed, single-spaced name
 */
function tidyName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Check a child's details before anything is locked or written.
 *
 * @param {Object} child - Submitted details
 * @param {Date} [now] - Clock reading, for tests
 * @returns {string|null} A field error code, or null when the details are usable
 */
function validateChild({ firstName, lastName, dateOfBirth }, now = new Date()) {
  const first = tidyName(firstName);
  const last = tidyName(lastName);
  if (!first || !last) {
    return 'name_required';
  }
  if (first.length > MAX_NAME_LENGTH || last.length > MAX_NAME_LENGTH) {
    return 'name_too_long';
  }

  // A birth date is required here even though the staff route allows none: it
  // is half of what tells two children apart, and a parent always knows it.
  if (typeof dateOfBirth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return 'date_of_birth_required';
  }
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== dateOfBirth) {
    return 'date_of_birth_invalid';
  }
  if (birth.getTime() > now.getTime()) {
    return 'date_of_birth_in_future';
  }
  const earliest = new Date(now);
  earliest.setUTCFullYear(earliest.getUTCFullYear() - MAX_PARTICIPANT_AGE_YEARS);
  if (birth.getTime() < earliest.getTime()) {
    return 'date_of_birth_too_old';
  }
  return null;
}

/**
 * Everyone a parent shares a family with in this unit, themselves first.
 *
 * Each partner comes with the id of the link that connects them, because a
 * grant made on the strength of that link has to be traceable back to it — so
 * that revoking the link takes exactly that access away and nothing else.
 *
 * @param {Object} client - Database client
 * @param {string} userId - The requesting parent
 * @param {number} organizationId - Unit
 * @returns {Promise<Array<{userId: string, linkId: number|null}>>} Family members
 */
async function getFamilyMembers(client, userId, organizationId) {
  const result = await client.query(
    `SELECT CASE WHEN fl.user_id_low = $1 THEN fl.user_id_high ELSE fl.user_id_low END AS user_id,
            fl.id AS link_id
       FROM family_links fl
      WHERE fl.organization_id = $2
        AND fl.status = 'active'
        AND (fl.user_id_low = $1 OR fl.user_id_high = $1)`,
    [userId, organizationId]
  );

  return [
    { userId, linkId: null },
    ...result.rows.map((row) => ({ userId: row.user_id, linkId: row.link_id })),
  ];
}

/**
 * The children this parent's registration has to be checked against.
 *
 * Two sources, deliberately unequal:
 *
 * - **Children in this unit that anyone in the family can see.** The family
 *   link was made in this unit, and consenting to it means sharing this unit's
 *   children.
 * - **Children in any unit that the requesting parent can see themselves.**
 *   Their own child in 6B is the same person when they register them in 6A,
 *   and must be recognised as such rather than created a second time.
 *
 * What is not included is a partner's children in *other* units. A co-parent
 * link made in 6A is not consent to show 6A the children that partner has
 * elsewhere, and matching against them would reveal them to this parent.
 *
 * @param {Object} client - Database client
 * @param {Object} scope - Who is asking, and where
 * @param {string} scope.requesterId - The parent acting
 * @param {Array<string>} scope.familyUserIds - Family members in this unit
 * @param {number} scope.organizationId - Unit
 * @param {number} scope.scoutYearId - The unit's active scout year
 * @returns {Promise<Array<Object>>} Children, each flagged with whether they
 *   already belong to this unit and are on this year's roster
 */
async function listFamilyChildren(client, { requesterId, familyUserIds, organizationId, scoutYearId }) {
  const result = await client.query(
    `SELECT p.id,
            p.first_name,
            p.last_name,
            p.date_naissance::text AS date_naissance,
            EXISTS (
              SELECT 1 FROM participant_enrollments pe
               WHERE pe.participant_id = p.id AND pe.organization_id = $3
            ) AS in_this_unit,
            EXISTS (
              SELECT 1 FROM participant_enrollments cur
               WHERE cur.participant_id = p.id
                 AND cur.organization_id = $3
                 AND cur.scout_year_id = $4
                 AND cur.status = 'active'
            ) AS enrolled_this_year
       FROM participants p
      WHERE p.id IN (
              SELECT up.participant_id
                FROM user_participants up
               WHERE up.user_id = ANY($2::uuid[])
                 AND EXISTS (
                   SELECT 1 FROM participant_enrollments pe
                    WHERE pe.participant_id = up.participant_id AND pe.organization_id = $3
                 )
              UNION
              SELECT up.participant_id
                FROM user_participants up
               WHERE up.user_id = $1
            )
      ORDER BY p.first_name, p.last_name`,
    [requesterId, familyUserIds, organizationId, scoutYearId]
  );
  return result.rows;
}

/**
 * Enroll a child in the active scout year of a unit.
 *
 * Mirrors the staff route: a returning enrollment that had been ended is made
 * active again rather than duplicated.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {number} participantId - Child
 * @param {number} organizationId - Unit
 * @param {number} scoutYearId - Active scout year
 * @returns {Promise<void>} Resolves once enrolled
 */
async function enrollInYear(client, participantId, organizationId, scoutYearId) {
  await client.query(
    `INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, inscription_date)
     VALUES ($1, $2, $3, CURRENT_DATE)
     ON CONFLICT (participant_id, organization_id, scout_year_id)
     DO UPDATE SET status = 'active', ended_on = NULL, exit_reason = NULL`,
    [participantId, organizationId, scoutYearId]
  );
}

/**
 * Give every family member access to a child, each for the right reason, and
 * attach their guardian contact records.
 *
 * The requesting parent's access is `direct`: they created the child. A
 * partner's is `family_link`, pointing at the link it rests on.
 *
 * `participant_guardians.lien` is left empty. Whether this person is the
 * child's mother, father or tutor is asked by the registration form that
 * follows, and a guess recorded here would outlive the answer.
 *
 * @param {Object} client - Client inside the caller's transaction
 * @param {number} participantId - Child
 * @param {Array<{userId: string, linkId: number|null}>} family - Family members
 * @param {string} requesterId - The parent acting
 * @returns {Promise<void>} Resolves once linked
 */
async function linkChildToFamily(client, participantId, family, requesterId) {
  for (const member of family) {
    // Sequential on purpose: these share one transaction's connection, which
    // runs one statement at a time whatever the caller does.
    // eslint-disable-next-line no-await-in-loop
    await grantParticipantAccess(client, {
      participantId,
      userId: member.userId,
      sourceType: member.linkId === null ? ACCESS_SOURCE.DIRECT : ACCESS_SOURCE.FAMILY_LINK,
      sourceId: member.linkId,
      grantedBy: requesterId,
    });
  }

  await client.query(
    `INSERT INTO participant_guardians (guardian_id, participant_id)
     SELECT pg.id, $1
       FROM parents_guardians pg
      WHERE pg.user_uuid = ANY($2::uuid[])
     ON CONFLICT (guardian_id, participant_id) DO NOTHING`,
    [participantId, family.map((member) => member.userId)]
  );
}

/**
 * Register a child for the family of the parent asking.
 *
 * One transaction. It opens by taking an advisory lock on the unit and the
 * child's normalized name, which is what stops two co-parents submitting the
 * same child at the same moment from both seeing "no duplicate" and both
 * inserting. The lock is keyed on the name alone — not the family, which is
 * exactly what two concurrent requests might disagree about, and not the unit,
 * because the same child registered into two units at once is still one child.
 *
 * Against the children this parent's registration is checked against (see
 * {@link listFamilyChildren}):
 *
 * - **Same name and birth date, already on this unit's roster this year** —
 *   refused. It is the same child.
 * - **Same name and birth date, known to this unit but not this year** — a
 *   returning child. Re-enrolled, not duplicated.
 * - **Same name and birth date, only in another unit** — the parent's own
 *   child joining a second unit. Enrolled here as the same person.
 * - **Same name, different birth date** — paused. Siblings can share a name
 *   and a mistyped birth date looks exactly like this, so the parent is shown
 *   the match and asked, and a resubmission with `confirmSimilar` goes through.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Request
 * @param {string} params.userId - The parent acting
 * @param {number} params.organizationId - Unit
 * @param {string} params.firstName - Child's first name
 * @param {string} params.lastName - Child's last name
 * @param {string} params.dateOfBirth - ISO date
 * @param {boolean} [params.confirmSimilar] - The parent has seen a same-name
 *   match and confirms this is a different child
 * @param {Object} [options] - Options
 * @param {Date} [options.now] - Clock reading, for tests
 * @returns {Promise<Object>} `{ result, participant_id? , matches?, error? }`
 */
async function createChild(pool, params, { now = new Date() } = {}) {
  const {
    userId,
    organizationId,
    firstName,
    lastName,
    dateOfBirth,
    confirmSimilar = false,
  } = params;

  const invalid = validateChild({ firstName, lastName, dateOfBirth }, now);
  if (invalid) {
    return { result: CHILD_RESULT.INVALID, error: invalid };
  }

  const first = tidyName(firstName);
  const last = tidyName(lastName);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'SELECT pg_advisory_xact_lock($1, hashtext($2))',
      [CHILD_CREATION_LOCK_NAMESPACE, `${normalizeName(first)}|${normalizeName(last)}`]
    );

    const scoutYear = await ensureActiveScoutYear(client, organizationId);
    const family = await getFamilyMembers(client, userId, organizationId);
    const familyUserIds = family.map((member) => member.userId);
    const existing = await listFamilyChildren(client, {
      requesterId: userId,
      familyUserIds,
      organizationId,
      scoutYearId: scoutYear.id,
    });

    const sameName = existing.filter((child) => normalizeName(child.first_name) === normalizeName(first)
      && normalizeName(child.last_name) === normalizeName(last));
    const exact = sameName.find((child) => child.date_naissance === dateOfBirth);

    if (exact && exact.enrolled_this_year) {
      await client.query('ROLLBACK');
      return { result: CHILD_RESULT.DUPLICATE, participant_id: exact.id };
    }

    if (exact) {
      await enrollInYear(client, exact.id, organizationId, scoutYear.id);
      await linkChildToFamily(client, exact.id, family, userId);
      await client.query('COMMIT');
      return {
        result: exact.in_this_unit ? CHILD_RESULT.REENROLLED : CHILD_RESULT.ENROLLED_EXISTING,
        participant_id: exact.id,
      };
    }

    if (sameName.length > 0 && !confirmSimilar) {
      await client.query('ROLLBACK');
      return {
        result: CHILD_RESULT.SIMILAR,
        matches: sameName.map(({ id, first_name: f, last_name: l, date_naissance: d }) => ({
          id, first_name: f, last_name: l, date_naissance: d,
        })),
      };
    }

    const created = await client.query(
      `INSERT INTO participants (first_name, last_name, date_naissance)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [first, last, dateOfBirth]
    );
    const participantId = created.rows[0].id;

    await enrollInYear(client, participantId, organizationId, scoutYear.id);
    await linkChildToFamily(client, participantId, family, userId);

    await client.query('COMMIT');
    return { result: CHILD_RESULT.CREATED, participant_id: participantId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * What the onboarding screen needs to know about where this parent stands.
 *
 * Read from the database rather than from anything the browser kept, so a
 * parent who accepted on a phone and signs in on a laptop lands in the same
 * place.
 *
 * @param {Object} pool - Database pool
 * @param {string} userId - The parent
 * @param {number} organizationId - Unit
 * @returns {Promise<Object>} Onboarding context
 */
async function getOnboardingContext(pool, userId, organizationId) {
  const scoutYear = await ensureActiveScoutYear(pool, organizationId);
  const family = await getFamilyMembers(pool, userId, organizationId);
  const children = await listFamilyChildren(pool, {
    requesterId: userId,
    familyUserIds: family.map((member) => member.userId),
    organizationId,
    scoutYearId: scoutYear.id,
  });

  const invitation = await pool.query(
    `SELECT id, support_contact_name, support_contact_email, onboarding_completed_at, accepted_at
       FROM parent_invitations
      WHERE accepted_user_id = $1
        AND organization_id = $2
        AND status = 'accepted'
      ORDER BY accepted_at DESC
      LIMIT 1`,
    [userId, organizationId]
  );
  const latest = invitation.rows[0] || null;

  return {
    organization_name: await getOrganizationName(pool, organizationId),
    scout_year: { id: scoutYear.id, label: scoutYear.label },
    onboarding_pending: Boolean(latest && !latest.onboarding_completed_at),
    support_contact: latest?.support_contact_email
      ? { name: latest.support_contact_name, email: latest.support_contact_email }
      : null,
    family_size: family.length,
    children,
  };
}

/**
 * Mark this parent's onboarding finished, so they stop being sent back to it.
 *
 * @param {Object} pool - Database pool
 * @param {string} userId - The parent
 * @param {number} organizationId - Unit
 * @returns {Promise<boolean>} Whether anything was pending
 */
async function completeOnboarding(pool, userId, organizationId) {
  const result = await pool.query(
    `UPDATE parent_invitations
        SET onboarding_completed_at = now(), updated_at = now()
      WHERE accepted_user_id = $1
        AND organization_id = $2
        AND status = 'accepted'
        AND onboarding_completed_at IS NULL`,
    [userId, organizationId]
  );
  return result.rowCount > 0;
}

module.exports = {
  CHILD_RESULT,
  MAX_PARTICIPANT_AGE_YEARS,
  normalizeName,
  validateChild,
  getFamilyMembers,
  createChild,
  getOnboardingContext,
  completeOnboarding,
};
