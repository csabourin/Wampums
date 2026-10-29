/** Seasonal camp lists: staff publish content, only linked families check items. */
const express = require('express');
const { body } = require('express-validator');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId, getScoutYear } = require('../middleware/auth');
const { validateIdParam, checkValidation } = require('../middleware/validation');
const { sendAIFailure } = require('../utils/aiFailure');
const RULES = require('../config/personal_equipment.json');
const { success, error, asyncHandler } = require('../middleware/response');
const equipment = require('../services/personalEquipment');
const activityEquipment = require('../services/activityPersonalEquipment');
const HTTP_CONFLICT = 409;
/** Restrict to the caller's linked children unless the route explicitly permits a staff read. */
async function contextFor(req, pool, write = false) {
  const organizationId = await getOrganizationId(req, pool);
  const year = await getScoutYear(req, pool);
  if (write && year.status !== 'active') { throw new equipment.PersonalEquipmentError('personal_equipment_archived', HTTP_CONFLICT); }
  return { organizationId, yearId: year.id, userId: req.user.id };
}
const handle = (handler) => asyncHandler(async (req, res) => {
  try { return await handler(req, res); }
  catch (err) {
    if (err instanceof equipment.PersonalEquipmentError) { return error(res, err.message, err.status); }
    return sendAIFailure(res, err);
  }
});
module.exports = (pool) => {
  const router = express.Router(); router.use(authenticate);
  router.get('/mine', requirePermission('personal_equipment.view'), handle(async (req, res) =>
    success(res, [...await equipment.familyTasks(pool, await contextFor(req, pool)), ...await activityEquipment.tasks(pool, await contextFor(req, pool))])));
  router.get('/activities/:id/manage', requirePermission({ permissions: ['personal_equipment.manage'], organizationScope: true }), validateIdParam('id'), checkValidation, handle(async (req, res) => {
    const context = await contextFor(req, pool);
    const data = await activityEquipment.read(pool, context, Number(req.params.id), true);
    const catalog = (await pool.query('SELECT id,name FROM equipment_catalog_items WHERE organization_id=$1 AND archived_at IS NULL ORDER BY name,id', [context.organizationId])).rows;
    return success(res, { ...data, catalog });
  }));
  router.get('/activities/:id', requirePermission('personal_equipment.view'), validateIdParam('id'), checkValidation, handle(async (req, res) =>
    success(res, await activityEquipment.read(pool, await contextFor(req, pool), Number(req.params.id)))));
  router.put('/activities/:id', requirePermission({ permissions: ['personal_equipment.manage'], organizationScope: true }), blockDemoRoles,
    validateIdParam('id'), body().custom((value) => Boolean(equipment.readList(value))), checkValidation, handle(async (req, res) =>
      success(res, await activityEquipment.save(pool, await contextFor(req, pool, true), Number(req.params.id), req.body))));
  router.post('/activities/:id/translations', requirePermission('personal_equipment.view'), blockDemoRoles,
    validateIdParam('id'), body('language').isString().bail().isIn(RULES.TRANSLATION_LANGUAGES), checkValidation, handle(async (req, res) =>
      success(res, await activityEquipment.translate(pool, await contextFor(req, pool), Number(req.params.id), req.body.language))));
  router.get('/:id/manage', requirePermission({ permissions: ['personal_equipment.manage'], organizationScope: true }), validateIdParam('id'), checkValidation,
    handle(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const camp = await equipment.campFor(pool, organizationId, Number(req.params.id));
      const list = await equipment.listFor(pool, organizationId, camp.id);
      const catalog = (await pool.query('SELECT id,name FROM equipment_catalog_items WHERE organization_id=$1 AND archived_at IS NULL ORDER BY name,id', [organizationId])).rows;
      return success(res, { camp, list, catalog });
    }));
  router.get('/:id', requirePermission('personal_equipment.view'), validateIdParam('id'), checkValidation, handle(async (req, res) =>
    success(res, await equipment.readFamilyList(pool, await contextFor(req, pool), Number(req.params.id)))));
  router.put('/:id', requirePermission({ permissions: ['personal_equipment.manage'], organizationScope: true }), blockDemoRoles,
    validateIdParam('id'), body().custom((value) => Boolean(equipment.readList(value))), checkValidation, handle(async (req, res) => {
      const context = await contextFor(req, pool, true);
      return success(res, await equipment.saveList(pool, context.organizationId, req.user.id, Number(req.params.id), req.body));
    }));
  router.post('/:id/translations', requirePermission('personal_equipment.view'), blockDemoRoles,
    validateIdParam('id'), body('language').isString().bail().isIn(RULES.TRANSLATION_LANGUAGES), checkValidation,
    handle(async (req, res) => success(res, await equipment.translateList(pool, await contextFor(req, pool),
      Number(req.params.id), req.body.language))));
  return router;
};
