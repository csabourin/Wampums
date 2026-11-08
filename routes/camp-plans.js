/**
 * Written sections of the camp plan (#1318).
 *
 * Mounted at /api/v1/camp-plans. Reading a camp's sections takes
 * `meetings.view`, and reading the unit's templates `meetings.view` or
 * `camp_plan_templates.manage`; writing a camp's sections and choosing its
 * bad-weather games takes `meetings.manage`, as planning the camp does;
 * writing the unit's templates takes `camp_plan_templates.manage`. The permit
 * checklist (#1416) takes `meetings.view` with a unit-wide scope. Its frozen
 * versions (#1418) name the camp's youth and team: reading them takes
 * `participants.view` too, and submitting one `meetings.manage`; the copy of a
 * document that names allergies is served only with `camp_allergies.view`.
 *
 * @module routes/camp-plans
 */
const express = require('express');
const { param } = require('express-validator');
const {
  authenticate, requirePermission, requireAnyPermission, blockDemoRoles, getOrganizationId, userHasPermission,
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { HTTP_STATUS } = require('../utils/http-status');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const {
  CampPlanError, ALL_SECTIONS, UNIT_SECTIONS, listTemplates, listCampPlans, saveTemplate, readCampPlan, saveCampSection, saveRainGames,
} = require('../services/campPlan');
const { readCampPermit } = require('../services/campPermit');
const { submitPlanVersion, listPlanVersions, readPlanVersionPdf } = require('../services/campPlanVersions');

/** A submitted plan names the camp's youth and team: unit-wide members who may read them. */
const READ_VERSIONS = { permissions: ['meetings.view', 'participants.view'], organizationScope: true };
const SUBMIT = { permissions: ['meetings.manage', 'participants.view'], organizationScope: true };

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

  // The unit's camps and what each plan still lacks, read as each camp's plan is.
  router.get('/camps',
    requirePermission('meetings.view'),
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await listCampPlans(pool, organizationId));
    }));

  router.get('/camps/:meetingId',
    requirePermission('meetings.view'),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await readCampPlan(pool, organizationId, Number(req.params.meetingId)));
    }));

  // The permit checklist (#1416) reads the whole camp, its lists included: unit-wide members only.
  // Each line whose source takes another right is "not verified" without it.
  router.get('/camps/:meetingId/permit',
    requirePermission({ permissions: ['meetings.view'], organizationScope: true }),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const [participants, carpools, reviews] = await Promise.all(['participants.view', 'carpools.view', 'camp_reviews.view']
        .map((key) => userHasPermission(req, pool, organizationId, key)));
      res.set('Cache-Control', 'no-store');
      return success(res, await readCampPermit(pool, organizationId, Number(req.params.meetingId),
        { participants, carpools, reviews }));
    }));

  // Frozen versions of the plan and their documents (#1418).
  router.get('/camps/:meetingId/versions',
    requirePermission(READ_VERSIONS),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      res.set('Cache-Control', 'no-store');
      return success(res, await listPlanVersions(pool, organizationId, Number(req.params.meetingId)));
    }));

  router.post('/camps/:meetingId/versions',
    blockDemoRoles,
    requirePermission(SUBMIT),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await submitPlanVersion(pool, organizationId, req.user.id, Number(req.params.meetingId)),
        'camp_plan_version_submitted', HTTP_STATUS.CREATED);
    }));

  // The document: with the allergies only for whoever may read them (camp_allergies.view).
  router.get('/camps/:meetingId/versions/:versionNumber/pdf',
    requirePermission(READ_VERSIONS),
    validateIdParam('meetingId'),
    validateIdParam('versionNumber'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const withHealth = await userHasPermission(req, pool, organizationId, 'camp_allergies.view');
      const file = await readPlanVersionPdf(pool, organizationId, Number(req.params.meetingId),
        Number(req.params.versionNumber), withHealth);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-SHA256': file.sha256,
      });
      return res.send(file.pdf);
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
