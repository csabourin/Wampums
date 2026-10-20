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
const HTTP_STATUS = { OK: 200, CREATED: 201, BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INTERNAL_ERROR: 500 };
const { familyInvitationLimiter: invitationWriteLimiter } = require('../middleware/familyInvitationLimiter');
const { body, param, query } = require('express-validator');

const {
  authenticate,
  requirePermission,
  blockDemoRoles,
  getOrganizationId,
} = require('../middleware/auth');
const { success, error, forbidden, asyncHandler } = require('../middleware/response');
const { checkRolesGrantable, findRolesInUnit, normalizeRoleIds } = require('../services/roleAssignment');
const { findHiddenAmong, resolveUnitRoleId } = require('../services/roleVisibility');
const { ALL_INTERFACE_LANGUAGES } = require('../utils/interfaceLanguages');
const {
  validateEmail,
  checkValidation,
  normalizeEmailValue,
} = require('../middleware/validation');
const { deliverParentInvitation } = require('../services/familyDelivery');
const {
  INVITATION_KIND,
  listInvitations,
  createInvitation,
  updateInvitation,
  resendInvitation,
  revokeInvitation,
  resolveInvitationLanguage,
} = require('../services/parentInvitations');

/** Longest a name or contact field may be, matching the column widths. */
const MAX_NAME_LENGTH = 255;

/** Longest a phone number may be, matching the column width. */
const MAX_PHONE_LENGTH = 20;

/** Longest an admin's explanation for overriding a deactivation may be. */
const MAX_OVERRIDE_REASON_LENGTH = 1000;

/** Most roles one leader invitation may carry. */
const MAX_INVITATION_ROLES = 10;

/** A PostgreSQL integer id. */
const ROLE_ID_RANGE = { min: 1, max: 2147483647 };

/**
 * Whether the request names the roles the invited person will hold: a team
 * role, or a family role other than the unit's parent role. An invitation
 * naming none is a family invitation granting the unit's parent role.
 *
 * @param {Object} req - Request
 * @returns {boolean}
 */
function namesRoles(req) {
  return Array.isArray(req.body?.role_ids) && req.body.role_ids.length > 0;
}

/**
 * Naming the roles is also granting them, so it takes the permission to
 * assign roles as well as the one to invite.
 *
 * @param {Object} req - Request
 * @returns {string[]} Permission keys required
 */
function invitationPermissions(req) {
  return namesRoles(req) ? ['users.invite', 'users.assign_roles'] : ['users.invite'];
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
  if (typeof value !== 'string') {return null;}
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read a boolean that may arrive as JSON `true` or as a form string.
 *
 * @param {*} value - Raw body value
 * @returns {boolean} True only for an explicit yes
 */
function isConfirmed(value) {
  return value === true || value === 'true';
}

module.exports = (pool, logger) => {
  const router = express.Router();

  const validateOptionalFields = [
    body('language').optional({ nullable: true }).isIn(ALL_INTERFACE_LANGUAGES),
    body('first_name').optional({ nullable: true }).isString().trim().isLength({ max: MAX_NAME_LENGTH }),
    body('last_name').optional({ nullable: true }).isString().trim().isLength({ max: MAX_NAME_LENGTH }),
    body('telephone_residence').optional({ nullable: true }).isString().trim().isLength({ max: MAX_PHONE_LENGTH }),
    body('telephone_cellulaire').optional({ nullable: true }).isString().trim().isLength({ max: MAX_PHONE_LENGTH }),
    body('support_contact_name').optional({ nullable: true }).isString().trim().isLength({ max: MAX_NAME_LENGTH }),
    body('support_contact_email').optional({ values: 'falsy' }).isEmail().isLength({ max: MAX_NAME_LENGTH }),
    body('confirm_reactivation').optional({ nullable: true }).isBoolean(),
    body('role_ids').optional({ nullable: true }).isArray({ max: MAX_INVITATION_ROLES }),
    body('role_ids.*').isInt(ROLE_ID_RANGE),
    // Confirming without saying why is not confirming. The reason is required
    // exactly when the confirmation is given, and kept on the invitation.
    body('reactivation_reason')
      .if(body('confirm_reactivation').custom((value) => value === true || value === 'true'))
      .isString()
      .trim()
      .isLength({ min: 1, max: MAX_OVERRIDE_REASON_LENGTH })
      .withMessage('A reason is required to reinstate a member who was deactivated by hand'),
  ];

  /**
   * Every invitation this unit has issued, with its current state.
   */
  router.get('/',
    authenticate,
    requirePermission('users.invite'),
    query('kind').optional().isIn(Object.values(INVITATION_KIND)),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const invitations = await listInvitations(pool, organizationId, {
        kind: req.query.kind || INVITATION_KIND.FAMILY,
      });

      return success(res, invitations);
    })
  );

  /**
   * The roles someone may be invited into: every role the unit offers (not
   * the built-in roles it replaced and hid, nor the demo roles), family roles
   * (data scope 'linked') and team roles alike.
   *
   * `default_family` marks the unit's parent role, which a family invitation
   * grants without naming it and so needs only users.invite. Every other role
   * is `assignable` when the caller holds users.assign_roles and each of its
   * permissions (services/roleAssignment.js, with the same self-scoped
   * exception for family roles).
   */
  router.get('/roles',
    authenticate,
    requirePermission('users.invite'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const held = req.userPermissions || [];
      const [result, parentRoleId] = await Promise.all([
        pool.query(
          `SELECT r.id, r.role_name, r.display_name, r.description, r.data_scope,
                  NOT EXISTS (
                    SELECT 1
                      FROM role_permissions rp
                      JOIN permissions p ON p.id = rp.permission_id
                     WHERE rp.role_id = r.id
                       AND NOT (p.permission_key = ANY($2::text[]))
                       AND NOT (p.self_scoped AND r.data_scope = 'linked')
                  ) AS holds_permissions
             FROM roles r
            WHERE (r.organization_id = $1 OR (r.organization_id IS NULL AND r.is_system_role))
              -- built-in roles the unit replaced and hid (services/roleVisibility.js)
              AND NOT EXISTS (SELECT 1 FROM organization_hidden_roles h
                               WHERE h.organization_id = $1 AND h.role_id = r.id)
              -- policy-allow role-names: demo accounts are described by role (CLAUDE.md §3)
              AND r.role_name NOT IN ('demoadmin', 'demoparent')
            ORDER BY r.data_scope = 'linked' DESC, r.display_name`,
          [organizationId, held]
        ),
        resolveUnitRoleId(pool, 'parent', organizationId),
      ]);
      const mayAssign = held.includes('users.assign_roles');
      return success(res, result.rows.map(({ holds_permissions: holdsPermissions, ...role }) => {
        const defaultFamily = Number(role.id) === parentRoleId;
        return { ...role, default_family: defaultFamily, assignable: defaultFamily || (mayAssign && holdsPermissions) };
      }));
    })
  );

  /**
   * Check the roles an invitation names: roles this unit offers, family or
   * team, that the caller holds every permission of.
   *
   * @param {Object} req - Request, after requirePermission
   * @param {Object} res - Response
   * @param {number} organizationId - Caller's unit
   * @returns {Promise<{roleIds: number[]}|null>} The roles, or null once a refusal was sent
   */
  async function checkInvitationRoles(req, res, organizationId) {
    const roleIds = normalizeRoleIds(req.body.role_ids);
    const unitRoles = await findRolesInUnit(pool, roleIds, organizationId);
    if (unitRoles.length !== roleIds.length) {
      error(res, 'leader_invitation_role_invalid', HTTP_STATUS.BAD_REQUEST, [{ field: 'role_ids', value: req.body.role_ids }]);
      return null;
    }
    if ((await findHiddenAmong(pool, roleIds, organizationId)).length > 0) {
      error(res, 'role_hidden_in_unit', HTTP_STATUS.CONFLICT, [{ field: 'role_ids', value: req.body.role_ids }]);
      return null;
    }
    const check = await checkRolesGrantable(pool, roleIds, req.userPermissions || []);
    if (!check.allowed) {
      forbidden(res, 'You can only invite into roles whose permissions you hold', check.required, check.missing, { roles: check.roles });
      return null;
    }
    return { roleIds };
  }

  /**
   * Invite a parent.
   *
   * The response separates two outcomes that look alike and are not: the
   * invitation exists either way, but `email_sent: false` means the family has
   * not heard anything and the admin should resend rather than wait. Returning
   * an error instead would suggest nothing was created, and the next attempt
   * would collide with the invitation this one left behind.
   *
   * An address whose membership an admin deactivated by hand is answered with
   * a 409 carrying `code: 'manually_deactivated'` and the date and reason of
   * that deactivation. The client shows it, asks whether the admin is sure and
   * why, and resubmits with `confirm_reactivation: true` and a
   * `reactivation_reason`. Nothing is created or sent until then.
   */
  /** Create or replace a pending invitation through the same validation and delivery path. */
  /**
   * Whether the caller may edit this invitation's roles along with it: a
   * family invitation carries none; a leader invitation takes
   * users.assign_roles and every permission of its roles.
   *
   * @param {Object} req - Request, after requirePermission
   * @param {Object} res - Response
   * @param {number} organizationId - Caller's unit
   * @returns {Promise<boolean>} False once a refusal was sent
   */
  async function mayEditInvitationRoles(req, res, organizationId) {
    const stored = await pool.query(
      'SELECT role_ids FROM parent_invitations WHERE id = $1 AND organization_id = $2',
      [req.params.id, organizationId]
    );
    const roleIds = normalizeRoleIds(stored.rows[0]?.role_ids || []);
    if (roleIds.length === 0) {
      return true;
    }
    const held = req.userPermissions || [];
    if (!held.includes('users.assign_roles')) {
      forbidden(res, 'Editing a leader invitation takes the permission to assign roles',
        ['users.invite', 'users.assign_roles'], ['users.assign_roles']);
      return false;
    }
    const check = await checkRolesGrantable(pool, roleIds, held);
    if (!check.allowed) {
      forbidden(res, 'You can only edit invitations into roles whose permissions you hold', check.required, check.missing, { roles: check.roles });
      return false;
    }
    return true;
  }

  async function writeInvitation(req, res, editing = false) {
    const organizationId = await getOrganizationId(req, pool);

    // Editing keeps the roles the invitation was made with
    let roleIds = null;
    if (!editing && namesRoles(req)) {
      const checked = await checkInvitationRoles(req, res, organizationId);
      if (!checked) {
        return res;
      }
      ({ roleIds } = checked);
    }
    // Editing a leader invitation, above all its address, hands its roles to
    // whoever receives it: the editor must be able to grant them too.
    if (editing && !(await mayEditInvitationRoles(req, res, organizationId))) {
      return res;
    }

    const organization = await pool.query(
      'SELECT default_language FROM organizations WHERE id = $1',
      [organizationId]
    );

    const created = await (editing ? updateInvitation : createInvitation)(pool, {
      invitationId: req.params.id,
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
      roleIds,
      deactivationOverrideReason: isConfirmed(req.body.confirm_reactivation)
        ? optionalText(req.body.reactivation_reason)
        : null,
    });

    if (!created.ok && created.reason === 'not_found') {
      return error(res, 'Invitation not found', HTTP_STATUS.NOT_FOUND);
    }

    if (!created.ok && created.reason === 'manually_deactivated') {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        code: 'manually_deactivated',
        message: 'This address belongs to a member who was deactivated by hand. Confirm, with a reason, to reinstate them.',
        data: {
          deactivated_at: created.deactivated_at,
          deactivated_reason: created.deactivated_reason,
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (!created.ok) {
      // The reason travels as a code as well as prose, so the screen can say
      // it in the admin's own language.
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        code: created.reason,
        message: created.reason === 'already_member'
          ? 'This address already belongs to an active member of this unit'
          : 'This address already has a pending invitation',
        timestamp: new Date().toISOString(),
      });
    }

    const emailSent = await deliverParentInvitation(pool, {
      invitation: created.invitation,
      token: created.token,
      logger,
    });

    return success(
      res,
      { ...serializeInvitation(created.invitation), email_sent: emailSent },
      emailSent ? 'Invitation sent' : 'Invitation created, but the email could not be sent',
      editing ? HTTP_STATUS.OK : HTTP_STATUS.CREATED
    );
  }

  const writeMiddleware = [authenticate, blockDemoRoles, requirePermission(invitationPermissions),
    invitationWriteLimiter, validateEmail, ...validateOptionalFields, checkValidation];
  router.post('/', ...writeMiddleware, asyncHandler((req, res) => writeInvitation(req, res)));
  router.put('/:id', param('id').isUUID(), ...writeMiddleware,
    asyncHandler((req, res) => writeInvitation(req, res, true)));

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
        return error(res, 'Invitation not found', HTTP_STATUS.NOT_FOUND);
      }

      const emailSent = await deliverParentInvitation(pool, {
        invitation: resent.invitation,
        token: resent.token,
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
        return error(res, 'Invitation not found', HTTP_STATUS.NOT_FOUND);
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
