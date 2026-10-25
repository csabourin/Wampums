/**
 * Equipment suggestions — the assistant proposes the equipment an activity
 * needs, from the unit's inventory. The leader reviews and reserves; nothing
 * is reserved here.
 *
 * Mounted at /api/v1/equipment-suggestions.
 *
 * @module routes/equipmentSuggestions
 */
const express = require('express');
const { check } = require('express-validator');

const { authenticate, getOrganizationId, requirePermission, blockDemoRoles } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { checkValidation } = require('../middleware/validation');
const { isAIConfigured } = require('../services/aiText');
const { suggestEquipment } = require('../services/equipmentSuggestions');
const { getBudgetStatus } = require('../services/ai-budget');
const { sendAIFailure } = require('../utils/aiFailure');
const interfaceLanguages = require('../config/interface_languages.json');

const HTTP_BAD_REQUEST = 400;
const HTTP_SERVICE_UNAVAILABLE = 503;
const MIN_DESCRIPTION_LENGTH = 3;
const MAX_DESCRIPTION_LENGTH = 1000;
const LOCALES = [...interfaceLanguages.core, ...interfaceLanguages.optional];
// eslint-disable-next-line no-control-regex -- refuses control characters, as the other AI requests do
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
/** Characters of YYYY-MM-DD at the start of an ISO 8601 date. */
const ISO_DATE_LENGTH = 10;

/** Asking takes the right to reserve; it spends the shared AI budget. */
const SUGGEST_POLICY = { permissions: ['inventory.reserve'], organizationScope: true };

module.exports = (pool) => {
  const router = express.Router();

  router.post(
    '/',
    authenticate,
    blockDemoRoles,
    requirePermission(SUGGEST_POLICY),
    [
      check('description').isString().trim().isLength({ min: MIN_DESCRIPTION_LENGTH, max: MAX_DESCRIPTION_LENGTH })
        .custom((value) => !CONTROL_CHARACTERS.test(value)),
      check('date_from').isISO8601({ strict: true }),
      check('date_to').isISO8601({ strict: true }),
      check('locale').optional().isIn(LOCALES),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      const dateFrom = String(req.body.date_from).slice(0, ISO_DATE_LENGTH);
      const dateTo = String(req.body.date_to).slice(0, ISO_DATE_LENGTH);
      if (dateFrom > dateTo) {
        return error(res, 'invalid_request', HTTP_BAD_REQUEST);
      }
      if (!isAIConfigured()) {
        return error(res, 'ai_unavailable', HTTP_SERVICE_UNAVAILABLE, { code: 'AI_NOT_CONFIGURED' });
      }
      const organizationId = await getOrganizationId(req, pool);

      let result;
      try {
        result = await suggestEquipment(pool, {
          organizationId,
          userId: req.user.id,
          description: req.body.description.trim(),
          dateFrom,
          dateTo,
          locale: req.body.locale || 'fr',
        });
      } catch (err) {
        return sendAIFailure(res, err);
      }
      return success(res, { items: result.items, budget: await getBudgetStatus() });
    }),
  );

  return router;
};
