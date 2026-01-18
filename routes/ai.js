const express = require("express");
const multer = require("multer");
const router = express.Router();
const { authenticate, getOrganizationId } = require("../middleware/auth");
const { success, error, asyncHandler } = require("../middleware/response");
const { generateText } = require("../services/openai");
const { parseReceipt } = require("../services/mindee");
const { getBudgetStatus } = require("../services/ai-budget");

// Multer for receipt uploads (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware to build user context
const buildUserContext = async (req) => {
    const organizationId = await getOrganizationId(req, null); // passing null for pool as it might not be needed by getOrganizationId depending on implementation, checking that later
    return {
        userId: req.user.id,
        organizationId: organizationId || null
    };
};

// POST /api/ai/text
// Payload: { mode, payload, locale }
// Mode: meeting_plan | rewrite | translate | risk_suggest
router.post(
    "/text",
    authenticate,
    asyncHandler(async (req, res) => {
        const { mode, payload } = req.body;

        // Basic validation
        if (!["meeting_plan", "rewrite", "translate", "risk_suggest"].includes(mode)) {
            return error(res, "Invalid AI mode", 400);
        }

        try {
            const userContext = {
                userId: req.user.id,
                organizationId: req.headers['x-organization-id'] || null // Simplified for now, usually getOrganizationId middleware handles this
            };

            const result = await generateText(mode, payload, userContext);

            // Append budget status to response for UI awareness
            const budgetStatus = await getBudgetStatus();

            return success(res, {
                ...result,
                budget: budgetStatus
            });

        } catch (err) {
            if (err.code === "AI_BUDGET_EXCEEDED") {
                return error(res, err.message, 429, { code: "AI_BUDGET_EXCEEDED" });
            }
            throw err;
        }
    })
);

// POST /api/ai/receipt
// Multipart file upload
router.post(
    "/receipt",
    authenticate,
    upload.single("file"),
    asyncHandler(async (req, res) => {
        if (!req.file) {
            return error(res, "No file uploaded", 400);
        }

        try {
            const userContext = {
                userId: req.user.id,
                organizationId: req.headers['x-organization-id'] || null
            };

            const result = await parseReceipt(req.file.buffer, req.file.originalname, userContext);

            const budgetStatus = await getBudgetStatus();

            return success(res, {
                ...result,
                budget: budgetStatus
            });

        } catch (err) {
            if (err.code === "AI_BUDGET_EXCEEDED") {
                return error(res, err.message, 429, { code: "AI_BUDGET_EXCEEDED" });
            }
            throw err;
        }
    })
);

// GET /api/ai/budget
// Check status
router.get(
    "/budget",
    authenticate,
    asyncHandler(async (req, res) => {
        const status = await getBudgetStatus();
        return success(res, status);
    })
);

module.exports = router;
