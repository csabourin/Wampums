/**
 * Adult certifications (#1319): what a member declares for themselves, and what a manager reads
 * before verifying it.
 *
 * Mounted at /api/v1/member-certifications. Any active member of the unit reads and declares
 * their own (`/me`): the person is always the authenticated user, never a request field. A
 * manager of volunteers (`volunteers.manage`, who verifies them on /volunteers) reads anyone's in
 * the unit and verifies them; certifications belong to the person, so one verification holds in
 * every unit they belong to.
 *
 * @module routes/member-certifications
 */
const express = require('express');
const { param } = require('express-validator');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { checkValidation } = require('../middleware/validation');
const {
  CertificationError, certificationsOf, saveOwnDeclarations, verifyCertification,
} = require('../services/memberCertifications');

/** Answer known refusals with their translation key, naming the field when there is one. */
const handle = (handler) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof CertificationError) {
      const fields = err.field ? [{ path: err.field, location: 'body', msg: err.message }] : undefined;
      return error(res, err.message, err.status, fields);
    }
    throw err;
  }
});

/** @param {Object} pool - pg pool @returns {Object} Router */
module.exports = (pool) => {
  const router = express.Router();
  router.use(authenticate);

  // One's own: any active member of the unit.
  router.get('/me', requirePermission(), handle(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await certificationsOf(pool, organizationId, req.user.id));
  }));

  router.put('/me', blockDemoRoles, requirePermission(), handle(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await saveOwnDeclarations(pool, organizationId, req.user.id, req.body),
      'certifications_saved');
  }));

  // Anyone's in the unit, for the manager who verifies them.
  router.get('/:userId',
    requirePermission('volunteers.manage'),
    param('userId').isUUID().withMessage('certification_member_not_found'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await certificationsOf(pool, organizationId, req.params.userId));
    }));

  // A verification made here holds in every unit of the person.
  router.put('/:userId/:certificationKey/verification',
    blockDemoRoles,
    requirePermission('volunteers.manage'),
    param('userId').isUUID().withMessage('certification_member_not_found'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await verifyCertification(pool, organizationId, req.user.id, req.params.userId,
        req.params.certificationKey, req.body), 'certification_verification_saved');
    }));

  return router;
};
