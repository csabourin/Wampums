'use strict';

/**
 * Administrator-facing invitation endpoints.
 *
 * An admin here is doing one thing: handing a family the means to register
 * themselves. Everything the unit knows about that family before they arrive is
 * a convenience — a name to check the spelling of, a phone number to correct —
 * and none of it is authority. The authority is the link, and the link is the
 * only thing these routes actually produce.
 *
 * Scoped to the admin's own unit throughout. The organization comes from the
 * token by way of `getOrganizationId`, never from the request body, so an admin
 * of one unit cannot invite into another by editing a field.
 *
 * @module routes/parentInvitations
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');

const {
  authenticate,
  requirePermission,
  blockDemoRoles,
  getOrganizationId,
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const {
  validateEmail,
  checkValidation,
  normalizeEmailValue,
} = require('../middleware/validation');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');
const {
  listInvitations,
  createInvitation,
  resendInvitation,
  revokeInvitation,
  deliverInvitation,
} = require('../services/parentInvitations');

/** Languages the email bundles cover. Anything else falls back to the unit's own. */
const SUPPORTED_EMAIL_LANGUAGES = ['en', 'fr', 'uk', 'it', 'id'];

/** Longest a name or contact field may be, matching the column widths. */
const MAX_NAME_LENGTH = 255;

/** Longest a phone number may be, matching the column width. */
const MAX_PHONE_LENGTH = 20;

/**
 * Sending mail costs money and lands in someone else's inbox, so the write
 * endpoints are capped per admin session even though the caller is trusted. A
 * mis-wired client retrying in a loop should not be able to mail a family
 * forty times.
 */
const invitationWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { success: false, message: 'too_many_invitation_requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Pick the language the invitation will be written in.
 *
 * There is no user row to read a preference from — that is the whole point of
 * an invitation — so the admin's own interface language is used when the client
 * sends it, and the unit's default when it does not.
 *
 * @param {*} requested - `language` from the request body
 * @param {string} organizationDefault - The unit's `default_language`
 * @returns {string} A language code with a translation bundle behind it
 */
function resolveInvitationLanguage(requested, organizationDefault) {
  const normalized = typeof requested === 'string' ? requested.slice(0, 2).toLowerCase() : null;
  if (normalized && SUPPORTED_EMAIL_LANGUAGES.includes(normalized)) {
    return normalized;
  }
  return organizationDefault || 'fr';
}

/**
 * Trim a value to null when it carries nothing.
 *
 * An admin who tabs past the optional fields should leave nulls behind, not a
 * row full of empty strings that the completion page would render as answered.
 *
 * @param {*} value - Raw body value
 * @returns {string|null} Trimmed text, or null
 */
function optionalText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

module.exports = (pool, logger) => {
  const router = express.Router();

  const validateOptionalFields = [
    body('first_name').optional({ nullable: true }).isString().trim().isLength({ max: MAX_NAME_LENGTH }),
    body('last_name').optional({ nullable: true }).isString().trim().isLength({ max: MAX_NAME_LENGTH }),
    body('telephone_residence').optional({ nullable: true }).isString().trim().isLength({ max: MAX_PHONE_LENGTH }),
    body('telephone_cellulaire').optional({ nullable: true }).isString().trim().isLength({ max: MAX_PHONE_LENGTH }),
    body('support_contact_name').optional({ nullable: true }).isString().trim().isLength({ max: MAX_NAME_LENGTH }),
    body('support_contact_email').optional({ nullable: true }).isEmail().isLength({ max: MAX_NAME_LENGTH }),
  ];

  /**
   * Every invitation this unit has issued, with its current state.
   */
  router.get('/',
    authenticate,
    requirePermission('users.invite'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const invitations = await listInvitations(pool, organizationId);

      return success(res, invitations);
    })
  );

  /**
   * Invite a parent.
   *
   * The response separates two outcomes that look alike and are not: the
   * invitation exists either way, but `email_sent: false` means the family has
   * not heard anything and the admin should resend rather than wait. Returning
   * an error instead would suggest nothing was created, and the next attempt
   * would collide with the invitation this one left behind.
   */
  router.post('/',
    authenticate,
    blockDemoRoles,
    requirePermission('users.invite'),
    invitationWriteLimiter,
    validateEmail,
    ...validateOptionalFields,
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const organization = await pool.query(
        'SELECT default_language FROM organizations WHERE id = $1',
        [organizationId]
      );

      const created = await createInvitation(pool, {
        organizationId,
        email: normalizeEmailValue(req.body.email),
        firstName: optionalText(req.body.first_name),
        lastName: optionalText(req.body.last_name),
        telephoneResidence: optionalText(req.body.telephone_residence),
        telephoneCellulaire: optionalText(req.body.telephone_cellulaire),
        supportContactName: optionalText(req.body.support_contact_name),
        supportContactEmail: optionalText(req.body.support_contact_email),
        language: resolveInvitationLanguage(
          req.body.language,
          organization.rows[0]?.default_language
        ),
        invitedBy: req.user.id,
      });

      if (!created.ok) {
        return error(
          res,
          created.reason === 'already_member'
            ? 'This address already belongs to an active member of this unit'
            : 'This address already has a pending invitation',
          409
        );
      }

      const baseUrl = await resolveOrganizationBaseUrl(pool, organizationId);
      const emailSent = await deliverInvitation(pool, {
        invitation: created.invitation,
        token: created.token,
        baseUrl,
        logger,
      });

      return success(
        res,
        { ...serializeInvitation(created.invitation), email_sent: emailSent },
        emailSent ? 'Invitation sent' : 'Invitation created, but the email could not be sent',
        201
      );
    })
  );

  /**
   * Send a fresh link, invalidating the previous one.
   */
  router.post('/:id/resend',
    authenticate,
    blockDemoRoles,
    requirePermission('users.invite'),
    invitationWriteLimiter,
    param('id').isUUID(),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const resent = await resendInvitation(pool, {
        organizationId,
        invitationId: req.params.id,
      });

      if (!resent.ok) {
        return error(res, 'Invitation not found', 404);
      }

      const baseUrl = await resolveOrganizationBaseUrl(pool, organizationId);
      const emailSent = await deliverInvitation(pool, {
        invitation: resent.invitation,
        token: resent.token,
        baseUrl,
        logger,
      });

      return success(
        res,
        { ...serializeInvitation(resent.invitation), email_sent: emailSent },
        emailSent ? 'Invitation sent' : 'The email could not be sent'
      );
    })
  );

  /**
   * Withdraw an invitation, killing its link.
   */
  router.post('/:id/revoke',
    authenticate,
    blockDemoRoles,
    requirePermission('users.invite'),
    param('id').isUUID(),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const revoked = await revokeInvitation(pool, {
        organizationId,
        invitationId: req.params.id,
        revokedBy: req.user.id,
      });

      if (!revoked.ok) {
        return error(res, 'Invitation not found', 404);
      }

      return success(res, serializeInvitation(revoked.invitation), 'Invitation revoked');
    })
  );

  return router;
};

/**
 * Strip an invitation row down to what a client may see.
 *
 * `token_digest` is the reason this exists. It is not secret in the way the
 * token is, but it is the one column whose disclosure buys an attacker
 * something, and nothing in the admin screen needs it.
 *
 * @param {Object} invitation - Row from `parent_invitations`
 * @returns {Object} Client-safe invitation
 */
function serializeInvitation(invitation) {
  const { token_digest: _tokenDigest, ...rest } = invitation;
  return rest;
}
