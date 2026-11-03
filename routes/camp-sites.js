/**
 * Camp sites (#1317): the places a unit camps at, and where each camp is held.
 *
 * Mounted at /api/v1/camp-sites. Reading the sites and a camp's site takes
 * `meetings.view`; adding, editing and archiving a site takes
 * `camp_sites.manage`; choosing a camp's site, season, accommodation and
 * on-site lead takes `meetings.manage`, as planning the camp does.
 *
 * @module routes/camp-sites
 */
const express = require('express');
const { body, query } = require('express-validator');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId, userHasPermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const {
  CampSiteError, listSites, createSite, updateSite, setSiteArchived, readCampSite, saveCampSite,
} = require('../services/campSites');

const HTTP_CREATED = 201;

/** Answer known refusals with their translation key, naming the field when there is one. */
const handle = (handler) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof CampSiteError) {
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

  router.get('/',
    requirePermission('meetings.view'),
    query('include_archived').optional().isIn(['true', 'false']),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await listSites(pool, organizationId, { includeArchived: req.query.include_archived === 'true' }));
    }));

  router.post('/',
    blockDemoRoles,
    requirePermission('camp_sites.manage'),
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await createSite(pool, organizationId, req.user.id, req.body), 'camp_site_saved', HTTP_CREATED);
    }));

  router.put('/:id',
    blockDemoRoles,
    requirePermission('camp_sites.manage'),
    validateIdParam('id'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await updateSite(pool, organizationId, Number(req.params.id), req.body), 'camp_site_saved');
    }));

  router.patch('/:id/archive',
    blockDemoRoles,
    requirePermission('camp_sites.manage'),
    validateIdParam('id'),
    body('archived').custom((value) => typeof value === 'boolean').withMessage('invalid_request'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await setSiteArchived(pool, organizationId, Number(req.params.id), req.body.archived), 'camp_site_saved');
    }));

  router.get('/camps/:meetingId',
    requirePermission('meetings.view'),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      // Who may lead on site is offered only to whoever may choose them.
      const withMembers = await userHasPermission(req, pool, organizationId, 'meetings.manage');
      return success(res, await readCampSite(pool, organizationId, Number(req.params.meetingId), { withMembers }));
    }));

  router.put('/camps/:meetingId',
    blockDemoRoles,
    requirePermission('meetings.manage'),
    validateIdParam('meetingId'),
    checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await saveCampSite(pool, organizationId, req.user.id, Number(req.params.meetingId), req.body), 'camp_site_saved');
    }));

  return router;
};
