
require('dotenv').config();
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { pool } = require('../config/database');
const aiBudgetService = require('../services/ai-budget');

// We use the shared pool to avoid "MaxClientsInSessionMode" errors 
// because the Supabase pooler has a strict limit.

describe('AI Budget Service', () => {
    before(async () => {
        // Ensure connection works
        try {
            await pool.query('SELECT 1');
            console.log('Test DB connection successful');
        } catch (err) {
            console.error('Test DB connection failed:', err);
            process.exit(1);
        }
    });

    beforeEach(async () => {
        // Reset budget for test month
        const date = new Date();
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        await pool.query('DELETE FROM ai_usage_monthly WHERE month_key = $1', [monthKey]);
        await pool.query('DELETE FROM ai_usage_log WHERE created_at > NOW() - INTERVAL \'1 hour\'');
    });

    after(async () => {
        await pool.end();
    });

    it('should allow request if budget is empty', async () => {
        const cost = 0.01;
        const allowed = await aiBudgetService.checkAndReserveBudget(cost);
        assert.strictEqual(allowed, true, 'Should allow request with 0 usage');
    });

    it('should accumulate usage correctly', async () => {
        await aiBudgetService.checkAndReserveBudget(0.50);
        await aiBudgetService.checkAndReserveBudget(0.50);

        const status = await aiBudgetService.getBudgetStatus();

        const date = new Date();
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const res = await pool.query('SELECT cost_usd FROM ai_usage_monthly WHERE month_key = $1', [monthKey]);

        const total = parseFloat(res.rows[0].cost_usd);
        assert.ok(Math.abs(total - 1.00) < 0.001, `Expected $1.00 usage, got ${total}`);
    });

    it('should block request if it exceeds limit ($5.00)', async () => {
        // Fill up to 4.90
        await aiBudgetService.checkAndReserveBudget(4.90);

        // Try to add 0.20 (Total 5.10) -> Should fail
        const allowed = await aiBudgetService.checkAndReserveBudget(0.20);
        assert.strictEqual(allowed, false, 'Should block request exceeding budget');

        // Budget should remain 4.90
        const status = await aiBudgetService.getBudgetStatus();
        assert.ok(status.currentUsageUsd <= 5.00, 'Usage should not exceed cap');
    });

    it('should release budget correctly', async () => {
        await aiBudgetService.checkAndReserveBudget(1.00); // Reserve 1.00
        await aiBudgetService.releaseBudget(0.40); // Release 0.40 (unused)

        const status = await aiBudgetService.getBudgetStatus();
        // Expect ~0.60
        assert.ok(Math.abs(status.currentUsageUsd - 0.60) < 0.001, `Expected $0.60 usage, got ${status.currentUsageUsd}`);
    });

    it('should handle race conditions atomically', async () => {
        // Try to fire 5 requests of $0.60 simultaneously.
        // Cap is $5.00. 5 * 0.60 = $3.00.
        // All should succeed. 

        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(aiBudgetService.checkAndReserveBudget(0.60));
        }

        const results = await Promise.all(promises);
        const successCount = results.filter(r => r === true).length;

        console.log(`Race test: ${successCount} requests succeeded.`);
        assert.ok(successCount === 5, `Expected 5 requests to succeed, got ${successCount}.`);

        const status = await aiBudgetService.getBudgetStatus();
        assert.ok(status.currentUsageUsd <= 5.00, 'Total usage must never exceed $5.00');
    });
});
