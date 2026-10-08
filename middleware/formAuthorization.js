'use strict';

const { requirePermission, getOrganizationId, getUserDataScope } = require('./auth');
const { error, asyncHandler } = require('./response');

const HTTP_STATUS = { BAD_REQUEST: 400, NOT_FOUND: 404 };
const MAX_INTEGER_ID = 2147483647;
const FORM_READ_PERMISSIONS = ['forms.view', 'forms.submit', 'forms.manage'];

/** Read a form submission once in the authenticated unit before checking its form type. */
function resolveFormSubmission(pool, idFromRequest) {
  return asyncHandler(async (req, res, next) => {
    const value = idFromRequest(req);
    const id = Number(value);
    if (!/^\d+$/.test(String(value)) || !Number.isInteger(id) || id <= 0 || id > MAX_INTEGER_ID) {
      return error(res, 'Invalid submission identifier', HTTP_STATUS.BAD_REQUEST);
    }
    const organizationId = await getOrganizationId(req, pool);
    const result = await pool.query(
      'SELECT id, participant_id, organization_id, form_type FROM form_submissions WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    if (!result.rows.length) {return error(res, 'Form submission not found', HTTP_STATUS.NOT_FOUND);}
    req.formSubmission = result.rows[0];
    return next();
  });
}

/**
 * Form-specific rights remain an explicit alternative to unit-wide keys. They
 * use role metadata loaded by requirePermission, never JWT roles or a second
 * membership verifier. For review confirmation, only linked families receive
 * the unit-wide read-key alternative; staff must hold submit/edit form rights.
 * @param {Object} pool - Database pool
 * @param {Object} options - Form selector, permitted actions and optional global keys
 * @returns {Function} Authorization middleware using the shared permission engine
 */
function requireFormPermission(pool, { formType, actions, globalPermissions = [], familyReview = false }) {
  const authorize = requirePermission(async (req) => {
    const type = formType(req);
    const keys = familyReview && await getUserDataScope(req, pool) === 'linked'
      ? FORM_READ_PERMISSIONS : globalPermissions;
    return {
      permissions: keys.length ? keys : actions.map((action) => `forms.${type}.${action}`), any: true,
      resourceAccess: (_request, { context }) => {
        const rights = Object.hasOwn(context.formPermissions, type) ? context.formPermissions[type] : {};
        return actions.some((action) => rights[`can_${action}`] === true);
      },
    };
  });
  return (req, res, next) => {
    const type = formType(req);
    if (typeof type !== 'string' || !type.trim()) {
      return error(res, 'Form type is required', HTTP_STATUS.BAD_REQUEST);
    }
    return authorize(req, res, next);
  };
}

module.exports = { FORM_READ_PERMISSIONS, resolveFormSubmission, requireFormPermission };
