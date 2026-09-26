'use strict';

/**
 * Duplicate candidates — children who may be recorded twice.
 *
 * Two participant records can describe one child: each parent registered them
 * before the two were linked, or the child was registered in one unit by one
 * parent and in another by the other. Same name, same birth date.
 *
 * Nothing here merges anything. A name and a birth date are strong evidence
 * and still not proof — and merging the wrong two children would put one
 * child's medical record, forms and history in another child's file. So a
 * matching pair is written down, and an administrator of the unit where it
 * surfaced, who knows the family, decides.
 *
 * Detection runs where a new pair can first become visible: when two parents
 * link, and when a parent registers a child. It deliberately reads children a
 * parent's partners hold in *other* units, which the parent is never shown —
 * that is exactly the case a parent cannot resolve and an administrator can.
 * Only administrators ever see these rows.
 *
 * @module services/duplicateCandidates
 */

/** Why a pair was flagged. Mirrors the check constraint. */
const DETECTED_VIA = {
  FAMILY_LINK: 'family_link',
  ONBOARDING: 'onboarding',
};

/** What an administrator decided. */
const DUPLICATE_DECISION = {
  SAME_PERSON: 'same_person',
  DIFFERENT: 'different',
};

/**
 * Flag every pair of same-looking children visible to a set of people, where
 * at least one of the two belongs to this unit.
 *
 * "Same-looking" is the rule the onboarding duplicate check uses: first and
 * last name equal once case and runs of whitespace are ignored, and the same
 * birth date. Children with no birth date are not compared — without it, two
 * cousins named after the same grandparent would be flagged forever.
 *
 * A pair already written for this unit, whatever its status, is left alone, so
 * a pair judged to be two different children does not come back.
 *
 * @param {Object} client - Client, normally inside the caller's transaction
 * @param {Object} params - Scope of the check
 * @param {number} params.organizationId - The unit whose administrators review
 * @param {Array<string>} params.userIds - People whose visible children to compare
 * @param {string} params.detectedVia - One of {@link DETECTED_VIA}
 * @returns {Promise<Array<number>>} Ids of newly flagged pairs
 */
async function flagDuplicatesAmong(client, { organizationId, userIds, detectedVia }) {
  const flagged = await client.query(
    `WITH visible AS (
       SELECT DISTINCT p.id,
              lower(regexp_replace(btrim(p.first_name), '\\s+', ' ', 'g')) AS first_key,
              lower(regexp_replace(btrim(p.last_name), '\\s+', ' ', 'g')) AS last_key,
              p.date_naissance
         FROM participants p
         JOIN user_participants up ON up.participant_id = p.id
        WHERE up.user_id = ANY($2::uuid[])
          AND p.date_naissance IS NOT NULL
     ),
     in_unit AS (
       SELECT DISTINCT participant_id FROM participant_enrollments WHERE organization_id = $1
     )
     INSERT INTO participant_duplicate_candidates
       (organization_id, participant_id_low, participant_id_high, detected_via)
     SELECT $1, a.id, b.id, $3
       FROM visible a
       JOIN visible b
         ON a.id < b.id
        AND a.first_key = b.first_key
        AND a.last_key = b.last_key
        AND a.date_naissance = b.date_naissance
      WHERE a.id IN (SELECT participant_id FROM in_unit)
         OR b.id IN (SELECT participant_id FROM in_unit)
     ON CONFLICT (organization_id, participant_id_low, participant_id_high) DO NOTHING
     RETURNING id`,
    [organizationId, userIds, detectedVia]
  );
  return flagged.rows.map((row) => row.id);
}

/**
 * The pairs an administrator of this unit should look at.
 *
 * Each side is described by what an administrator needs to tell two children
 * apart: name, birth date, the units that hold a record, and the accounts
 * linked to it — limited to accounts that are members of this unit. Who else
 * holds a record in another unit is that unit's business; that one of this
 * unit's own parents holds it is exactly what the administrator needs to see.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Unit
 * @param {Object} [options] - Options
 * @param {boolean} [options.includeResolved] - Also list decided pairs
 * @returns {Promise<Array<Object>>} Candidates, newest first
 */
async function listDuplicateCandidates(pool, organizationId, { includeResolved = false } = {}) {
  const result = await pool.query(
    `SELECT c.id,
            c.status,
            c.detected_via,
            c.detected_at,
            c.resolved_at,
            c.resolution_note,
            resolver.full_name AS resolved_by_name,
            (
              SELECT json_agg(side.description ORDER BY side.position)
                FROM (
                  SELECT pair.position,
                         json_build_object(
                           'id', p.id,
                           'first_name', p.first_name,
                           'last_name', p.last_name,
                           'date_naissance', p.date_naissance::text,
                           'in_this_unit', EXISTS (
                             SELECT 1 FROM participant_enrollments pe
                              WHERE pe.participant_id = p.id AND pe.organization_id = c.organization_id
                           ),
                           'units', (
                             SELECT COALESCE(json_agg(DISTINCT o.name), '[]'::json)
                               FROM participant_enrollments pe
                               JOIN organizations o ON o.id = pe.organization_id
                              WHERE pe.participant_id = p.id
                           ),
                           'accounts', (
                             SELECT COALESCE(json_agg(DISTINCT u.full_name), '[]'::json)
                               FROM user_participants up
                               JOIN users u ON u.id = up.user_id
                               JOIN user_organizations uo
                                 ON uo.user_id = u.id AND uo.organization_id = c.organization_id
                              WHERE up.participant_id = p.id
                           )
                         ) AS description
                    FROM unnest(ARRAY[c.participant_id_low, c.participant_id_high])
                         WITH ORDINALITY AS pair(participant_id, position)
                    JOIN participants p ON p.id = pair.participant_id
                ) side
            ) AS participants
       FROM participant_duplicate_candidates c
       LEFT JOIN users resolver ON resolver.id = c.resolved_by
      WHERE c.organization_id = $1
        AND ($2 OR c.status = 'pending')
      ORDER BY c.detected_at DESC`,
    [organizationId, includeResolved]
  );
  return result.rows;
}

/**
 * Record an administrator's decision about a pair.
 *
 * `same_person` is a decision, not a merge. It marks the pair so it stops
 * appearing as undecided and can be merged deliberately; combining two records
 * across every table that references a participant is its own operation.
 *
 * @param {Object} pool - Database pool
 * @param {Object} params - Which pair, what was decided, by whom
 * @returns {Promise<Object|null>} The updated candidate, or null when there is
 *   no pending pair with that id in this unit
 */
async function resolveDuplicateCandidate(pool, { organizationId, candidateId, decision, note = null, resolvedBy }) {
  if (!Object.values(DUPLICATE_DECISION).includes(decision)) {
    throw new Error(`Unknown duplicate decision: ${decision}`);
  }

  const result = await pool.query(
    `UPDATE participant_duplicate_candidates
        SET status = $1, resolution_note = $2, resolved_by = $3, resolved_at = now()
      WHERE id = $4 AND organization_id = $5 AND status = 'pending'
      RETURNING id, status, resolution_note, resolved_at`,
    [decision, note, resolvedBy, candidateId, organizationId]
  );
  return result.rows[0] || null;
}

module.exports = {
  DETECTED_VIA,
  DUPLICATE_DECISION,
  flagDuplicatesAmong,
  listDuplicateCandidates,
  resolveDuplicateCandidate,
};
