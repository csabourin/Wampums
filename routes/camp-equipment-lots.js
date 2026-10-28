/** Server foundation for camp lots; editor and offline outbox integration follow separately. */
const express = require('express');
const { body } = require('express-validator');
const { authenticate, blockDemoRoles, requirePermission, getOrganizationId } = require('../middleware/auth');
const { validateIdParam, validateIdBody, checkValidation } = require('../middleware/validation');
const { success, error, asyncHandler } = require('../middleware/response');
const { LOT_NAME_MAX, LOT_STATES } = require('../config/camp-equipment-lots');
const { readMaterialItems } = require('../services/equipmentCatalog');
const lots = require('../services/campEquipmentLots');
const HTTP_CREATED = 201;

/** Forward only known, translated refusals; internal failures use the shared 500 handler. */
const handle = (handler) => asyncHandler(async (req, res) => {
  try {return await handler(req, res);}
  catch (err) {
    if (err instanceof lots.CampLotError || err instanceof lots.TaskError) {return error(res, err.message, err.status);}
    throw err;
  }
});
module.exports = (pool) => {
  const router = express.Router();
  router.use(authenticate);
  router.get('/mine', requirePermission('tasks.view'), handle(async (req, res) =>
    success(res, await lots.listLots(pool, await getOrganizationId(req, pool), null, req.user.id))));
  router.get('/meetings/:meetingId', requirePermission('camp_lots.view'), validateIdParam('meetingId'), checkValidation, handle(async (req, res) =>
    success(res, await lots.listLots(pool, await getOrganizationId(req, pool), Number(req.params.meetingId)))));
  router.get('/meetings/:meetingId/options', requirePermission('camp_lots.manage', 'tasks.manage'), validateIdParam('meetingId'), checkValidation, handle(async (req, res) =>
    success(res, await lots.options(pool, await getOrganizationId(req, pool), Number(req.params.meetingId)))));

  const versionType = () => body('expected_version').custom((value) => typeof value === 'number' || typeof value === 'string');
  const fields = () => [
    validateIdParam('meetingId'),
    body('name').isString().bail().trim().isLength({ min: 1, max: LOT_NAME_MAX }),
    body('items').custom((value) => Boolean(readMaterialItems(value)?.length)),
    body('roles').custom((value) => Boolean(lots.readRoles(value))),
  ];
  router.post('/meetings/:meetingId', requirePermission('camp_lots.manage', 'tasks.manage'), blockDemoRoles,
    ...fields(), body('creation_key').isString().bail().isUUID('4'), checkValidation, handle(async (req, res) =>
      success(res, await lots.saveLot(pool, await getOrganizationId(req, pool), req.user.id, Number(req.params.meetingId), req.body), 'camp_lot_saved', HTTP_CREATED)));
  router.put('/meetings/:meetingId/:id', requirePermission('camp_lots.manage', 'tasks.manage'), blockDemoRoles,
    ...fields(), validateIdParam('id'), versionType(), validateIdBody('expected_version'), checkValidation, handle(async (req, res) =>
      success(res, await lots.saveLot(pool, await getOrganizationId(req, pool), req.user.id, Number(req.params.meetingId), { ...req.body, expected_version: Number(req.body.expected_version) }, Number(req.params.id)))));

  const stateFields = () => [validateIdParam('id'), versionType(), validateIdBody('expected_version'),
    body('status').isString().bail().isIn(LOT_STATES), body('mutation_id').isString().bail().isUUID('4'), checkValidation];
  const state = (ownOnly) => handle(async (req, res) => success(res, await lots.changeLotStatus(pool,
    { organizationId: await getOrganizationId(req, pool), actorId: req.user.id, ownOnly }, Number(req.params.id), { ...req.body, expected_version: Number(req.body.expected_version) })));
  router.patch('/mine/:id/status', requirePermission('tasks.view'), blockDemoRoles, ...stateFields(), state(true));
  router.patch('/:id/status', requirePermission('camp_lots.manage', 'tasks.manage'), blockDemoRoles, ...stateFields(), state(false));
  return router;
};
