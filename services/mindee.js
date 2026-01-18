const mindee = require("mindee");
const { checkAndReserveBudget, recordUsage, releaseBudget } = require("./ai-budget");

// Initialize Mindee client
// NOTE: MINDEE_API_KEY must be in .env
// We initialize lazily or inside function if needed, but standard creates a global client usually.
// For node client 3.x/4.x:
let mindeeClient = null;
try {
    if (process.env.MINDEE_API_KEY) {
        mindeeClient = new mindee.Client({ apiKey: process.env.MINDEE_API_KEY });
    }
} catch (e) {
    console.warn("Mindee client init failed (missing key?)");
}

// Configurable cost per receipt (USD)
// Even if free tier, we can assign a "value" or set to 0.00
const COST_PER_RECEIPT_USD = 0.10;

/**
 * Parse a receipt image buffer
 */
async function parseReceipt(fileBuffer, originalFilename, userContext) {
    if (!mindeeClient) {
        throw new Error("Mindee API key not configured");
    }

    // 1. Check & Reserve Budget
    const isReserved = await checkAndReserveBudget(COST_PER_RECEIPT_USD);
    if (!isReserved) {
        throw { code: "AI_BUDGET_EXCEEDED", message: "Monthly AI budget cap reached." };
    }

    let success = false;
    let errorCode = null;

    try {
        // 2. Call Mindee
        const inputSource = mindeeClient.docFromBuffer(fileBuffer, originalFilename);
        const apiResponse = await mindeeClient.parse(
            mindee.product.ReceiptV5,
            inputSource
        );

        const doc = apiResponse.document;
        if (!doc) throw new Error("No document returned from Mindee");

        const prediction = doc.inference.prediction;

        // 3. Extract Data
        const data = {
            vendor: prediction.supplierName?.value || "",
            date: prediction.date?.value || null,
            total: prediction.totalAmount?.value || 0,
            tax: prediction.totalTax?.value || 0,
            currency: prediction.totalAmount?.currency || "CAD",
            lineItems: prediction.lineItems?.map(item => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.totalAmount
            })) || []
        };

        success = true;
        return {
            data,
            usage: {
                provider: "mindee",
                cost: COST_PER_RECEIPT_USD
            }
        };

    } catch (error) {
        errorCode = "MINDEE_ERROR";
        console.error("Mindee Error:", error);
        // Release budget if call failed
        await releaseBudget(COST_PER_RECEIPT_USD);
        throw error;
    } finally {
        // 4. Log Usage
        // Note: If successful, we DON'T release budget because we use fixed cost pricing
        await recordUsage({
            organization_id: userContext.organizationId,
            user_id: userContext.userId,
            provider: "mindee",
            feature: "receipt",
            model: "receipt-v5",
            estimated_cost_usd: success ? COST_PER_RECEIPT_USD : 0,
            success,
            error_code: errorCode
        });
    }
}

module.exports = { parseReceipt };
