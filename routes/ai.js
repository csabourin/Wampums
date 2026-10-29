const express = require('express');
const multer = require('multer');
const router = express.Router();
const { authenticate, blockDemoRoles, getOrganizationId, requireAnyPermission, requirePermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { generateText, isAIConfigured } = require('../services/aiText');
const { parseReceipt } = require('../services/veryfi');
const { getBudgetStatus } = require('../services/ai-budget');
const { FILE_LIMITS } = require('../config/constants');
const { AI_MODES, validateAIPayload } = require('../utils/aiPayloadValidation');
const { sendAIFailure } = require('../utils/aiFailure');
const {
  listMaterialOptions, planMaterialChoices, readPlanMaterial, PLAN_ITEMS_PER_OUTING_MAX,
} = require('../services/equipmentCatalog');

// This general-purpose endpoint spends the shared budget and is limited to staff.
// Family packing-list translations use their dedicated, list-scoped endpoint.
// The staff
// features that offer it: message rewriting and translation (communications),
// meeting plans (meetings and activities) and receipt reading (finance).
const AI_TEXT_PERMISSIONS = ['communications.send', 'meetings.manage', 'activities.create', 'activities.edit'];
const AI_RECEIPT_PERMISSIONS = ['finance.manage'];

// Multer for receipt uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FILE_LIMITS.AI_MAX_FILE_SIZE }
});

const HTTP_BAD_REQUEST = 400;
const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * A meeting plan or an activity plan chooses its material among what the unit
 * has or may use (catalogue articles and accessible inventory), never
 * inventing any. The list is read here, from the unit of the token: the
 * client cannot supply it.
 *
 * @param {Object} pool - pg pool
 * @param {number} organizationId
 * @param {Object} payload - Validated meeting_plan payload (either request type), given availableMaterial
 * @returns {Promise<Map<string, Object>>} The choices offered, by ref
 */
async function offerUnitMaterial(pool, organizationId, payload) {
  const choices = planMaterialChoices(await listMaterialOptions(pool, organizationId));
  if (choices.length) {
    payload.availableMaterial = choices;
  }
  return new Map(choices.map((choice) => [choice.ref, choice]));
}

/**
 * Replace an activity plan's material by what it chose from the unit's list:
 * material_items for the whole activity, and no free-text list.
 *
 * @param {Object} plan - The model's answer
 * @param {Map<string, Object>} choices - What it was offered
 * @returns {Object} The plan
 */
function keepOfferedActivityMaterial(plan, choices) {
  const { materials, materialsMasterList: _invented, ...rest } = plan || {};
  return { ...rest, material_items: readPlanMaterial(materials, choices, PLAN_ITEMS_PER_OUTING_MAX) };
}

/**
 * Replace a meeting plan's material by what it chose from the unit's list:
 * each timeline item gets material_items, and no free-text material is kept.
 *
 * @param {Object} plan - The model's answer
 * @param {Map<string, Object>} choices - What it was offered
 * @returns {Object} The plan
 */
function keepOfferedMaterial(plan, choices) {
  const timeline = Array.isArray(plan?.timeline) ? plan.timeline : [];
  plan.timeline = timeline.map((item) => {
    const { materialItems, materiel: _materiel, materials: _materials, ...rest } = item || {};
    return { ...rest, materiel: '', material_items: readPlanMaterial(materialItems, choices) };
  });
  const named = new Set(plan.timeline.flatMap((item) => item.material_items.map((entry) => entry.name)));
  plan.materials = [...named];
  return plan;
}

// Middleware to build user context
const buildUserContext = async (req) => {
  const organizationId = await getOrganizationId(req, req.app?.locals?.pool || null);
  return {
    userId: req.user.id,
    organizationId: organizationId || null
  };
};

// POST /api/ai/text
// Payload: { mode, payload, locale }
// Mode: meeting_plan | rewrite | translate | risk_suggest
router.post(
  '/text',
  authenticate,
  blockDemoRoles,
  requirePermission({ permissions: ['ai.use'], organizationScope: true }),
  requireAnyPermission(...AI_TEXT_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const { mode, payload } = req.body || {};

    if (!AI_MODES.has(mode)) {
      return error(res, 'Invalid AI mode', HTTP_BAD_REQUEST);
    }

    const validation = validateAIPayload(mode, payload);
    if (validation.errors.length > 0) {
      return error(res, 'Invalid AI payload', HTTP_BAD_REQUEST, validation.errors);
    }

    if (!isAIConfigured()) {
      return error(res, 'ai_unavailable', HTTP_SERVICE_UNAVAILABLE, { code: 'AI_NOT_CONFIGURED' });
    }

    const userContext = await buildUserContext(req);
    const planning = mode === 'meeting_plan';
    const choices = planning && userContext.organizationId
      ? await offerUnitMaterial(req.app.locals.pool, userContext.organizationId, validation.value)
      : new Map();

    let result;
    try {
      result = await generateText(mode, validation.value, userContext);
    } catch (err) {
      return sendAIFailure(res, err);
    }
    if (choices.size > 0) {
      result.data = validation.value.requestType === 'activity_plan'
        ? keepOfferedActivityMaterial(result.data, choices)
        : keepOfferedMaterial(result.data, choices);
    }

    // Budget status rides along so the page can show what is left.
    const budgetStatus = await getBudgetStatus();
    return success(res, {
      ...result,
      budget: budgetStatus
    });
  })
);

// POST /api/ai/receipt
// Multipart file upload
router.post(
  '/receipt',
  authenticate,
  blockDemoRoles,
  requirePermission({ permissions: ['ai.use'], organizationScope: true }),
  requireAnyPermission(...AI_RECEIPT_PERMISSIONS),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return error(res, 'No file uploaded', HTTP_BAD_REQUEST);
    }

    try {
      const userContext = await buildUserContext(req);

      const result = await parseReceipt(req.file.buffer, req.file.originalname, userContext);
      const budgetStatus = await getBudgetStatus();

      // result contains { data: { vendor... }, usage: { ... } }
      // Flatten so frontend gets { vendor..., usage..., budget... }
      return success(res, {
        ...result.data,
        usage: result.usage,
        budget: budgetStatus
      });

    } catch (err) {
      return sendAIFailure(res, err);
    }
  })
);

// GET /api/ai/budget
// Check status
router.get(
  '/budget',
  authenticate,
  requirePermission({ permissions: ['ai.use'], organizationScope: true }),
  requireAnyPermission(...AI_TEXT_PERMISSIONS, ...AI_RECEIPT_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const status = await getBudgetStatus();
    return success(res, status);
  })
);

module.exports = router;
