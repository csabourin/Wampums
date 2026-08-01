/**
 * Transfer Service
 *
 * Moving a participant to a sister unit — the family relocates, the child ages
 * into the next section, two units merge.
 *
 * The decision this implements (§8.5 of devdocs/GESTION_ANNEE_SCOUTE.md) is
 * that **a transfer takes the parents with the child**. A parent left behind in
 * the old unit's account list and absent from the new one has to be re-invited
 * by hand, which in practice means they are not.
 *
 * The subtlety is the parent with children in more than one unit. Such a parent
 * is *added* to the destination rather than *moved* to it: their membership of
 * the origin still has a child behind it and stays active. Each membership then
 * shows only the child enrolled there — which already works, since a parent's
 * participant list is filtered by organization.
 *
 * What deliberately does not travel:
 *
 * - **Form submissions.** They carry an `organization_id` and were filled in for
 *   a unit that is not the destination. The receiving unit asks for its own,
 *   which is also the moment consent to hold that data is given to it. The
 *   count left behind is reported so nobody assumes the health form followed.
 * - **Den assignment, points, attendance, honours.** They describe a season
 *   inside the origin unit and remain part of its history.
 * - **Fees and unpaid balances.** Money owed is owed to the unit that billed it
 *   (§9, "not year-scoped"); a transfer does not move a debt between tenants.
 *
 * Guardians need no handling: `parents_guardians` is global and linked to the
 * participant, so it follows the child by construction.
 *
 * @module services/transfer
 */

/** Roles that make an account "a parent and nothing more". */
const PARENT_ONLY_ROLES = ['parent', 'guardian', 'demoparent'];

/** Role granted to a parent arriving in the destination unit. */
const PARENT_ROLE = 'parent';

/**
 * List the units a participant may be transferred to.
 *
 * Bounded to the origin's local group. A transfer crosses a tenant boundary, so
 * "any organization in the database" would be an unacceptable target list: the
 * local group is the existing structure that says which units belong together.
 *
 * @param {Object} pool - Database pool or client
 * @param {number} organizationId - Origin organization ID
 * @returns {Promise<Array<Object>>} Sibling organizations
 */
async function listSiblingOrganizations(pool, organizationId) {
  const result = await pool.query(
    `SELECT DISTINCT o.id, o.name, o.program_section
       FROM organization_local_groups source
       JOIN organization_local_groups sibling
         ON sibling.local_group_id = source.local_group_id
       JOIN organizations o ON o.id = sibling.organization_id
      WHERE source.organization_id = $1
        AND sibling.organization_id <> $1
      ORDER BY o.name`,
    [organizationId]
  );

  return result.rows;
}

/**
 * Confirm two organizations share a local group.
 *
 * @param {Object} client - Database pool or client
 * @param {number} organizationId - Origin organization ID
 * @param {number} targetOrganizationId - Destination organization ID
 * @returns {Promise<boolean>} True when they are siblings
 */
async function areSiblings(client, organizationId, targetOrganizationId) {
  const result = await client.query(
    `SELECT 1
       FROM organization_local_groups source
       JOIN organization_local_groups sibling
         ON sibling.local_group_id = source.local_group_id
      WHERE source.organization_id = $1
        AND sibling.organization_id = $2
      LIMIT 1`,
    [organizationId, targetOrganizationId]
  );

  return result.rows.length > 0;
}

/**
 * Find the parent accounts attached to a participant.
 *
 * Both routes to a parent count: a direct `user_participants` link, and the
 * indirect one through a guardian record.
 *
 * @param {Object} client - Database client
 * @param {number} participantId - Participant being transferred
 * @returns {Promise<Array<string>>} User UUIDs
 */
async function findLinkedUsers(client, participantId) {
  const result = await client.query(
    `SELECT DISTINCT user_id FROM (
       SELECT user_id FROM user_participants WHERE participant_id = $1
       UNION
       SELECT gu.user_id
         FROM guardian_users gu
         JOIN participant_guardians pg ON pg.guardian_id = gu.guardian_id
        WHERE pg.participant_id = $1
     ) linked
      WHERE user_id IS NOT NULL`,
    [participantId]
  );

  return result.rows.map((row) => row.user_id);
}

/**
 * Describe what a transfer would do, without doing it.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Transfer parameters
 * @param {number} params.participantId - Participant to move
 * @param {number} params.organizationId - Origin organization ID
 * @param {number} params.targetOrganizationId - Destination organization ID
 * @returns {Promise<Object>} Preview, or `{ blocked: <reason> }`
 */
async function previewTransfer(pool, { participantId, organizationId, targetOrganizationId }) {
  if (organizationId === targetOrganizationId) {
    return { blocked: 'same_organization' };
  }
  if (!(await areSiblings(pool, organizationId, targetOrganizationId))) {
    return { blocked: 'not_a_sibling_unit' };
  }

  const enrollment = await pool.query(
    `SELECT pe.participant_id, pe.inscription_date, sy.id AS scout_year_id
       FROM participant_enrollments pe
       JOIN scout_years sy ON sy.id = pe.scout_year_id
      WHERE pe.participant_id = $1
        AND pe.organization_id = $2
        AND pe.status = 'active'
        AND sy.status = 'active'`,
    [participantId, organizationId]
  );

  if (enrollment.rows.length === 0) {
    return { blocked: 'not_enrolled' };
  }

  const targetYear = await pool.query(
    'SELECT id FROM scout_years WHERE organization_id = $1 AND status = \'active\' LIMIT 1',
    [targetOrganizationId]
  );

  if (targetYear.rows.length === 0) {
    return { blocked: 'target_has_no_active_year' };
  }

  const userIds = await findLinkedUsers(pool, participantId);
  const parents = userIds.length === 0 ? { rows: [] } : await pool.query(
    `SELECT u.id AS user_id,
            u.full_name,
            u.email,
            EXISTS (
              SELECT 1 FROM user_organizations uo
               WHERE uo.user_id = u.id AND uo.organization_id = $2
            ) AS already_in_target,
            (
              SELECT count(*)
                FROM participant_enrollments pe
                JOIN scout_years sy ON sy.id = pe.scout_year_id AND sy.status = 'active'
               WHERE pe.organization_id = $3
                 AND pe.status = 'active'
                 AND pe.participant_id <> $4
                 AND pe.participant_id IN (
                   SELECT participant_id FROM user_participants WHERE user_id = u.id
                   UNION
                   SELECT pg.participant_id
                     FROM guardian_users gu
                     JOIN participant_guardians pg ON pg.guardian_id = gu.guardian_id
                    WHERE gu.user_id = u.id
                 )
            ) AS other_children_in_origin
       FROM users u
      WHERE u.id = ANY($1::uuid[])`,
    [userIds, targetOrganizationId, organizationId, participantId]
  );

  const formsLeftBehind = await pool.query(
    `SELECT count(*)::int AS count
       FROM form_submissions
      WHERE participant_id = $1 AND organization_id = $2`,
    [participantId, organizationId]
  );

  return {
    blocked: null,
    participant_id: participantId,
    target_scout_year_id: targetYear.rows[0].id,
    parents: parents.rows.map((row) => ({
      user_id: row.user_id,
      full_name: row.full_name,
      email: row.email,
      already_in_target: row.already_in_target,
      // A parent still owed a child in the origin keeps their access there;
      // only a parent with nobody left is deactivated.
      keeps_origin_membership: Number(row.other_children_in_origin) > 0,
    })),
    forms_left_behind: formsLeftBehind.rows[0].count,
  };
}

/**
 * Carry out a transfer.
 *
 * Must be called inside an open transaction: the origin enrollment closing and
 * the destination enrollment opening are the same event, and a participant that
 * exists in neither unit — or in both as active — is not a state this system
 * should ever be able to observe.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {Object} params - Transfer parameters
 * @param {number} params.participantId - Participant to move
 * @param {number} params.organizationId - Origin organization ID
 * @param {number} params.targetOrganizationId - Destination organization ID
 * @param {string} params.userId - Who is performing the transfer
 * @param {string} [params.note] - Free-text reason, kept on the closed enrollment
 * @returns {Promise<Object>} Summary of what moved
 */
async function transferParticipant(client, {
  participantId,
  organizationId,
  targetOrganizationId,
  userId,
  note = null,
}) {
  // Lock the origin enrollment for the active year. Two leaders transferring
  // the same child to two different units at once must not both succeed.
  const enrollment = await client.query(
    `SELECT pe.participant_id, pe.inscription_date, pe.scout_year_id
       FROM participant_enrollments pe
       JOIN scout_years sy ON sy.id = pe.scout_year_id
      WHERE pe.participant_id = $1
        AND pe.organization_id = $2
        AND pe.status = 'active'
        AND sy.status = 'active'
      FOR UPDATE OF pe`,
    [participantId, organizationId]
  );

  if (enrollment.rows.length === 0) {
    return { blocked: 'not_enrolled' };
  }

  const targetYear = await client.query(
    'SELECT id FROM scout_years WHERE organization_id = $1 AND status = \'active\' LIMIT 1',
    [targetOrganizationId]
  );

  if (targetYear.rows.length === 0) {
    return { blocked: 'target_has_no_active_year' };
  }

  const targetYearId = targetYear.rows[0].id;
  const { inscription_date: inscriptionDate } = enrollment.rows[0];

  // Close the origin enrollment. The row stays — the child was there, and the
  // unit's history says so.
  await client.query(
    `UPDATE participant_enrollments
        SET status = 'transferred',
            ended_on = CURRENT_DATE,
            exit_reason = 'transfer',
            exception_note = COALESCE($5, exception_note),
            transferred_to_organization_id = $3,
            transferred_at = now(),
            transferred_by = $4
      WHERE participant_id = $1
        AND organization_id = $2
        AND scout_year_id = (
          SELECT sy.id FROM scout_years sy
           WHERE sy.organization_id = $2 AND sy.status = 'active'
        )`,
    [participantId, organizationId, targetOrganizationId, userId, note]
  );

  // Open the destination enrollment, keeping the original inscription date: the
  // child's seniority is theirs, not the unit's.
  await client.query(
    `INSERT INTO participant_enrollments
            (participant_id, organization_id, scout_year_id, inscription_date, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (participant_id, organization_id, scout_year_id)
     DO UPDATE SET status = 'active', ended_on = NULL, exit_reason = NULL`,
    [participantId, targetOrganizationId, targetYearId, inscriptionDate]
  );

  // Take the parents along.
  const userIds = await findLinkedUsers(client, participantId);
  const parentRole = await client.query(
    'SELECT id FROM roles WHERE role_name = $1 LIMIT 1',
    [PARENT_ROLE]
  );
  const parentRoleId = parentRole.rows[0]?.id;

  let membershipsCreated = 0;
  let membershipsReactivated = 0;
  let membershipsDeactivated = 0;

  for (const linkedUserId of userIds) {
    // A membership of the destination may already exist — the parent has
    // another child there. Reactivating beats inserting a duplicate.
    // eslint-disable-next-line no-await-in-loop
    const existing = await client.query(
      `SELECT id, status FROM user_organizations
        WHERE user_id = $1 AND organization_id = $2
        FOR UPDATE`,
      [linkedUserId, targetOrganizationId]
    );

    if (existing.rows.length === 0) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, role_ids, status)
         VALUES ($1, $2, $3::jsonb, 'active')`,
        [linkedUserId, targetOrganizationId, JSON.stringify(parentRoleId ? [parentRoleId] : [])]
      );
      membershipsCreated += 1;
    } else if (existing.rows[0].status !== 'active') {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `UPDATE user_organizations
            SET status = 'active',
                deactivated_at = NULL,
                deactivated_reason = NULL
          WHERE id = $1`,
        [existing.rows[0].id]
      );
      membershipsReactivated += 1;
    }

    // Close the origin membership only for a parent with nobody left there, and
    // never for someone who holds a role beyond parent: a leader who happens to
    // be a parent keeps the unit's own records.
    // eslint-disable-next-line no-await-in-loop
    const deactivated = await client.query(
      `UPDATE user_organizations uo
          SET status = 'inactive',
              deactivated_at = now(),
              deactivated_reason = 'transferred'
        WHERE uo.user_id = $1
          AND uo.organization_id = $2
          AND uo.status = 'active'
          AND NOT EXISTS (
            SELECT 1
              FROM jsonb_array_elements_text(uo.role_ids) AS role_id_text
              JOIN roles r ON r.id = role_id_text::integer
             WHERE r.role_name <> ALL ($3::text[])
          )
          AND NOT EXISTS (
            SELECT 1
              FROM participant_enrollments pe
              JOIN scout_years sy ON sy.id = pe.scout_year_id AND sy.status = 'active'
             WHERE pe.organization_id = $2
               AND pe.status = 'active'
               AND pe.participant_id IN (
                 SELECT participant_id FROM user_participants WHERE user_id = $1
                 UNION
                 SELECT pg.participant_id
                   FROM guardian_users gu
                   JOIN participant_guardians pg ON pg.guardian_id = gu.guardian_id
                  WHERE gu.user_id = $1
               )
          )
        RETURNING uo.id`,
      [linkedUserId, organizationId, PARENT_ONLY_ROLES]
    );
    membershipsDeactivated += deactivated.rows.length;
  }

  const formsLeftBehind = await client.query(
    `SELECT count(*)::int AS count
       FROM form_submissions
      WHERE participant_id = $1 AND organization_id = $2`,
    [participantId, organizationId]
  );

  return {
    blocked: null,
    participant_id: participantId,
    from_organization_id: organizationId,
    to_organization_id: targetOrganizationId,
    target_scout_year_id: targetYearId,
    parents_moved: userIds.length,
    memberships_created: membershipsCreated,
    memberships_reactivated: membershipsReactivated,
    memberships_deactivated: membershipsDeactivated,
    forms_left_behind: formsLeftBehind.rows[0].count,
  };
}

module.exports = {
  PARENT_ONLY_ROLES,
  listSiblingOrganizations,
  areSiblings,
  findLinkedUsers,
  previewTransfer,
  transferParticipant,
};
