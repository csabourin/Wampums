'use strict';

/**
 * Parent onboarding endpoints: where a family registers its own children.
 *
 * Everything here is gated on `participants.create_own`, never on
 * `participants.create`. The broad key lets its holder add anyone to the unit;
 * this one lets a parent add a child to their own family, and the service
 * behind these routes is what makes that difference real — a child created
 * here is linked to the parent who created it in the same transaction, or not
 * created at all.
 *
 * @module routes/parentOnboarding
 */

const express = require('express');
const { body } = require('express-validator');

const {
  authenticate,
  requirePermission,
  blockDemoRoles,
  getOrganizationId,
} = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { checkValidation } = require('../middleware/validation');
const {
  CHILD_RESULT,
  createChild,
  getOnboardingContext,
  completeOnboarding,
} = require('../services/parentOnboarding');

/**
 * Read a boolean that may arrive as JSON `true` or as a form string.
 *
 * @param {*} value - Raw body value
 * @returns {boolean} True only for an explicit yes
 */
function isConfirmed(value) {
  return value === true || value === 'true';
}

module.exports = (pool, logger) => {
  const router = express.Router();

  /**
   * Where this parent stands: their unit, this year, the children their family
   * can already see, and whether onboarding is still waiting on them.
   */
  router.get('/context',
    authenticate,
    requirePermission('participants.create_own'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const context = await getOnboardingContext(pool, req.user.id, organizationId);
      return success(res, context);
    })
  );

  /**
   * Register a child for this parent's family.
   *
   * Answers:
   * - 201 `created` — a new child, enrolled this year and shared with the family
   * - 200 `reenrolled` — a child the family already had, back on this year's roster
   * - 200 `enrolled_existing` — the parent's child from another unit, enrolled
   *   here as the same person rather than created again
   * - 409 `duplicate_child` — already registered this year
   * - 409 `similar_child_exists` — a child of the same name with another birth
   *   date; resubmit with `confirm_similar: true` if this is a different child
   * - 400 — the details are unusable
   */
  router.post('/children',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.create_own'),
    body('first_name').isString().trim().notEmpty(),
    body('last_name').isString().trim().notEmpty(),
    body('date_naissance').isISO8601({ strict: true }),
    body('confirm_similar').optional({ nullable: true }).isBoolean(),
    checkValidation,
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);

      const outcome = await createChild(pool, {
        userId: req.user.id,
        organizationId,
        firstName: req.body.first_name,
        lastName: req.body.last_name,
        dateOfBirth: String(req.body.date_naissance).slice(0, 10),
        confirmSimilar: isConfirmed(req.body.confirm_similar),
      });

      switch (outcome.result) {
        case CHILD_RESULT.CREATED:
          logger?.info('Parent registered a child', {
            organizationId,
            participantId: outcome.participant_id,
          });
          return success(res, outcome, 'Child registered', 201);
        case CHILD_RESULT.REENROLLED:
          return success(res, outcome, 'Child re-enrolled for this year');
        case CHILD_RESULT.ENROLLED_EXISTING:
          return success(res, outcome, 'Child already known from another unit, now enrolled in this one');
        case CHILD_RESULT.DUPLICATE:
          return res.status(409).json({
            success: false,
            code: CHILD_RESULT.DUPLICATE,
            message: 'This child is already registered for this year',
            data: outcome,
            timestamp: new Date().toISOString(),
          });
        case CHILD_RESULT.SIMILAR:
          return res.status(409).json({
            success: false,
            code: CHILD_RESULT.SIMILAR,
            message: 'A child with this name is already in your family. Confirm if this is a different child.',
            data: outcome,
            timestamp: new Date().toISOString(),
          });
        case CHILD_RESULT.INVALID:
          return error(res, outcome.error, 400, [{ path: 'child', msg: outcome.error }]);
        default:
          throw new Error(`Unhandled child creation result: ${outcome.result}`);
      }
    })
  );

  /**
   * The parent is done adding children for now. Stops the app from sending
   * them back to this screen on their next sign-in.
   */
  router.post('/complete',
    authenticate,
    blockDemoRoles,
    requirePermission('participants.create_own'),
    asyncHandler(async (req, res) => {
      const organizationId = await getOrganizationId(req, pool);
      const completed = await completeOnboarding(pool, req.user.id, organizationId);
      return success(res, { completed }, completed ? 'Onboarding completed' : 'Nothing was pending');
    })
  );

  return router;
};
