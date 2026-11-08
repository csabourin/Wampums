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
const { rateLimit } = require('express-rate-limit');
const { body, param } = require('express-validator');
const {
  authenticate, requirePermission, requireAnyPermission, blockDemoRoles, getOrganizationId, userHasPermission,
} = require('../middleware/auth');
const { success, error, forbidden, asyncHandler } = require('../middleware/response');
const { HTTP_STATUS } = require('../utils/http-status');
const { validateIdParam, checkValidation, validateEmail, normalizeEmailValue } = require('../middleware/validation');
const {
  CampPlanError, ALL_SECTIONS, UNIT_SECTIONS, listTemplates, listCampPlans, saveTemplate, readCampPlan, saveCampSection, saveRainGames,
} = require('../services/campPlan');
const { readCampPermit } = require('../services/campPermit');
const { submitPlanVersion, listPlanVersions, readPlanVersionPdf } = require('../services/campPlanVersions');

/**
 * A submitted plan names the camp's youth and its team with their qualifications: unit-wide
 * members who may read them, as the camp lists require (qualifications: meetings.manage or
 * volunteers.manage).
 */
const READ_VERSIONS = { permissions: ['meetings.view', 'participants.view'], organizationScope: true };
const READ_QUALIFICATIONS = requireAnyPermission('meetings.manage', 'volunteers.manage');
const { RULES, DECISIONS, attestCampPlan, requestBranchApproval, readAttestationPdf } = require('../services/campPlanApprovals');
const { MS_PER_HOUR } = require('../utils/time-units');
const APPROVAL_PERMISSIONS = { lead: 'camp_plans.attest_lead', group: 'camp_plans.approve_group' };
const BRANCH_REQUEST = 'camp_plans.request_branch_approval';
const approvalAccess = (permission) => ({ ...READ_VERSIONS, permissions: [...READ_VERSIONS.permissions, permission] });
const versionParams = () => [validateIdParam('meetingId'), validateIdParam('versionNumber')];
const expectedDigest = () => body('pdf_sha256').isString().matches(/^[0-9a-f]{64}$/);
const SUBMIT = { permissions: ['meetings.manage', 'participants.view'], organizationScope: true };

/** Answer known refusals with their translation key, naming the field when there is one. */
const handle = (handler, required = []) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof CampPlanError) {
      if (err.status === HTTP_STATUS.FORBIDDEN) {
        return forbidden(res, err.message, typeof required === 'function' ? required(req) : required, []);
      }
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
  const branchRequestLimiter = rateLimit({
    windowMs: MS_PER_HOUR, limit: RULES.link_requests_per_hour,
    standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user.id,
    handler: (_req, res) => error(res, 'camp_approval_rate_limit', HTTP_STATUS.TOO_MANY_REQUESTS),
  });

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
    READ_QUALIFICATIONS,
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const withHealth = await userHasPermission(req, pool, organizationId, 'camp_allergies.view');
      res.set('Cache-Control', 'no-store');
      return success(res, await listPlanVersions(pool, organizationId, Number(req.params.meetingId), withHealth));
    }));

  router.post('/camps/:meetingId/versions',
    blockDemoRoles,
    requirePermission(SUBMIT),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const withHealth = await userHasPermission(req, pool, organizationId, 'camp_allergies.view');
      return success(res, await submitPlanVersion(pool, organizationId, req.user.id, Number(req.params.meetingId), withHealth),
        'camp_plan_version_submitted', HTTP_STATUS.CREATED);
    }));

  // The document: with the allergies only for whoever may read them (camp_allergies.view).
  router.get('/camps/:meetingId/versions/:versionNumber/pdf',
    requirePermission(READ_VERSIONS),
    READ_QUALIFICATIONS,
    validateIdParam('meetingId'),
    validateIdParam('versionNumber'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const withHealth = await userHasPermission(req, pool, organizationId, 'camp_allergies.view');
      const file = await readPlanVersionPdf(pool, organizationId, Number(req.params.meetingId),
        Number(req.params.versionNumber), withHealth && req.query.copy !== 'plain');
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-SHA256': file.sha256,
      });
      return res.send(file.pdf);
    }));

  router.post('/camps/:meetingId/versions/:versionNumber/attestations/:stage',
    blockDemoRoles,
    ...versionParams(),
    param('stage').isIn(Object.keys(APPROVAL_PERMISSIONS)),
    expectedDigest(),
    body('decision').isIn(DECISIONS),
    body('job').isString().bail().trim().isLength({ min: 1, max: RULES.signer_function_max }),
    body('comment').isString().bail().trim().isLength({ max: RULES.comment_max }),
    checkValidation,
    requirePermission((req) => approvalAccess(APPROVAL_PERMISSIONS[req.params.stage])),
    READ_QUALIFICATIONS,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { meetingId, versionNumber, stage } = req.params;
      const { decision, job, comment, pdf_sha256: digest } = req.body;
      const result = await attestCampPlan(pool, { organizationId, meetingId: Number(meetingId),
        number: Number(versionNumber), expectedDigest: digest, actorId: req.user.id, stage, decision, job, comment, ip: req.ip });
      return success(res, result, 'camp_approval_saved', HTTP_STATUS.CREATED);
    }, (req) => approvalAccess(APPROVAL_PERMISSIONS[req.params.stage]).permissions));

  router.post('/camps/:meetingId/versions/:versionNumber/branch-link',
    blockDemoRoles,
    requirePermission(approvalAccess(BRANCH_REQUEST)),
    READ_QUALIFICATIONS,
    branchRequestLimiter,
    ...versionParams(), expectedDigest(), validateEmail, checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      await requestBranchApproval(pool, { organizationId, meetingId: Number(req.params.meetingId),
        number: Number(req.params.versionNumber), expectedDigest: req.body.pdf_sha256, email: normalizeEmailValue(req.body.email) });
      return success(res, null, 'camp_approval_link_sent', HTTP_STATUS.CREATED);
    }, approvalAccess(BRANCH_REQUEST).permissions));

  router.get('/camps/:meetingId/versions/:versionNumber/attestation-pdf',
    requirePermission(READ_VERSIONS),
    READ_QUALIFICATIONS,
    ...versionParams(), checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const file = await readAttestationPdf(pool, organizationId, Number(req.params.meetingId), Number(req.params.versionNumber));
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
