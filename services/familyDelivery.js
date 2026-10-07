'use strict';

const { resolveOrganizationBaseUrl } = require('../utils/public-url');
const { deliverInvitation } = require('./parentInvitations');
const { deliverFamilyLinkRequest } = require('./familyLinks');

/**
 * Delivery happens after a committed family write. An unexpected delivery or
 * configuration failure must not turn that successful write into a 500 and
 * encourage the caller to create the same record again.
 * @param {Object} pool - Database pool
 * @param {Object} inputs - Invitation/request, transient token and logger
 * @param {Function} deliver - Sender for this kind of record
 * @returns {Promise<boolean>} Whether delivery was confirmed
 */
async function deliverSavedFamilyEmail(pool, inputs, deliver) {
  const record = inputs.invitation || inputs.request;
  try {
    const baseUrl = await resolveOrganizationBaseUrl(pool, record.organization_id);
    return await deliver(pool, { ...inputs, baseUrl });
  } catch (_err) {
    inputs.logger?.error('Family change saved; email delivery could not be confirmed', {
      organizationId: record.organization_id, recordId: record.id,
    });
    return false;
  }
}

/** Safely deliver an invitation whose creation, update or resend already committed. */
function deliverParentInvitation(pool, inputs) {
  return deliverSavedFamilyEmail(pool, inputs, deliverInvitation);
}

/** Safely deliver a family-sharing request whose write already committed. */
function deliverFamilyRequest(pool, inputs) {
  return deliverSavedFamilyEmail(pool, inputs, deliverFamilyLinkRequest);
}

module.exports = { deliverParentInvitation, deliverFamilyRequest };
