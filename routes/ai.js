const express = require('express');
const multer = require('multer');
const router = express.Router();
const { authenticate, blockDemoRoles, getOrganizationId, requireAnyPermission } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { generateText, isAIConfigured } = require('../services/aiText');
const { parseReceipt } = require('../services/veryfi');
const { getBudgetStatus } = require('../services/ai-budget');
const { FILE_LIMITS } = require('../config/constants');
const { AI_MODES, validateAIPayload } = require('../utils/aiPayloadValidation');
const { sendAIFailure } = require('../utils/aiFailure');

// Every AI call spends the shared, paid budget, so it is limited to the staff
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

    let result;
    try {
      result = await generateText(mode, validation.value, await buildUserContext(req));
    } catch (err) {
      return sendAIFailure(res, err);
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
  requireAnyPermission(...AI_TEXT_PERMISSIONS, ...AI_RECEIPT_PERMISSIONS),
  asyncHandler(async (req, res) => {
    const status = await getBudgetStatus();
    return success(res, status);
  })
);

module.exports = router;
