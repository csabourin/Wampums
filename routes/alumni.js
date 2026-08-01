/**
 * Alumni Routes
 *
 * The authenticated half of the alumni feature: seeing who may still be asked
 * to stay in touch, asking them, and seeing who said yes.
 *
 * The other half — the two links in the email — is deliberately unauthenticated
 * and lives in `routes/public.js`, because the person clicking them no longer
 * has an account to log into.
 *
 * @module routes/alumni
 */

const express = require('express');
const {
  authenticate,
  requirePermission,
  blockDemoRoles,
  getOrganizationId
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const {
  listInvitationCandidates,
  listAlumni,
  sendAlumniInvitations
} = require('../services/alumni');

module.exports = (pool, logger) => {
  const router = express.Router();

  /**
   * Resolve the origin the emailed links should point at.
   *
   * Taken from the request rather than configured, so a unit on its own domain
   * sends links to that domain instead of to the canonical one.
   *
   * @param {Object} req - Express request
   * @returns {string} Origin, scheme included
   */
  function resolveBaseUrl(req) {
    const host = req.get('host') || 'wampums.app';
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = forwardedProto
      ? forwardedProto.split(',')[0].trim()
      : (req.secure ? 'https' : 'http');
    return `${protocol}://${host}`;
  }

  /**
   * Departed families that may still be invited.
   */
  router.get('/candidates',
    authenticate,
    requirePermission('alumni.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const candidates = await listInvitationCandidates(pool, organizationId);
      return success(res, candidates);
    })
  );

  /**
   * Families who accepted.
   */
  router.get('/',
    authenticate,
    requirePermission('alumni.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const alumni = await listAlumni(pool, organizationId);
      return success(res, alumni);
    })
  );

  /**
   * Send the opt-in email.
   *
   * With no `membership_ids`, every eligible candidate is invited. A membership
   * already invited is never a candidate, so re-posting this cannot produce a
   * second email to the same person.
   */
  router.post('/invitations',
    authenticate,
    blockDemoRoles,
    requirePermission('alumni.manage'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { membership_ids: membershipIds } = req.body || {};

      if (membershipIds !== undefined && !Array.isArray(membershipIds)) {
        return error(res, 'membership_ids must be an array', 400);
      }

      const outcome = await sendAlumniInvitations(pool, logger, {
        organizationId,
        membershipIds,
        baseUrl: resolveBaseUrl(req)
      });

      return success(res, outcome, 'Alumni invitations processed');
    })
  );

  return router;
};
