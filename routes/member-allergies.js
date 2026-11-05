/**
 * Adults' allergies (#1319): what a member declares about their own allergies.
 *
 * Mounted at /api/v1/member-allergies. Only `/me` exists: any active member of the unit reads,
 * records or withdraws their own declaration, and nobody writes one for someone else. It belongs
 * to the person: every unit they belong to reads the same one. Reading
 * others' happens only in a camp's lists, behind `camp_allergies.view` (routes/camp-rosters.js).
 *
 * @module routes/member-allergies
 */
const express = require('express');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const {
  AllergyDeclarationError, readOwnDeclaration, saveOwnDeclaration, removeOwnDeclaration,
} = require('../services/memberAllergies');

/** Answer known refusals with their translation key, naming the field when there is one. */
const handle = (handler) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof AllergyDeclarationError) {
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

  router.get('/me', requirePermission(), handle(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await readOwnDeclaration(pool, organizationId, req.user.id));
  }));

  router.put('/me', blockDemoRoles, requirePermission(), handle(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await saveOwnDeclaration(pool, organizationId, req.user.id, req.body), 'allergy_declaration_saved');
  }));

  router.delete('/me', blockDemoRoles, requirePermission(), handle(async (req, res) => {
    await removeOwnDeclaration(pool, req.user.id);
    return success(res, null, 'allergy_declaration_removed');
  }));

  return router;
};
