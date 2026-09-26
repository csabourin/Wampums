'use strict';

/**
 * Walk-in children: enter a child who arrived without a registered family, and
 * invite their parent.
 *
 * Gated on `participants.walk_in`, held by leaders and administrators. Not on
 * `participants.create`, which parents hold too -- the registration form needs
 * it -- and which would let any parent enter children and mail invitations.
 *
 * One thing stays with administrators: reinstating someone an administrator
 * removed by hand. That takes `users.invite`; a leader who meets it is told so.
 *
 * @module routes/walkInChildren
 */

const express = require('express');
const { body, param } = require('express-validator');

const {
  authenticate,
  requirePermission,
  blockDemoRoles,
  getOrganizationId,
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { checkValidation, normalizeEmailValue } = require('../middleware/validation');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');
const { deliverInvitation, resolveInvitationLanguage } = require('../services/parentInvitations');
const {
  listChildrenWithoutParent,
  createWalkInChild,
  inviteParentForChild,
  resendWalkInInvitation,
} = require('../services/walkInChildren');

/** Longest an explanation for reinstating someone may be. */
const MAX_OVERRIDE_REASON_LENGTH = 1000;

/**
 * Read a boolean that may arrive as JSON `true` or as a form string.
 *
 * @param {*} value - Raw body value
 * @returns {boolean} True only for an explicit yes
 */
function isConfirmed(value) {
  return value === true || value === 'true';
}

/**
 * A JSON refusal carrying a machine-readable code, in the response format.
 *
 * @param {Object} res - Express response
 * @param {number} status - HTTP status
 * @param {string} code - Why
 * @param {string} message - Prose for logs and old clients
 * @param {Object} [data] - Details the screen needs
 * @returns {Object} Express response
 */
function refuse(res, status, code, message, data = null) {
  return res.status(status).json({
    success: false,
    code,
    message,
    ...(data ? { data } : {}),
    timestamp: new Date().toISOString(),
  });
}

module.exports = (pool, logger) => {
  const router = express.Router();

  const parentFields = [
    body('parent_email').isEmail().isLength({ max: 255 }),
    body('confirm_reactivation').optional({ nullable: true }).isBoolean(),
    body('reactivation_reason')
      .if(body('confirm_reactivation').custom(isConfirmed))
      .isString()
      .trim()
      .isLength({ min: 1, max: MAX_OVERRIDE_REASON_LENGTH }),
  ];

  /**
   * The language the invitation is written in, and the override reason when
   * the caller is allowed to give one.
   *
   * @param {Object} req - Express request
   * @param {number} organizationId - Unit
   * @returns {Promise<Object>} `{ language, deactivationOverrideReason, canOverride }`
   */
  async function parentContext(req, organizationId) {
    const organization = await pool.query('SELECT default_language FROM organizations WHERE id = $1', [organizationId]);
    // requirePermission put the caller's permissions on the request.
    const canOverride = (req.userPermissions || []).includes('users.invite');
    return {
      language: resolveInvitationLanguage(req.body.language, organization.rows[0]?.default_language),
      deactivationOverrideReason: canOverride && isConfirmed(req.body.confirm_reactivation)
        ? String(req.body.reactivation_reason).trim()
        : null,
      canOverride,
    };
  }

  /**
   * Mail the link if one was minted, after the transaction committed.
   *
   * @param {Object} outcome - From the service
   * @param {number} organizationId - Unit
   * @returns {Promise<boolean|null>} Whether it was sent; null when nothing needed sending
   */
  async function mailIfNeeded(outcome, organizationId) {
    if (!outcome.token || !outcome.invitation) {
      return null;
    }
    const baseUrl = await resolveOrganizationBaseUrl(pool, organizationId);
    return deliverInvitation(pool, { invitation: outcome.invitation, token: outcome.token, baseUrl, logger });
  }

  /**
   * Answer a hand-deactivated parent the same way from both write routes.
   *
   * @param {Object} res - Express response
   * @param {Object} outcome - Service outcome with `blocked`
   * @param {boolean} canOverride - Whether this caller may reinstate
   * @returns {Object} Express response
   */
  function refuseBlocked(res, outcome, canOverride) {
    return refuse(res, 409, 'manually_deactivated',
      'This address belongs to a member an administrator removed by hand',
      { ...outcome.blocked, can_override: canOverride });
  }

  /**
   * This year's children whom no account can see, with the invitation each is
   * waiting on.
   */
  router.get('/',
    authenticate,
    requirePermission('participants.walk_in'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await listChildrenWithoutParent(pool, organizationId));
    })
  );

  /**
   * Enter a walk-in child and invite their parent.
   */
  router.post('/',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.walk_in'),
    body('first_name').isString().trim().notEmpty(),
    body('last_name').isString().trim().notEmpty(),
    body('date_naissance').isISO8601({ strict: true }),
    ...parentFields,
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const context = await parentContext(req, organizationId);

      const outcome = await createWalkInChild(pool, {
        organizationId,
        adminId: req.user.id,
        firstName: req.body.first_name,
        lastName: req.body.last_name,
        dateOfBirth: String(req.body.date_naissance).slice(0, 10),
        parentEmail: normalizeEmailValue(req.body.parent_email),
        language: context.language,
        deactivationOverrideReason: context.deactivationOverrideReason,
      });

      if (outcome.result === 'invalid') {
        return error(res, outcome.error, 400, [{ path: 'child', msg: outcome.error }]);
      }
      if (outcome.result === 'duplicate_child') {
        return refuse(res, 409, 'duplicate_child', 'This child is already in the unit', { existing: outcome.existing });
      }
      if (outcome.result === 'manually_deactivated') {
        return refuseBlocked(res, outcome, context.canOverride);
      }

      const emailSent = await mailIfNeeded(outcome, organizationId);
      logger?.info('Walk-in child entered', { organizationId, participantId: outcome.participant_id, parent: outcome.parent });

      return success(res, {
        participant_id: outcome.participant_id,
        parent: outcome.parent,
        email_sent: emailSent,
      }, 'Child added', 201);
    })
  );

  /**
   * Invite a parent for a child already on the roster, or correct the address.
   */
  router.post('/:id/invite',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.walk_in'),
    param('id').isInt({ min: 1 }),
    ...parentFields,
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const context = await parentContext(req, organizationId);

      const outcome = await inviteParentForChild(pool, {
        organizationId,
        adminId: req.user.id,
        participantId: parseInt(req.params.id, 10),
        parentEmail: normalizeEmailValue(req.body.parent_email),
        language: context.language,
        deactivationOverrideReason: context.deactivationOverrideReason,
      });

      if (outcome.result === 'not_found') {
        return error(res, 'Participant not found', 404);
      }
      if (outcome.result === 'already_has_parent') {
        return refuse(res, 409, 'already_has_parent', 'This child is already linked to a parent account');
      }
      if (outcome.result === 'manually_deactivated') {
        return refuseBlocked(res, outcome, context.canOverride);
      }

      const emailSent = await mailIfNeeded(outcome, organizationId);
      return success(res, { parent: outcome.parent, email_sent: emailSent }, 'Parent invited');
    })
  );

  /**
   * Send a fresh link for an invitation that was sent for a child.
   */
  router.post('/invitations/:invitationId/resend',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.walk_in'),
    param('invitationId').isUUID(),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const resent = await resendWalkInInvitation(pool, { organizationId, invitationId: req.params.invitationId });

      if (!resent.ok) {
        return error(res, 'Invitation not found', 404);
      }
      const emailSent = await mailIfNeeded(resent, organizationId);
      return success(res, { email_sent: emailSent }, 'Invitation resent');
    })
  );

  return router;
};
