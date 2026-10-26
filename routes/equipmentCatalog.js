/**
 * The unit's equipment catalogue: articles named once and offered, with a
 * quantity, in every material list of the unit.
 *
 * Mounted at /api/v1/equipment-catalog. Reading it is open to whoever manages
 * the catalogue or plans meetings (they pick articles from it); changing it
 * takes `equipment_catalog.manage`. Articles are archived, never deleted.
 * `/options` is what a schedule line may list: the active articles and the
 * inventory items the unit may use, by name and category only.
 *
 * @module routes/equipmentCatalog
 */
const express = require('express');
const { body, query } = require('express-validator');
const {
  authenticate, requirePermission, requireAnyPermission, blockDemoRoles, getOrganizationId,
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdParam, validateIdBody, checkValidation } = require('../middleware/validation');
const {
  CatalogError, CATALOG_NAME_MAX_LENGTH, EQUIPMENT_CATEGORIES, EQUIPMENT_UNITS,
  listCatalog, createCatalogItem, updateCatalogItem, listMaterialOptions,
} = require('../services/equipmentCatalog');

const HTTP_CREATED = 201;

/** Return known catalogue refusals, forwarding internal failures to the global handler. */
const catalogHandler = (handler) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof CatalogError) {
      const fields = err.field ? [{ path: err.field, location: 'body', msg: err.message }] : null;
      return error(res, err.message, err.status, fields);
    }
    throw err;
  }
});

/**
 * Field checks shared by creation and change.
 *
 * @param {boolean} creating - The name is required when creating
 * @returns {Array} express-validator chains
 */
function articleFields(creating) {
  const name = body('name');
  return [
    (creating ? name : name.optional())
      .isString().bail().trim().isLength({ min: 1, max: CATALOG_NAME_MAX_LENGTH })
      .withMessage('equipment_catalog_invalid_name'),
    body('category').optional().isString().bail().isIn(EQUIPMENT_CATEGORIES)
      .withMessage('equipment_catalog_invalid_category'),
    body('unit_of_measure').optional().isString().bail().isIn(EQUIPMENT_UNITS)
      .withMessage('equipment_catalog_invalid_unit'),
    validateIdBody('equipment_item_id').optional({ values: 'null' })
      .custom((value) => ['string', 'number'].includes(typeof value))
      .withMessage('equipment_catalog_equipment_unavailable'),
  ];
}

/** @param {Object} pool - pg pool @returns {Object} Router */
module.exports = (pool) => {
  const router = express.Router();
  router.use(authenticate);

  router.get('/',
    requireAnyPermission('equipment_catalog.manage', 'meetings.manage'),
    query('include_archived').optional().isIn(['true', 'false']),
    checkValidation,
    catalogHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const items = await listCatalog(pool, organizationId, {
        includeArchived: req.query.include_archived === 'true',
      });
      return success(res, items);
    }));

  router.get('/options',
    requireAnyPermission('equipment_catalog.manage', 'meetings.manage'),
    catalogHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await listMaterialOptions(pool, organizationId));
    }));

  router.post('/',
    blockDemoRoles,
    requirePermission('equipment_catalog.manage'),
    articleFields(true),
    checkValidation,
    catalogHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const item = await createCatalogItem(pool, organizationId, req.user.id, req.body);
      return success(res, item, 'equipment_catalog_saved', HTTP_CREATED);
    }));

  router.patch('/:id',
    blockDemoRoles,
    requirePermission('equipment_catalog.manage'),
    validateIdParam('id'),
    articleFields(false),
    body('archived').optional().custom((value) => typeof value === 'boolean').withMessage('invalid_request'),
    checkValidation,
    catalogHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const item = await updateCatalogItem(pool, organizationId, Number(req.params.id), req.body);
      return success(res, item, 'equipment_catalog_saved');
    }));

  return router;
};
