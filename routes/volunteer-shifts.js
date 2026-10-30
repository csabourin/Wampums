/** Volunteer shifts (#1251): needs by time slot, and taking or giving up a place. */
const express = require('express');
const { body, param } = require('express-validator');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId, userHasPermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdBody, validateIdParam, checkValidation } = require('../middleware/validation');
const {
  VolunteerError, listShifts, listShiftActivities, saveShift, deleteShift, signUp, withdraw,
} = require('../services/volunteerShifts');
const { VOLUNTEER_SHIFTS: LIMITS } = require('../config/constants');

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Return known refusals; anything else goes to the global handler as a 500. */
const volunteerHandler = (handler) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof VolunteerError) {
      return error(res, err.message, err.status);
    }
    throw err;
  }
});

/** @param {Object} pool - pg pool @returns {Object} Router */
module.exports = (pool) => {
  const router = express.Router();
  router.use(authenticate);

  // Other volunteers' names are shown to managers only.
  router.get('/', requirePermission('volunteers.view'), volunteerHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const withNames = await userHasPermission(req, pool, organizationId, 'volunteers.manage');
    return success(res, await listShifts(pool, organizationId, req.user.id, { withNames }));
  }));

  // Names and dates of activities only: no participant, family or health record.
  router.get('/activities', requirePermission('volunteers.manage'), volunteerHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await listShiftActivities(pool, organizationId));
  }));

  const fields = () => [
    validateIdBody('activity_id'),
    body('title').isString().bail().trim().isLength({ min: 1, max: LIMITS.TITLE_MAX_LENGTH }).withMessage('volunteer_invalid_title'),
    body('shift_date').isString().bail().matches(DATE_PATTERN).bail().isDate({ format: 'YYYY-MM-DD', strictMode: true }).withMessage('volunteer_invalid_date'),
    body('start_time').isString().bail().matches(TIME_PATTERN).withMessage('volunteer_invalid_time'),
    body('end_time').isString().bail().matches(TIME_PATTERN).withMessage('volunteer_invalid_time')
      .custom((value, { req }) => value > req.body.start_time).withMessage('volunteer_end_before_start'),
    body('slots').isInt({ min: 1, max: LIMITS.MAX_SLOTS }).withMessage('volunteer_invalid_slots').bail().toInt(),
    body('notes').optional({ values: 'null' }).isString().bail().isLength({ max: LIMITS.NOTES_MAX_LENGTH }).withMessage('volunteer_invalid_notes'),
    checkValidation,
  ];
  /** @returns {Object} The validated shift, as the service takes it */
  const shiftFrom = (req) => ({
    activity_id: Number(req.body.activity_id), title: req.body.title, shift_date: req.body.shift_date,
    start_time: req.body.start_time, end_time: req.body.end_time, slots: req.body.slots, notes: req.body.notes || '',
  });

  router.post('/', blockDemoRoles, requirePermission('volunteers.manage'), fields(), volunteerHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await saveShift(pool, organizationId, req.user.id, shiftFrom(req)), 'volunteer_shift_saved', HTTP_CREATED);
  }));
  router.put('/:id', blockDemoRoles, requirePermission('volunteers.manage'), validateIdParam('id'), fields(),
    volunteerHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await saveShift(pool, organizationId, req.user.id, shiftFrom(req), Number(req.params.id)), 'volunteer_shift_saved');
    }));
  router.delete('/:id', blockDemoRoles, requirePermission('volunteers.manage'), validateIdParam('id'), checkValidation,
    volunteerHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return await deleteShift(pool, organizationId, Number(req.params.id))
        ? success(res, null, 'volunteer_shift_deleted')
        : error(res, 'volunteer_shift_not_found', HTTP_NOT_FOUND);
    }));

  // One's own place: the caller is the volunteer, never a body field.
  router.post('/:id/signups', blockDemoRoles, requirePermission('volunteers.view'), validateIdParam('id'), checkValidation,
    volunteerHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { created } = await signUp(pool, organizationId, Number(req.params.id), req.user.id);
      return success(res, { confirmed: true }, 'volunteer_signed_up', created ? HTTP_CREATED : HTTP_OK);
    }));
  router.delete('/:id/signups/me', blockDemoRoles, requirePermission('volunteers.view'), validateIdParam('id'), checkValidation,
    volunteerHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return await withdraw(pool, organizationId, Number(req.params.id), req.user.id)
        ? success(res, null, 'volunteer_withdrawn')
        : error(res, 'volunteer_signup_not_found', HTTP_NOT_FOUND);
    }));
  router.delete('/:id/signups/:userId', blockDemoRoles, requirePermission('volunteers.manage'), validateIdParam('id'),
    param('userId').isUUID().withMessage('invalid_request'), checkValidation,
    volunteerHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return await withdraw(pool, organizationId, Number(req.params.id), req.params.userId)
        ? success(res, null, 'volunteer_withdrawn')
        : error(res, 'volunteer_signup_not_found', HTTP_NOT_FOUND);
    }));

  return router;
};
