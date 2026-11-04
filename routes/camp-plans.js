/**
 * Written sections of the camp plan (#1318).
 *
 * Mounted at /api/v1/camp-plans. Reading a camp's sections takes
 * `meetings.view`, and reading the unit's templates `meetings.view` or
 * `camp_plan_templates.manage`; writing a camp's sections and choosing its
 * bad-weather games takes `meetings.manage`, as planning the camp does;
 * writing the unit's templates takes `camp_plan_templates.manage`.
 *
 * @module routes/camp-plans
 */
const express = require('express');
const { param } = require('express-validator');
const { authenticate, requirePermission, requireAnyPermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const {
  CampPlanError, ALL_SECTIONS, UNIT_SECTIONS, listTemplates, saveTemplate, readCampPlan, saveCampSection, saveRainGames,
} = require('../services/campPlan');

/** Answer known refusals with their translation key, naming the field when there is one. */
const handle = (handler) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof CampPlanError) {
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

  // Read by every camp's plan (meetings.view) and by the template editor, who may hold only its own right.
  router.get('/templates',
    requireAnyPermission('meetings.view', 'camp_plan_templates.manage'),
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await listTemplates(pool, organizationId));
    }));

  router.put('/templates/:sectionKey',
    blockDemoRoles,
    requirePermission('camp_plan_templates.manage'),
    param('sectionKey').isIn(UNIT_SECTIONS).withMessage('camp_plan_section_not_found'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await saveTemplate(pool, organizationId, req.user.id, req.params.sectionKey, req.body), 'camp_plan_saved');
    }));

  router.get('/camps/:meetingId',
    requirePermission('meetings.view'),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await readCampPlan(pool, organizationId, Number(req.params.meetingId)));
    }));

  router.put('/camps/:meetingId/sections/:sectionKey',
    blockDemoRoles,
    requirePermission('meetings.manage'),
    validateIdParam('meetingId'),
    param('sectionKey').isIn(ALL_SECTIONS).withMessage('camp_plan_section_not_found'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await saveCampSection(pool, organizationId, req.user.id,
        Number(req.params.meetingId), req.params.sectionKey, req.body), 'camp_plan_saved');
    }));

  router.put('/camps/:meetingId/rain-games',
    blockDemoRoles,
    requirePermission('meetings.manage'),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await saveRainGames(pool, organizationId, req.user.id, Number(req.params.meetingId), req.body), 'camp_plan_saved');
    }));

  return router;
};
