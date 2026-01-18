/**
 * AI Budget Service
 * Enforces strict monthly budget cap for AI features.
 */
const { pool } = require("../config/database");

const BUDGET_CAP_USD = 5.00;

/**
 * Get current UTC month key in 'YYYY-MM' format
 */
function getCurrentMonthKey() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Checks if budget is available and reserves the estimated cost.
 * Uses atomic update to prevent race conditions.
 * 
 * @param {number} estimatedCostUsd - Estimated cost of the operation
 * @returns {Promise<boolean>} - True if reserved successfully, false if cap exceeded
 */
async function checkAndReserveBudget(estimatedCostUsd) {
    const monthKey = getCurrentMonthKey();

    // Ensure we ensure the month row exists (idempotent)
    await pool.query(
        `INSERT INTO ai_usage_monthly (month_key, cost_usd, request_count) 
     VALUES ($1, 0, 0) ON CONFLICT (month_key) DO NOTHING`,
        [monthKey]
    );

    // Atomic update: only increment if new total <= CAP
    const result = await pool.query(
        `UPDATE ai_usage_monthly
     SET cost_usd = cost_usd + $1,
         request_count = request_count + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE month_key = $2
       AND (cost_usd + $1) <= $3
     RETURNING cost_usd`,
        [estimatedCostUsd, monthKey, BUDGET_CAP_USD]
    );

    return result.rowCount > 0;
}

/**
 * Releases reserved budget in case of failure or over-estimation using atomic update.
 * Used for reconciliation.
 * 
 * @param {number} amountToReleaseUsd - Amount to subtract (positive number)
 */
async function releaseBudget(amountToReleaseUsd) {
    if (amountToReleaseUsd <= 0) return;
    const monthKey = getCurrentMonthKey();

    await pool.query(
        `UPDATE ai_usage_monthly
     SET cost_usd = GREATEST(0, cost_usd - $1),
         updated_at = CURRENT_TIMESTAMP
     WHERE month_key = $2`,
        [amountToReleaseUsd, monthKey]
    );
}

/**
 * Records the final usage details in the audit log.
 */
async function recordUsage({
    organization_id,
    user_id,
    provider,
    feature,
    model,
    input_tokens = 0,
    output_tokens = 0,
    estimated_cost_usd,
    success,
    error_code
}) {
    const monthKey = getCurrentMonthKey();

    try {
        await pool.query(
            `INSERT INTO ai_usage_log 
       (month_key, organization_id, user_id, provider, feature, model, input_tokens, output_tokens, estimated_cost_usd, success, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                monthKey,
                organization_id || null,
                user_id || null,
                provider,
                feature,
                model,
                input_tokens,
                output_tokens,
                estimated_cost_usd,
                success,
                error_code
            ]
        );
    } catch (err) {
        console.error("Failed to log AI usage:", err);
        // Don't throw here to avoid failing the user request just because logging failed,
        // but in a real strict system you might want to.
    }
}

/**
 * Returns current budget status
 */
async function getBudgetStatus() {
    const monthKey = getCurrentMonthKey();
    const res = await pool.query(
        `SELECT cost_usd, request_count FROM ai_usage_monthly WHERE month_key = $1`,
        [monthKey]
    );

    const currentUsage = res.rows.length > 0 ? parseFloat(res.rows[0].cost_usd) : 0;

    return {
        monthKey,
        currentUsageUsd: currentUsage,
        capUsd: BUDGET_CAP_USD,
        remainingUsd: Math.max(0, BUDGET_CAP_USD - currentUsage),
        isCapReached: currentUsage >= BUDGET_CAP_USD
    };
}

module.exports = {
    checkAndReserveBudget,
    releaseBudget,
    recordUsage,
    getBudgetStatus,
    BUDGET_CAP_USD
};
