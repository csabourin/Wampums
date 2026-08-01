/**
 * Erasure Service
 *
 * Permanently removes a participant and their family, at the family's request.
 *
 * This is the one place in the application that genuinely destroys data. The
 * rest of the system is built on "nothing is ever deleted" — a participant who
 * leaves keeps their record, a parent who is deactivated keeps their account —
 * precisely so that history stays consultable. A right-to-erasure request
 * overrides that, and it has to actually override it: hiding the rows would not
 * be an erasure.
 *
 * What it removes, and what it deliberately does not:
 *
 * - **The participant** and everything that cascades from them: enrolments, den
 *   assignments, points, attendance, honours, forms, medication records, badge
 *   and OAS progress, guardian links.
 * - **Their guardians**, but only those left with no other child.
 * - **Their parent accounts**, but only those left with no other child *and*
 *   holding no role beyond parent. A parent who is also a leader keeps their
 *   account: deleting it would tear out the unit's own records, which are not
 *   theirs to erase. Those accounts are reported back, not silently skipped.
 * - Rows that merely *point* at the participant with `ON DELETE SET NULL` — a
 *   fundraiser entry, an incident report — survive, anonymised. That is the
 *   right outcome for the accounts and for a safety record, but it means free
 *   text inside an incident report is not scrubbed. The count is reported so an
 *   admin can deal with those by hand.
 *
 * @module services/erasure
 */

/** Roles that make an account "a parent and nothing more". */
const PARENT_ONLY_ROLES = ['parent', 'guardian', 'demoparent'];

/**
 * Tables holding participant rows that no foreign key would cascade.
 *
 * `badge_progress` and `names` carry a `participant_id` without a constraint
 * behind it, so deleting the participant would leave them orphaned rather than
 * erased. Listed explicitly so adding a table here is a deliberate act.
 */
const UNLINKED_PARTICIPANT_TABLES = ['badge_progress', 'names'];

/**
 * Find everyone attached to a participant.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {number} participantId - Participant being erased
 * @returns {Promise<{guardianIds: Array<number>, userIds: Array<string>}>} Linked people
 */
async function findLinkedFamily(client, participantId) {
  const guardians = await client.query(
    'SELECT guardian_id FROM participant_guardians WHERE participant_id = $1',
    [participantId]
  );
  const guardianIds = guardians.rows.map(row => row.guardian_id);

  const users = await client.query(
    `SELECT DISTINCT user_id FROM (
       SELECT user_id FROM user_participants WHERE participant_id = $1
       UNION
       SELECT gu.user_id
         FROM guardian_users gu
        WHERE gu.guardian_id = ANY($2::int[])
     ) linked
      WHERE user_id IS NOT NULL`,
    [participantId, guardianIds]
  );

  return { guardianIds, userIds: users.rows.map(row => row.user_id) };
}

/**
 * Find the other organizations holding data on this participant.
 *
 * A participant record is global — `participants` has no `organization_id`; it
 * is the enrollment that is per-unit. So deleting the row reaches every unit the
 * child was ever in, and the cascade takes their attendance, forms, honours and
 * enrollments with it. An administrator of one unit erasing another unit's
 * records is not something the requesting unit has any standing to do, however
 * legitimate the family's request is.
 *
 * The answer therefore has to come from every table that attributes a row to a
 * tenant, not from enrollments alone: a unit that holds a fee or a form for this
 * child has records at stake even if the enrollment was never opened.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {number} participantId - Participant being erased
 * @param {number} organizationId - Organization the request came through
 * @returns {Promise<Array<{id: number, name: string}>>} Other organizations
 */
async function findOwningOrganizations(client, participantId) {
  const result = await client.query(
    `SELECT DISTINCT o.id, o.name
       FROM (
         SELECT organization_id FROM participant_enrollments WHERE participant_id = $1
         UNION
         SELECT organization_id FROM participant_fees WHERE participant_id = $1
         UNION
         SELECT organization_id FROM form_submissions WHERE participant_id = $1
         UNION
         SELECT organization_id FROM participant_group_assignments WHERE participant_id = $1
         UNION
         SELECT organization_id FROM points WHERE participant_id = $1
         UNION
         SELECT organization_id FROM attendance WHERE participant_id = $1
         UNION
         SELECT organization_id FROM honors WHERE participant_id = $1
         UNION
         SELECT organization_id FROM badge_progress WHERE participant_id = $1
       ) owners
       JOIN organizations o ON o.id = owners.organization_id
      WHERE owners.organization_id IS NOT NULL
      ORDER BY o.name`,
    [participantId]
  );

  return result.rows;
}


async function findOtherOrganizations(client, participantId, organizationId) {
  const owners = await findOwningOrganizations(client, participantId);
  return owners.filter(owner => owner.id !== organizationId);
}
/**
 * Remove the money trail attached to a participant.
 *
 * `participant_fees` refuses to cascade — the accounting is meant to outlive a
 * participant record — so it and everything hanging off it come out by hand,
 * innermost first.
 *
 * Not filtered by organization, and safe not to be: `eraseParticipant` refuses
 * to run at all unless the requesting unit is the only one holding data on this
 * participant, so by the time this is reached every fee belongs to it.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {number} participantId - Participant being erased
 * @returns {Promise<Object>} Rows removed per table
 */
async function eraseFinancials(client, participantId) {
  const payments = await client.query(
    `DELETE FROM payments
      WHERE participant_fee_id IN (SELECT id FROM participant_fees WHERE participant_id = $1)`,
    [participantId]
  );
  const plans = await client.query(
    `DELETE FROM payment_plans
      WHERE participant_fee_id IN (SELECT id FROM participant_fees WHERE participant_id = $1)`,
    [participantId]
  );
  const fees = await client.query(
    'DELETE FROM participant_fees WHERE participant_id = $1',
    [participantId]
  );

  return {
    payments: payments.rowCount,
    payment_plans: plans.rowCount,
    participant_fees: fees.rowCount
  };
}

/**
 * Delete a guardian who has no other child left.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {number} guardianId - Guardian to consider
 * @returns {Promise<boolean>} True when the guardian was deleted
 */
async function eraseGuardianIfOrphaned(client, guardianId) {
  const remaining = await client.query(
    'SELECT 1 FROM participant_guardians WHERE guardian_id = $1 LIMIT 1',
    [guardianId]
  );
  if (remaining.rows.length > 0) {
    return false;
  }

  // Both refuse to cascade, so they come out first.
  await client.query('DELETE FROM guardian_users WHERE guardian_id = $1', [guardianId]);
  await client.query('DELETE FROM permission_slips WHERE guardian_id = $1', [guardianId]);
  const deleted = await client.query('DELETE FROM parents_guardians WHERE id = $1', [guardianId]);
  return deleted.rowCount > 0;
}

/**
 * Decide whether an account may be erased, and erase it if so.
 *
 * Two reasons to keep one: another child still enrolled somewhere, or a role
 * beyond parent. The second matters more than it looks — a leader's account is
 * referenced by the honours they awarded and the reports they filed, which
 * belong to the unit, not to them.
 *
 * The delete runs inside a savepoint. An account can be tied to unit records in
 * ways this cannot foresee; when that happens the account is kept and reported
 * rather than the whole erasure failing.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {string} userId - Account to consider
 * @returns {Promise<{erased: boolean, reason: string|null}>} Outcome
 */
async function eraseUserIfOrphaned(client, userId) {
  const stillLinked = await client.query(
    `SELECT 1 FROM (
       SELECT participant_id FROM user_participants WHERE user_id = $1
       UNION
       SELECT pg.participant_id
         FROM guardian_users gu
         JOIN participant_guardians pg ON pg.guardian_id = gu.guardian_id
        WHERE gu.user_id = $1
     ) linked LIMIT 1`,
    [userId]
  );
  if (stillLinked.rows.length > 0) {
    return { erased: false, reason: 'has_other_child' };
  }

  const roles = await client.query(
    `SELECT DISTINCT r.role_name
       FROM user_organizations uo
       CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
       JOIN roles r ON r.id = role_id_text::integer
      WHERE uo.user_id = $1`,
    [userId]
  );
  const heldRoles = roles.rows.map(row => row.role_name);
  if (heldRoles.some(role => !PARENT_ONLY_ROLES.includes(role))) {
    return { erased: false, reason: 'holds_staff_role' };
  }

  await client.query('SAVEPOINT erase_user');
  try {
    await client.query('DELETE FROM subscribers WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_organizations WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM guardian_users WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('RELEASE SAVEPOINT erase_user');
    return { erased: true, reason: null };
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT erase_user');
    return { erased: false, reason: 'referenced_by_unit_records' };
  }
}

/**
 * Count what still names the participant after the erasure.
 *
 * Incident reports keep their free text: a safety record is not the family's to
 * delete, and blanking it would destroy the account of what happened. But the
 * child's name may sit inside it, so the number is surfaced rather than buried.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {number} organizationId - Organization ID
 * @param {string} firstName - Participant's first name
 * @param {string} lastName - Participant's last name
 * @returns {Promise<number>} Incident reports that may still name them
 */
async function countRemainingMentions(client, organizationId, firstName, lastName) {
  // The narrative lives in the linked form submission, and the name is also
  // copied onto the report itself. Both are searched; the answer is advisory,
  // so a common first name matching another report is an acceptable false
  // positive — an admin looking at one report too many beats a name left behind.
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM incident_reports ir
       LEFT JOIN form_submissions fs ON fs.id = ir.form_submission_id
      WHERE ir.organization_id = $1
        AND (COALESCE(ir.victim_name, '') ILIKE '%' || $2 || '%'
          OR COALESCE(ir.victim_name, '') ILIKE '%' || $3 || '%'
          OR COALESCE(fs.submission_data::text, '') ILIKE '%' || $2 || '%'
          OR COALESCE(fs.submission_data::text, '') ILIKE '%' || $3 || '%')`,
    [organizationId, firstName, lastName]
  );
  return result.rows[0].count;
}

/**
 * Erase a participant and the family members left with nothing else here.
 *
 * Runs as a single transaction: an erasure that half happened would be worse
 * than one that did not, because nobody could tell which half.
 *
 * @param {Object} client - Database client inside an open transaction
 * @param {Object} options - Options
 * @param {number} options.organizationId - Organization the request came through
 * @param {Object} options.participant - Participant row ({ id, first_name, last_name })
 * @param {string} options.performedBy - UUID of the administrator carrying it out
 * @returns {Promise<Object>} What was removed and what was kept, or
 *   `{ blocked: 'shared_with_other_organizations', organizations }` when another
 *   unit's records are at stake
 */
async function eraseParticipant(client, { organizationId, participant, performedBy }) {
  const participantId = participant.id;

  // Exclusive ownership first, before anything is deleted. A child who moved
  // between sister units belongs to both files, and the request has to be
  // honoured by each of them in turn — the alternative is one unit silently
  // destroying another's attendance, forms and honours through the cascade.
  await client.query('SELECT id FROM participants WHERE id = $1 FOR UPDATE', [participantId]);
  const owningOrganizations = await findOwningOrganizations(client, participantId);
  const ownerIds = owningOrganizations.map(owner => owner.id);
  if (!ownerIds.includes(organizationId)) {
    return { blocked: 'not_an_owner', organizations: owningOrganizations };
  }

  if (owningOrganizations.length > 1) {
    await client.query(
      `INSERT INTO participant_erasure_approvals
              (participant_id, organization_id, approved_by, approved_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (participant_id, organization_id)
       DO UPDATE SET approved_by = EXCLUDED.approved_by, approved_at = now()`,
      [participantId, organizationId, performedBy]
    );
    const approvals = await client.query(
      `SELECT organization_id
         FROM participant_erasure_approvals
        WHERE participant_id = $1
          AND organization_id = ANY($2::int[])`,
      [participantId, ownerIds]
    );
    const approvedIds = new Set(approvals.rows.map(row => row.organization_id));
    const pending = owningOrganizations.filter(owner => !approvedIds.has(owner.id));
    if (pending.length > 0) {
      return { blocked: 'awaiting_organization_approvals', organizations: pending };
    }
  }

  const { guardianIds, userIds } = await findLinkedFamily(client, participantId);
  const financials = await eraseFinancials(client, participantId);

  const rowsDeleted = { ...financials };
  // Sequential on purpose throughout: these share one client, and the savepoints
  // below cannot be interleaved.
  /* eslint-disable no-await-in-loop */
  for (const table of UNLINKED_PARTICIPANT_TABLES) {
    // Table names are literals from a constant in this file, never user input.
    const deleted = await client.query(
      `DELETE FROM ${table} WHERE participant_id = $1`,
      [participantId]
    );
    rowsDeleted[table] = deleted.rowCount;
  }

  const participantDelete = await client.query(
    'DELETE FROM participants WHERE id = $1',
    [participantId]
  );
  rowsDeleted.participants = participantDelete.rowCount;

  let guardiansErased = 0;
  for (const guardianId of guardianIds) {
    if (await eraseGuardianIfOrphaned(client, guardianId)) {
      guardiansErased += 1;
    }
  }

  let usersErased = 0;
  const usersRetained = [];
  for (const userId of userIds) {
    const outcome = await eraseUserIfOrphaned(client, userId);
    if (outcome.erased) {
      usersErased += 1;
    } else {
      usersRetained.push(outcome.reason);
    }
  }

  /* eslint-enable no-await-in-loop */

  const remainingMentions = await countRemainingMentions(
    client, organizationId, participant.first_name, participant.last_name
  );

  await client.query(
    `INSERT INTO erasure_log
            (organization_id, performed_by, participants_erased, guardians_erased,
             users_erased, users_retained, rows_deleted)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      organizationId, performedBy, rowsDeleted.participants, guardiansErased,
      usersErased, usersRetained.length, JSON.stringify(rowsDeleted)
    ]
  );

  return {
    participants_erased: rowsDeleted.participants,
    guardians_erased: guardiansErased,
    users_erased: usersErased,
    users_retained: usersRetained,
    rows_deleted: rowsDeleted,
    incident_reports_still_mentioning: remainingMentions
  };
}

module.exports = {
  PARENT_ONLY_ROLES,
  findOwningOrganizations,
  UNLINKED_PARTICIPANT_TABLES,
  findOtherOrganizations,
  eraseParticipant
};
