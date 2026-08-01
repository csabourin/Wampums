// api-transfers.js
// API client for moving a participant to a sister unit.
//
// The interface that calls this is meant to live in the district space (§8.5 of
// devdocs/GESTION_ANNEE_SCOUTE.md), which is not built yet. The client is here so
// the endpoints have a single caller when it is.
import { API } from './api-core.js';

/**
 * Units this organization may transfer to — the other members of its local group.
 *
 * @returns {Promise<Array<Object>>} Sibling organizations
 */
export async function getTransferDestinations() {
  const response = await API.getNoCache('v1/transfers/destinations');
  return response.data || [];
}

/**
 * Show what a transfer would do. Changes nothing.
 *
 * @param {number} participantId - Participant to move
 * @param {number} targetOrganizationId - Destination organization
 * @returns {Promise<Object>} Parents affected and forms left behind
 */
export async function previewTransfer(participantId, targetOrganizationId) {
  const response = await API.post('v1/transfers/preview', {
    participant_id: participantId,
    target_organization_id: targetOrganizationId
  });
  return response.data;
}

/**
 * Carry out the transfer.
 *
 * @param {number} participantId - Participant to move
 * @param {number} targetOrganizationId - Destination organization
 * @param {string} [note] - Reason, kept on the closed enrollment
 * @returns {Promise<Object>} Summary of what moved
 */
export async function transferParticipant(participantId, targetOrganizationId, note) {
  const response = await API.post('v1/transfers', {
    participant_id: participantId,
    target_organization_id: targetOrganizationId,
    note
  });
  return response.data;
}
