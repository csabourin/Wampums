'use strict';

const { ensureActiveScoutYear } = require('./scoutYear');
const { isCalendarDate } = require('../utils/calendar-date');
const { CHILD_CREATION_LOCK_NAMESPACE, normalizeName, tidyName, validateChild, getFamilyMembers } = require('./parentOnboarding');

/**
 * Correct or withdraw a child through a narrowly scoped family workflow.
 * Walk-in staff may act only before an account gains access; parents may
 * correct a child they can see, but withdrawal requires an independent grant.
 * Withdrawal closes this year's enrollment and cancels outstanding invitations
 * for the child. Historical records and independent account access are retained.
 * @param {Object} pool - Database pool
 * @param {Object} params - Unit, participant, acting user, scope and optional details
 * @returns {Promise<Object>} Result and the updated record when authorized
 */
async function manageFamilyChild(pool, { organizationId, participantId, userId, walkIn = false, child = null, inscriptionDate = null }) {
  if (inscriptionDate !== null && !isCalendarDate(inscriptionDate)) {return { result: 'invalid', error: 'registration_date_invalid' };}
  if (child) {
    const problem = validateChild(child);
    if (problem) {return { result: 'invalid', error: problem };}
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (child) {
      await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))',
        [CHILD_CREATION_LOCK_NAMESPACE, `${normalizeName(child.firstName)}|${normalizeName(child.lastName)}`]);
    }
    // Lock invitations before checking access: acceptance must finish first,
    // or wait until withdrawal/correction has committed.
    await client.query(
      `SELECT pi.id FROM parent_invitations pi
        WHERE pi.organization_id = $1 AND pi.status = 'pending'
          AND EXISTS (SELECT 1 FROM parent_invitation_participants pip
                       WHERE pip.invitation_id = pi.id AND pip.participant_id = $2)
        ORDER BY pi.id FOR UPDATE`,
      [organizationId, participantId]
    );
    const scoped = await client.query(
      `SELECT p.id FROM participants p
        WHERE p.id = $1
          AND EXISTS (SELECT 1 FROM participant_enrollments pe
                       WHERE pe.participant_id = p.id AND pe.organization_id = $2)
          AND (($4::boolean AND NOT EXISTS (
                 SELECT 1 FROM user_participants up WHERE up.participant_id = p.id))
               OR (NOT $4::boolean AND EXISTS (
                 SELECT 1 FROM participant_access_grants g
                  WHERE g.participant_id = p.id AND g.user_id = $3
                    AND g.revoked_at IS NULL AND (g.source_type <> 'family_link' OR $5::boolean))))
        FOR NO KEY UPDATE`,
      [participantId, organizationId, userId, walkIn, Boolean(child)]
    );
    if (!scoped.rows.length) {
      await client.query('ROLLBACK');
      return { result: 'not_found' };
    }
    if (child) {
      const family = walkIn ? [] : await getFamilyMembers(client, userId, organizationId);
      const duplicate = await client.query(
        `SELECT p.id FROM participants p
          WHERE p.id <> $1 AND p.date_naissance = $2
            AND lower(regexp_replace(btrim(p.first_name), '\\s+', ' ', 'g')) = $3
            AND lower(regexp_replace(btrim(p.last_name), '\\s+', ' ', 'g')) = $4
            AND EXISTS (SELECT 1 FROM participant_enrollments pe
                         WHERE pe.participant_id = p.id AND pe.organization_id = $5)
            AND ($6::boolean OR EXISTS (SELECT 1 FROM user_participants up
                                         WHERE up.participant_id = p.id AND up.user_id = ANY($7::uuid[])))
          LIMIT 1`,
        [participantId, child.dateOfBirth, normalizeName(child.firstName), normalizeName(child.lastName), organizationId, walkIn, family.map((member) => member.userId)]
      );
      if (duplicate.rows.length) {
        await client.query('ROLLBACK');
        return { result: 'duplicate_child' };
      }
      const updated = await client.query(
        `UPDATE participants SET first_name = $1, last_name = $2, date_naissance = $3
          WHERE id = $4 RETURNING id, first_name, last_name, date_naissance::text`,
        [tidyName(child.firstName), tidyName(child.lastName), child.dateOfBirth, participantId]
      );
      if (inscriptionDate !== null) {
        await client.query(
          `UPDATE participant_enrollments pe SET inscription_date = $1
            WHERE pe.participant_id = $2 AND pe.organization_id = $3
              AND EXISTS (SELECT 1 FROM scout_years sy WHERE sy.id = pe.scout_year_id AND sy.status = 'active')`,
          [inscriptionDate, participantId, organizationId]
        );
      }
      await client.query('COMMIT');
      return { result: 'updated', child: updated.rows[0] };
    }
    const year = await ensureActiveScoutYear(client, organizationId);
    const removed = await client.query(
      `UPDATE participant_enrollments SET status = 'left', ended_on = CURRENT_DATE
        WHERE participant_id = $1 AND organization_id = $2 AND scout_year_id = $3 AND status = 'active'
        RETURNING participant_id`,
      [participantId, organizationId, year.id]
    );
    if (!removed.rows.length) {
      await client.query('ROLLBACK');
      return { result: 'not_found' };
    }
    await detachChildInvitations(client, { organizationId, participantId, userId });
    await client.query('COMMIT');
    return { result: 'withdrawn', participant_id: participantId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Cancel this child's outstanding invitation links, retaining siblings' invitations. */
async function detachChildInvitations(client, { organizationId, participantId, userId }) {
  const detached = await client.query(
    `DELETE FROM parent_invitation_participants pip USING parent_invitations pi
      WHERE pi.id = pip.invitation_id AND pi.organization_id = $1
        AND pi.status = 'pending' AND pip.participant_id = $2
      RETURNING pip.invitation_id`,
    [organizationId, participantId]
  );
  await client.query(
    `UPDATE parent_invitations SET status = 'revoked', revoked_by = $3, revoked_at = now(), updated_at = now()
      WHERE id = ANY($1::uuid[]) AND organization_id = $2 AND status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM parent_invitation_participants pip WHERE pip.invitation_id = parent_invitations.id)`,
    [detached.rows.map((row) => row.invitation_id), organizationId, userId]
  );
}

module.exports = { manageFamilyChild };
