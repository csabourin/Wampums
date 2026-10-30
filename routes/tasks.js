/** Unit task management and the assignee's independent task list. */
const express = require('express');
const HTTP_CREATED = 201;
const { body } = require('express-validator');
const { authenticate, requirePermission, blockDemoRoles, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { validateIdBody, validateIdParam, checkValidation } = require('../middleware/validation');
const { TASK_STATUSES, TASK_TITLE_MAX_LENGTH, EQUIPMENT_REMINDERS: LIMITS } = require('../config/tasks');
const reminders = require('../services/taskEquipmentReminders');
const { TaskError, saveTask, changeTaskStatus, listTasks } = require('../services/activityTasks');

/** Return known task refusals, forwarding internal failures to the global handler. */
const taskHandler = (handler) => asyncHandler(async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    if (err instanceof TaskError) {
      const fields = err.message === 'tasks_assignee_inactive'
        ? [{ path: 'assignee_id', location: 'body', msg: err.message }] : null;
      return error(res, err.message, err.status, fields);
    }
    throw err;
  }
});

/** @param {Object} pool - pg pool @returns {Object} Router */
module.exports = (pool) => {
  const router = express.Router();
  router.use(authenticate);

  router.get('/mine', requirePermission('tasks.view'), taskHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await listTasks(pool, organizationId, req.user.id));
  }));
  router.get('/', requirePermission('tasks.manage'), taskHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await listTasks(pool, organizationId, null));
  }));
  // Deliberately minimal choices: no participant, contact, health or family records.
  router.get('/options', requirePermission('tasks.manage'), taskHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const [members, activities, meetings] = await Promise.all([
      pool.query(`SELECT u.id, u.full_name FROM users u JOIN user_organizations uo ON uo.user_id = u.id
        WHERE uo.organization_id = $1 AND uo.status = 'active' ORDER BY u.full_name, u.id`, [organizationId]),
      pool.query('SELECT id, name, activity_date::text AS date FROM activities WHERE organization_id = $1 AND is_active = TRUE ORDER BY activity_date DESC, id', [organizationId]),
      pool.query('SELECT id, theme AS name, meeting_date::text AS date FROM year_plan_meetings WHERE organization_id = $1 AND is_cancelled = FALSE ORDER BY meeting_date DESC, id', [organizationId]),
    ]);
    return success(res, { members: members.rows, activities: activities.rows, meetings: meetings.rows });
  }));

  const fields = () => [
    body('title').isString().bail().trim().isLength({ min: 1, max: TASK_TITLE_MAX_LENGTH }).withMessage('tasks_invalid_title'),
    body('assignee_id').isString().bail().isUUID().withMessage('tasks_assignee_inactive'),
    body('due_date').isString().bail().matches(/^\d{4}-\d{2}-\d{2}$/).bail().isDate({ format: 'YYYY-MM-DD', strictMode: true }).withMessage('tasks_invalid_date'),
    validateIdBody('activity_id').optional({ values: 'null' }).custom((value) => ['string', 'number'].includes(typeof value)),
    validateIdBody('meeting_id').optional({ values: 'null' }).custom((value) => ['string', 'number'].includes(typeof value)),
    body().custom((value) => Boolean(value.activity_id) !== Boolean(value.meeting_id)).withMessage('tasks_choose_event'),
    checkValidation,
  ];
  router.post('/', requirePermission('tasks.manage'), blockDemoRoles, fields(), taskHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    return success(res, await saveTask(pool, organizationId, req.user.id, req.body), 'tasks_saved', HTTP_CREATED);
  }));
  router.put('/:id', requirePermission('tasks.manage'), blockDemoRoles,
    // Sent when the same form then changes the reminder: the revision that form loaded.
    body('expected_reminder_revision').optional().isInt({ min: 0 }).custom((value) => Number.isInteger(value)),
    validateIdParam('id'), fields(), taskHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      return success(res, await saveTask(pool, organizationId, req.user.id, req.body, Number(req.params.id),
        { expectedReminderRevision: req.body.expected_reminder_revision }));
    }));

  const statusFields = () => [
    validateIdParam('id'),
    body('status').isString().bail().isIn(TASK_STATUSES).withMessage('tasks_invalid_status'),
    body('expected_status').isString().bail().isIn(TASK_STATUSES).withMessage('tasks_invalid_status'),
    checkValidation,
  ];
  /** Ownership is a query restriction, never a claim supplied by the caller. */
  const updateStatus = (ownOnly) => taskHandler(async (req, res) => {
    const organizationId = await getOrganizationId(req, pool);
    const saved = await changeTaskStatus(pool, { organizationId, actorId: req.user.id, ownOnly },
      Number(req.params.id), req.body.status, req.body.expected_status);
    return success(res, saved);
  });
  router.patch('/mine/:id/status', requirePermission('tasks.view'), blockDemoRoles, statusFields(), updateStatus(true));
  router.patch('/:id/status', requirePermission('tasks.manage'), blockDemoRoles, statusFields(), updateStatus(false));
  router.put('/:id/equipment-reminder', requirePermission('tasks.manage'), blockDemoRoles,
    validateIdParam('id'),
    body('enabled').isBoolean({ strict: true }),
    body('expected_revision').isInt({ min: 0 }).custom((value) => Number.isInteger(value)),
    body('materials').if(body('enabled').equals('true')).isString().bail().trim().isLength({ min: 1, max: LIMITS.MATERIALS_MAX_LENGTH }),
    body('lead_days').if(body('enabled').equals('true')).isInt({ min: 0, max: LIMITS.MAX_LEAD_DAYS }).custom((value) => Number.isInteger(value)),
    body('repeat_hours').if(body('enabled').equals('true')).isInt({ min: LIMITS.MIN_REPEAT_HOURS, max: LIMITS.MAX_REPEAT_HOURS }).custom((value) => Number.isInteger(value)),
    checkValidation, taskHandler(async (req, res) => success(res, await reminders.configure(pool,
      await getOrganizationId(req, pool), Number(req.params.id), req.body))));
  router.post('/mine/:id/equipment-confirmation', requirePermission('tasks.view'), blockDemoRoles,
    validateIdParam('id'), body('revision').isInt({ min: 1 }).custom((value) => Number.isInteger(value)), checkValidation,
    taskHandler(async (req, res) => success(res, await reminders.confirm(pool,
      await getOrganizationId(req, pool), Number(req.params.id), req.user.id, req.body.revision))));
  return router;
};
