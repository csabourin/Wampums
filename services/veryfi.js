const Client = require('@veryfi/veryfi-sdk');
const { CQ } = require('@veryfi/veryfi-sdk'); // Check if required, usually Client is default export or named. documentation says const Client = require('@veryfi/veryfi-sdk');
const { checkAndReserveBudget, recordUsage, releaseBudget } = require("./ai-budget");

// Initialize Veryfi client
let veryfiClient = null;

try {
    const clientId = process.env.VERYFI_CLIENT_ID;
    const clientSecret = process.env.VERYFI_CLIENT_SECRET;
    const username = process.env.VERYFI_USERNAME;
    const apiKey = process.env.VERYFI_API_KEY;

    if (clientId && clientSecret && username && apiKey) {
        veryfiClient = new Client(clientId, clientSecret, username, apiKey);
        console.log("Veryfi client initialized successfully");
    } else {
        console.warn("Veryfi credentials missing in environment variables");
    }
} catch (e) {
    console.warn("Veryfi client init failed:", e.message);
}

// Configurable cost per receipt (USD) - Approximate cost per receipt for Veryfi or budget allocation
const COST_PER_RECEIPT_USD = 0.10;

/**
 * Parse a receipt image buffer using Veryfi
 */
async function parseReceipt(fileBuffer, originalFilename, userContext) {
    let budgetReserved = false;

    if (!veryfiClient) {
        console.error("Veryfi Error: Credentials not configured");
        throw new Error("Veryfi credentials not configured");
    }

    // 1. Check & Reserve Budget
    const isReserved = await checkAndReserveBudget(COST_PER_RECEIPT_USD);
    if (!isReserved) {
        throw { code: "AI_BUDGET_EXCEEDED", message: "Monthly AI budget cap reached." };
    }
    budgetReserved = true;

    let success = false;
    let errorCode = null;

    try {
        console.log("Calling Veryfi API...");

        // Convert buffer to base64 for upload
        const fileBase64 = fileBuffer.toString('base64');

        // 2. Call Veryfi
        // process_document(file_path, categories, delete_after_processing, parameters)
        // or process_document_buffer(file_base64, file_name, categories, delete_after_processing, parameters)
        // The SDK usually exposes process_document method that handles base64 if passed strictly or we use a specific method.
        // Looking at common usage: client.process_document(file_path) or client.process_document_url(url)
        // For buffer/base64, standard SDKs might have specific methods. 
        // Based on search results, we should check if there is a direct buffer method.
        // If not, we might need to write to temp file. Let's try to assume common SDK pattern or temp file.
        // To be safe and compliant with the "don't write to tmp unless essential" rule, let's see if we can pass base64.
        // The Veryfi Node SDK source (index.js) usually has process_document which takes file_path. 
        // Newer versions might support base64 string as first arg if we pass correct params.
        // Let's use a temp string to be safe if the SDK requires a path, BUT wait, checking Docs...
        // Actually, many node SDKs accept base64. Let's try `process_document` with base64 string and file_name.
        // Wait, looking at online samples for veryfi-nodejs, it often uses `process_document(file_path)`
        // However, there is often `process_document_buffer` or similar.
        // Let's try to use a temp file to be 100% sure it works without guessing SDK internals on the fly.

        // Actually, let's try `process_document_from_buffer` if it exists, or submit as base64.
        // Checking the search result again: "process a document from a local file using process_document".
        // Let's use a temp file.

        const fs = require('fs');
        const path = require('path');
        const os = require('os');

        const tempFilePath = path.join(os.tmpdir(), `veryfi_${Date.now()}_${originalFilename}`);
        fs.writeFileSync(tempFilePath, fileBuffer);

        let apiResponse;
        try {
            apiResponse = await veryfiClient.process_document(tempFilePath);
        } finally {
            // Clean up temp file
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        }

        // 3. Extract Data
        // Veryfi returns a JSON with fields like 'vendor', 'date', 'total', 'tax', 'line_items'
        // Helper to format date as YYYY-MM-DD
        const formatDate = (dateStr) => {
            if (!dateStr) return null;
            return dateStr.substring(0, 10);
        };

        const data = {
            vendor: apiResponse.vendor?.name || "",
            date: formatDate(apiResponse.date || apiResponse.created_date),
            total: apiResponse.total || 0,
            tax: apiResponse.tax || 0,
            currency: apiResponse.currency_code || "CAD",
            lineItems: apiResponse.line_items?.map(item => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.price,
                total: item.total
            })) || []
        };

        success = true;
        return {
            data,
            usage: {
                provider: "veryfi",
                cost: COST_PER_RECEIPT_USD
            }
        };

    } catch (error) {
        errorCode = "VERYFI_ERROR";
        console.error("Veryfi Error:", error.message);
        // Release budget if call failed AND it was reserved
        if (budgetReserved) {
            await releaseBudget(COST_PER_RECEIPT_USD);
        }
        throw error;
    } finally {
        // 4. Log Usage
        await recordUsage({
            organization_id: userContext.organizationId,
            user_id: userContext.userId,
            provider: "veryfi",
            feature: "receipt",
            model: "ocr",
            estimated_cost_usd: success ? COST_PER_RECEIPT_USD : 0,
            success,
            error_code: errorCode
        });
    }
}

module.exports = { parseReceipt };
