'use strict';

/**
 * Family link endpoints for signed-in parents: asking another parent to share a
 * family, managing those requests, and ending a link.
 *
 * Accepting and declining are not here. They happen from the emailed link, on
 * public endpoints, because the only proof that the reader controls the address
 * is that they read the mail — and an account's address was never proven when
 * the account was made by public registration.
 *
 * Gated on `participants.create_own`: sharing a family is part of managing
 * one's own children, and a role that cannot do that has no family to share.
 *
 * @module routes/familyLinks
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { param } = require('express-validator');

const {
  authenticate,
  requirePermission,
  blockDemoRoles,
  getOrganizationId,
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateEmail, checkValidation, normalizeEmailValue } = require('../middleware/validation');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');
const {
  createFamilyLinkRequest,
  resendFamilyLinkRequest,
  withdrawFamilyLinkRequest,
  deliverFamilyLinkRequest,
  listFamilyLinks,
  endFamilyLink,
} = require('../services/familyLinks');

/** Human-readable reasons for the refusals a parent can fix. */
const REFUSAL_MESSAGES = {
  self: 'You cannot link with your own address',
  no_children: 'Register a child in this unit before sharing your family',
  already_linked: 'You already share a family with this person in this unit',
  already_requested: 'A request to this address is already waiting for an answer',
};

/** Requests one parent may send in an hour. */
const FAMILY_LINK_REQUESTS_PER_HOUR = 10;

/**
 * These requests put mail in a stranger's inbox under the unit's name, so each
 * parent may send only a handful an hour.
 *
 * Keyed on the account, not the address it connects from: parents sending from
 * the same school or office network are different people, and one of them
 * sending ten requests must not silence the others. The routes it guards are
 * authenticated, so the account is always known here.
 *
 * @returns {Function} Rate-limiting middleware
 */
function createFamilyLinkRequestLimiter() {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: FAMILY_LINK_REQUESTS_PER_HOUR,
    keyGenerator: (req) => `family-link:${req.user.id}`,
    message: { success: false, message: 'too_many_family_link_requests' },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * Remove the one column a client never needs.
 *
 * @param {Object} request - Row from `family_link_requests`
 * @returns {Object} Client-safe request
 */
function serializeRequest(request) {
  const { token_digest: _tokenDigest, ...rest } = request;
  return rest;
}

module.exports = (pool, logger) => {
  const router = express.Router();
  const familyLinkRequestLimiter = createFamilyLinkRequestLimiter();

  /**
   * This parent's active links, and the requests they have sent.
   */
  router.get('/family-links',
    authenticate,
    requirePermission('participants.create_own'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await listFamilyLinks(pool, req.user.id, organizationId));
    })
  );

  /**
   * Ask another parent to share this family.
   */
  router.post('/family-link-requests',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.create_own'),
    familyLinkRequestLimiter,
    validateEmail,
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const created = await createFamilyLinkRequest(pool, {
        requesterId: req.user.id,
        organizationId,
        targetEmail: normalizeEmailValue(req.body.email),
      });

      if (!created.ok) {
        const status = created.reason === 'self' || created.reason === 'no_children' ? 400 : 409;
        return res.status(status).json({
          success: false,
          code: created.reason,
          message: REFUSAL_MESSAGES[created.reason],
          timestamp: new Date().toISOString(),
        });
      }

      const baseUrl = await resolveOrganizationBaseUrl(pool, organizationId);
      const emailSent = await deliverFamilyLinkRequest(pool, {
        request: created.request,
        token: created.token,
        baseUrl,
        logger,
      });

      return success(
        res,
        { ...serializeRequest(created.request), email_sent: emailSent },
        emailSent ? 'Request sent' : 'Request created, but the email could not be sent',
        201
      );
    })
  );

  /**
   * Send a fresh link for a request still waiting; the previous link stops working.
   */
  router.post('/family-link-requests/:id/resend',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.create_own'),
    familyLinkRequestLimiter,
    param('id').isUUID(),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const resent = await resendFamilyLinkRequest(pool, {
        requesterId: req.user.id,
        organizationId,
        requestId: req.params.id,
      });

      if (!resent.ok) {
        return error(res, 'Request not found', 404);
      }

      const baseUrl = await resolveOrganizationBaseUrl(pool, organizationId);
      const emailSent = await deliverFamilyLinkRequest(pool, {
        request: resent.request,
        token: resent.token,
        baseUrl,
        logger,
      });

      return success(res, { ...serializeRequest(resent.request), email_sent: emailSent });
    })
  );

  /**
   * Withdraw a request before it is answered.
   */
  router.post('/family-link-requests/:id/revoke',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.create_own'),
    param('id').isUUID(),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const withdrawn = await withdrawFamilyLinkRequest(pool, {
        requesterId: req.user.id,
        organizationId,
        requestId: req.params.id,
      });

      if (!withdrawn) {
        return error(res, 'Request not found', 404);
      }
      return success(res, null, 'Request withdrawn');
    })
  );

  /**
   * End a family link. Either parent may.
   */
  router.delete('/family-links/:id',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.create_own'),
    param('id').isInt({ min: 1 }),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const ended = await endFamilyLink(pool, {
        userId: req.user.id,
        organizationId,
        linkId: parseInt(req.params.id, 10),
      });

      if (!ended.ok) {
        return error(res, 'Family link not found', 404);
      }
      return success(res, { revoked_grants: ended.revoked }, 'Family link ended');
    })
  );

  return router;
};
