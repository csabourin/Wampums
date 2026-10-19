const Client = require('@veryfi/veryfi-sdk');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkAndReserveBudget, recordUsage, releaseBudget } = require('./ai-budget');

// Initialize Veryfi client (lazy-init to avoid noise in test environment)
let veryfiClient = null;
let veryfiInitialized = false;

function initVeryfiClient() {
  if (veryfiInitialized) {
    return;
  }
  veryfiInitialized = true;

  // Skip initialization in test environment
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
    return;
  }

  try {
    const clientId = process.env.VERYFI_CLIENT_ID;
    const clientSecret = process.env.VERYFI_CLIENT_SECRET;
    const username = process.env.VERYFI_USERNAME;
    const apiKey = process.env.VERYFI_API_KEY;

    if (clientId && clientSecret && username && apiKey) {
      veryfiClient = new Client(clientId, clientSecret, username, apiKey);
      console.log('Veryfi client initialized successfully');
    } else {
      console.warn('Veryfi credentials missing in environment variables');
    }
  } catch (e) {
    console.warn('Veryfi client init failed:', e.message);
  }
}

const RECEIPT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.tif', '.tiff', '.pdf']);

/**
 * The uploaded file's extension when it is a receipt format, else none.
 *
 * @param {string} originalFilename - Name the client gave the upload
 * @returns {string} '.jpg', '.pdf', … or ''
 */
function receiptExtension(originalFilename) {
  const extension = path.extname(String(originalFilename || '')).toLowerCase();
  return RECEIPT_EXTENSIONS.has(extension) ? extension : '';
}

// Configurable cost per receipt (USD) - Approximate cost per receipt for Veryfi or budget allocation
const COST_PER_RECEIPT_USD = 0.10;

/**
 * Parse a receipt image buffer using Veryfi
 */
async function parseReceipt(fileBuffer, originalFilename, userContext) {
  let budgetReserved = false;

  // Initialize Veryfi client on first use (lazy-init)
  initVeryfiClient();

  if (!veryfiClient) {
    console.error('Veryfi Error: Credentials not configured');
    const notConfigured = new Error('Veryfi credentials not configured');
    notConfigured.code = 'AI_NOT_CONFIGURED';
    throw notConfigured;
  }

  // 1. Check & Reserve Budget
  const isReserved = await checkAndReserveBudget(COST_PER_RECEIPT_USD);
  if (!isReserved) {
    throw { code: 'AI_BUDGET_EXCEEDED', message: 'Monthly AI budget cap reached.' };
  }
  budgetReserved = true;

  let success = false;
  let errorCode = null;

  try {
    console.log('Calling Veryfi API...');

    // The SDK reads a file path, so the upload goes through a temp file. Its
    // name is random: the client's file name never reaches the path, only an
    // extension from a fixed list, which Veryfi uses to tell the format.
    const tempFilePath = path.join(os.tmpdir(), `veryfi_${crypto.randomUUID()}${receiptExtension(originalFilename)}`);
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
      if (!dateStr) {return null;}
      return dateStr.substring(0, 10);
    };

    const data = {
      vendor: apiResponse.vendor?.name || '',
      date: formatDate(apiResponse.date || apiResponse.created_date),
      total: apiResponse.total || 0,
      tax: apiResponse.tax || 0,
      currency: apiResponse.currency_code || 'CAD',
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
        provider: 'veryfi',
        cost: COST_PER_RECEIPT_USD
      }
    };

  } catch (error) {
    errorCode = 'VERYFI_ERROR';
    console.error('Veryfi Error:', error.message);
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
      provider: 'veryfi',
      feature: 'receipt',
      model: 'ocr',
      estimated_cost_usd: success ? COST_PER_RECEIPT_USD : 0,
      success,
      error_code: errorCode
    });
  }
}

module.exports = { parseReceipt, receiptExtension };
