/** Volunteer shifts (#1251): needs by time slot, and taking or giving up a place. */
const express = require('express');
const { body, param } = require('express-validator');
const isDate = require('validator/lib/isDate');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId, userHasPermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdBody, validateIdParam, checkValidation } = require('../middleware/validation');
const {
  VOLUNTEER_TYPES, REQUIREMENTS, VALIDITY_YEARS, VolunteerError, teamChecks, listShifts, listShiftActivities, saveShift, deleteShift, signUp, withdraw,
  getRequirements, recordRequirements,
} = require('../services/volunteerShifts');
const { VOLUNTEER_SHIFTS: LIMITS } = require('../config/constants');

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_LENGTH = 10;

/** @returns {boolean} Whether a value is absent or a real YYYY-MM-DD date */
const optionalDate = (value) => value === null || value === undefined
  || (typeof value === 'string' && DATE_PATTERN.test(value) && isDate(value, { format: 'YYYY-MM-DD', strictMode: true }));

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
    body('volunteer_type').isString().bail().isIn(VOLUNTEER_TYPES).withMessage('volunteer_invalid_type'),
    // "Other" says what it is in its title; a listed type may add a precision.
    body('title').optional({ values: 'null' }).isString().bail().trim().isLength({ max: LIMITS.TITLE_MAX_LENGTH })
      .withMessage('volunteer_invalid_title'),
    body('title').if((_value, { req }) => req.body.volunteer_type === 'other')
      .custom((value) => typeof value === 'string' && value.trim().length > 0).withMessage('volunteer_other_needs_title'),
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
    activity_id: Number(req.body.activity_id), volunteer_type: req.body.volunteer_type, title: req.body.title || '', shift_date: req.body.shift_date,
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

  // What was verified for a person: managers, for anyone in the unit; a member, for themselves.
  router.get('/requirements/me', requirePermission('volunteers.view'), volunteerHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await getRequirements(pool, organizationId, req.user.id));
  }));
  // The team's background checks, most urgent first: managers only.
  router.get('/checks', requirePermission('volunteers.manage'), volunteerHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await teamChecks(pool, organizationId));
  }));
  router.get('/requirements/:userId', requirePermission('volunteers.manage'),
    param('userId').isUUID().withMessage('invalid_request'), checkValidation, volunteerHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await getRequirements(pool, organizationId, req.params.userId));
    }));
  // The complete record: requirements named are verified (until their date), the others are not.
  router.put('/requirements/:userId', blockDemoRoles, requirePermission('volunteers.manage'),
    param('userId').isUUID().withMessage('invalid_request'),
    body('verified').isObject().withMessage('invalid_request').bail()
      .custom((value) => Object.keys(value).every((key) => REQUIREMENTS.includes(key))).withMessage('volunteer_invalid_requirement')
      .bail().custom((value) => Object.values(value).every((entry) => entry && typeof entry === 'object'
        && optionalDate(entry.valid_until) && optionalDate(entry.checked_on)))
      .withMessage('volunteer_invalid_date')
      // A check that lasts a set time says when it was done, and it cannot be done in the future.
      .bail().custom((value) => Object.entries(value).every(([key, entry]) => !VALIDITY_YEARS[key]
        || (entry.checked_on && entry.checked_on <= new Date().toISOString().slice(0, ISO_DATE_LENGTH))))
      .withMessage('volunteer_checked_on_required'),
    checkValidation, volunteerHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await recordRequirements(pool, organizationId, req.user.id, req.params.userId, req.body.verified),
        'volunteer_requirements_saved');
    }));

  // One's own place: the caller is the volunteer, never a body field.
  router.post('/:id/signups', blockDemoRoles, requirePermission('volunteers.view'), validateIdParam('id'), checkValidation,
    volunteerHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const { created, status, missing } = await signUp(pool, organizationId, Number(req.params.id), req.user.id);
      return success(res, { status, missing }, status === 'confirmed' ? 'volunteer_signed_up' : 'volunteer_pending',
        created ? HTTP_CREATED : HTTP_OK);
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
