'use strict';

const { body, param } = require('express-validator');
const HTTP_STATUS = { OK: 200, CREATED: 201, BAD_REQUEST: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INTERNAL_ERROR: 500 };
const { authenticate, blockDemoRoles, requirePermission, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { checkValidation, NAME_MARKUP_PATTERN } = require('../middleware/validation');
const { manageFamilyChild } = require('../services/familyChildManagement');

/**
 * Register correction and enrollment withdrawal under an existing family router.
 * @param {Object} router - Express router already mounted under /api/v1
 * @param {Object} pool - Database pool
 * @param {Object} options - Narrow permission, path prefix and walk-in scope
 */
function registerFamilyChildManagement(router, pool, { prefix, permission, walkIn = false }) {
  const protection = [authenticate, blockDemoRoles, requirePermission(permission), param('id').isInt({ min: 1 })];
  const handle = (editing) => asyncHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const outcome = await manageFamilyChild(pool, {
      organizationId, participantId: Number(req.params.id), userId: req.user.id, walkIn,
      child: editing ? {
        firstName: req.body.first_name, lastName: req.body.last_name,
        dateOfBirth: req.body.date_naissance,
      } : null,
      inscriptionDate: editing ? req.body.inscription_date || null : null,
    });
    if (outcome.result === 'not_found') {return error(res, 'Participant not found', HTTP_STATUS.NOT_FOUND);}
    if (outcome.result === 'invalid') {return error(res, outcome.error, HTTP_STATUS.BAD_REQUEST, [{ path: 'child', msg: outcome.error }]);}
    if (outcome.result === 'duplicate_child') {return error(res, 'duplicate_child', HTTP_STATUS.CONFLICT);}
    return success(res, outcome, editing ? 'Child updated' : 'Enrollment withdrawn');
  });
  router.put(`${prefix}/:id`, ...protection,
    body('first_name').isString().trim().notEmpty().not().matches(NAME_MARKUP_PATTERN),
    body('last_name').isString().trim().notEmpty().not().matches(NAME_MARKUP_PATTERN),
    body('date_naissance').matches(/^\d{4}-\d{2}-\d{2}$/).isISO8601({ strict: true }),
    body('inscription_date').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/).isISO8601({ strict: true }),
    checkValidation, handle(true));
  router.delete(`${prefix}/:id`, ...protection, checkValidation, handle(false));
}

module.exports = { registerFamilyChildManagement };
