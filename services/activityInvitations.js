'use strict';

/**
 * Who an activity is for.
 *
 * An activity invites the whole unit (`activities.invites_everyone`, the
 * default) or only the participants listed in `activity_invitees`. Only an
 * invited child appears in the activity's carpool lists, can be seated in one
 * of its cars, or receives one of its permission slips.
 *
 * When the invitation narrows, children who are no longer invited leave the
 * activity's cars and their unanswered slips are archived. A slip a guardian
 * already signed or declined stays: it is the record of their answer.
 *
 * @module services/activityInvitations
 */

const MAX_INVITEES = 1000;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d{0,9}$/;
const TRUE_VALUES = [true, 'true', 1, '1'];
const FALSE_VALUES = [false, 'false', 0, '0'];

/**
 * Read the invitation fields of an activity create or update body.
 *
 * `invites_everyone` (boolean) chooses between the whole unit and a list;
 * `invited_participant_ids` (array of participant ids) is the list. On an
 * update, a body carrying neither leaves the invitation unchanged.
 *
 * @param {Object} body - Request body
 * @param {Object} [options]
 * @param {boolean} [options.isCreate=false] - A new activity defaults to everyone
 * @returns {{provided: boolean, invitesEveryone?: boolean, participantIds?: number[], problem?: string}}
 */
function readInvitation(body = {}, { isCreate = false } = {}) {
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
  if (!has('invites_everyone') && !has('invited_participant_ids')) {
    return isCreate
      ? { provided: true, invitesEveryone: true, participantIds: [] }
      : { provided: false };
  }

  let invitesEveryone = false;
  if (has('invites_everyone')) {
    const flag = body.invites_everyone;
    if (TRUE_VALUES.includes(flag)) {
      invitesEveryone = true;
    } else if (!FALSE_VALUES.includes(flag)) {
      // Anything else would silently invite the whole unit
      return { provided: true, problem: 'invites_everyone must be true or false' };
    }
  }
  if (invitesEveryone) {
    return { provided: true, invitesEveryone: true, participantIds: [] };
  }

  const rawIds = body.invited_participant_ids;
  if (!Array.isArray(rawIds)) {
    return { provided: true, problem: 'invited_participant_ids must be a list of participant ids' };
  }
  if (rawIds.length > MAX_INVITEES) {
    return { provided: true, problem: `At most ${MAX_INVITEES} participants may be invited` };
  }
  if (rawIds.some((id) => !POSITIVE_INTEGER_PATTERN.test(String(id)))) {
    return { provided: true, problem: 'invited_participant_ids must contain participant ids' };
  }
  const participantIds = [...new Set(rawIds.map(Number))];
  if (participantIds.length === 0) {
    return { provided: true, problem: 'Invite at least one participant, or invite everyone' };
  }
  return { provided: true, invitesEveryone: false, participantIds };
}

/**
 * Record who an activity invites, inside the caller's transaction.
 *
 * Every listed participant must belong to the unit (or already be invited to
 * this activity: a child who left the active scout year keeps their
 * invitation when the list is saved again). Children who lose their
 * invitation leave the activity's cars, and their unanswered slips are archived.
 *
 * @param {Object} client - Database client inside a transaction
 * @param {Object} invitation
 * @param {number} invitation.activityId
 * @param {number} invitation.organizationId
 * @param {boolean} invitation.invitesEveryone
 * @param {number[]} invitation.participantIds
 * @returns {Promise<{unknownParticipantIds: number[], removedCarpoolAssignments: number, archivedPermissionSlips: number}>}
 *   `unknownParticipantIds` is non-empty when nothing was saved
 */
async function saveInvitation(client, { activityId, organizationId, invitesEveryone, participantIds }) {
  if (!invitesEveryone) {
    // A child already invited stays invitable after leaving the active
    // scout year; a newly invited child must be enrolled in the unit now.
    const known = await client.query(
      `SELECT participant_id
         FROM participant_organizations
        WHERE organization_id = $1 AND participant_id = ANY($2::int[])
       UNION
       SELECT participant_id
         FROM activity_invitees
        WHERE activity_id = $3 AND organization_id = $1 AND participant_id = ANY($2::int[])`,
      [organizationId, participantIds, activityId]
    );
    const knownIds = new Set(known.rows.map((row) => Number(row.participant_id)));
    const unknownParticipantIds = participantIds.filter((id) => !knownIds.has(id));
    if (unknownParticipantIds.length > 0) {
      return { unknownParticipantIds, removedCarpoolAssignments: 0, archivedPermissionSlips: 0 };
    }
  }

  await client.query(
    'UPDATE activities SET invites_everyone = $1 WHERE id = $2 AND organization_id = $3',
    [invitesEveryone, activityId, organizationId]
  );
  await client.query(
    'DELETE FROM activity_invitees WHERE activity_id = $1 AND organization_id = $2',
    [activityId, organizationId]
  );

  if (invitesEveryone) {
    return { unknownParticipantIds: [], removedCarpoolAssignments: 0, archivedPermissionSlips: 0 };
  }

  await client.query(
    `INSERT INTO activity_invitees (activity_id, participant_id, organization_id)
     SELECT $1, UNNEST($2::int[]), $3
     ON CONFLICT (activity_id, participant_id) DO NOTHING`,
    [activityId, participantIds, organizationId]
  );

  const removedAssignments = await client.query(
    `DELETE FROM carpool_assignments ca
      USING carpool_offers co
      WHERE ca.carpool_offer_id = co.id
        AND co.activity_id = $1
        AND co.organization_id = $2
        AND NOT (ca.participant_id = ANY($3::int[]))`,
    [activityId, organizationId, participantIds]
  );
  const archivedSlips = await client.query(
    `UPDATE permission_slips
        SET status = 'archived', updated_at = CURRENT_TIMESTAMP
      WHERE activity_id = $1
        AND organization_id = $2
        AND status = 'pending'
        AND NOT (participant_id = ANY($3::int[]))`,
    [activityId, organizationId, participantIds]
  );

  return {
    unknownParticipantIds: [],
    removedCarpoolAssignments: removedAssignments.rowCount || 0,
    archivedPermissionSlips: archivedSlips.rowCount || 0
  };
}

/**
 * The ids of an activity's invited participants, or null when it invites everyone.
 * @param {Object} db - Pool or client
 * @param {number} activityId
 * @param {number} organizationId
 * @returns {Promise<number[]|null>}
 */
async function getInvitedParticipantIds(db, activityId, organizationId) {
  const result = await db.query(
    `SELECT a.invites_everyone,
            COALESCE(
              (SELECT array_agg(ai.participant_id ORDER BY ai.participant_id)
                 FROM activity_invitees ai
                WHERE ai.activity_id = a.id AND ai.organization_id = a.organization_id),
              '{}'
            ) AS participant_ids
       FROM activities a
      WHERE a.id = $1 AND a.organization_id = $2`,
    [activityId, organizationId]
  );
  const row = result.rows[0];
  if (!row || row.invites_everyone !== false) {
    return null;
  }
  return (row.participant_ids || []).map(Number);
}

/**
 * Which of these participants an activity does not invite.
 * @param {Object} db - Pool or client
 * @param {number} activityId
 * @param {number} organizationId
 * @param {number[]} participantIds
 * @returns {Promise<number[]>} Ids not invited (empty when the activity invites everyone)
 */
async function findUninvitedParticipants(db, activityId, organizationId, participantIds) {
  const invited = await getInvitedParticipantIds(db, activityId, organizationId);
  if (invited === null) {
    return [];
  }
  const invitedSet = new Set(invited);
  return participantIds.map(Number).filter((id) => !invitedSet.has(id));
}

module.exports = {
  MAX_INVITEES,
  readInvitation,
  saveInvitation,
  getInvitedParticipantIds,
  findUninvitedParticipants
};
