/**
 * ParticipantRoleUtils
 *
 * Utilities for normalizing participant leader role flags to align with
 * the current database schema.
 *
 * Port of spa/utils/ParticipantRoleUtils.js
 */

/**
 * Normalize participant leader role flags to align with the current database schema.
 * Ensures both legacy (is_leader) and new (first_leader) field names are present
 * so downstream consumers can safely read consistent values.
 *
 * @param {Object} participant - Participant object with potential leader flags.
 * @returns {Object} Participant object augmented with normalized leader flags.
 */
export function normalizeParticipantRoles(participant) {
  if (!participant || typeof participant !== 'object') {
    return participant;
  }

  const firstLeader = Boolean(
    participant.first_leader ?? participant.is_leader ?? false
  );
  const secondLeader = Boolean(
    participant.second_leader ?? participant.is_second_leader ?? false
  );

  return {
    ...participant,
    first_leader: firstLeader,
    second_leader: secondLeader,
    is_leader: firstLeader,
    is_second_leader: secondLeader
  };
}

/**
 * Normalize leader role flags for an array of participants.
 *
 * @param {Array} participants - List of participants to normalize.
 * @returns {Array} New array with normalized participant objects.
 */
export function normalizeParticipantList(participants = []) {
  if (!Array.isArray(participants)) {
    return [];
  }

  return participants.map(normalizeParticipantRoles);
}

export default {
  normalizeParticipantRoles,
  normalizeParticipantList,
};
