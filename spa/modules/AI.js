import { getOrganizationId } from "../utils/Session.js"; // Assuming this exists or similar
import { debugError } from "../utils/DebugUtils.js";

const API_BASE = '/api/ai';

/**
 * Generate text using AI
 * @param {string} mode - 'meeting_plan' | 'rewrite' | 'translate' | 'risk_suggest'
 * @param {object} payload - Mode-specific payload
 * @returns {Promise<object>} - { data, usage, budget }
 */
export async function aiGenerateText(mode, payload) {
    const token = localStorage.getItem('jwt_token');
    const orgId = localStorage.getItem('organization_id'); // Or from a utility

    try {
        const response = await fetch(`${API_BASE}/text`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-Organization-ID': orgId
            },
            body: JSON.stringify({ mode, payload })
        });

        const result = await response.json();

        if (!response.ok) {
            const error = new Error(result.message || "AI request failed");
            error.error = result.error; // Pass full error object (e.g. code: AI_BUDGET_EXCEEDED)
            throw error;
        }

        return result;
    } catch (error) {
        debugError("AI Generate Text Error:", error);
        throw error;
    }
}

/**
 * Upload receipt for parsing
 * @param {File} file 
 * @returns {Promise<object>}
 */
export async function aiParseReceipt(file) {
    const token = localStorage.getItem('jwt_token');
    const orgId = localStorage.getItem('organization_id');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(`${API_BASE}/receipt`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Organization-ID': orgId
            },
            body: formData
        });

        const result = await response.json();

        if (!response.ok) {
            const error = new Error(result.message || "Receipt parsing failed");
            error.error = result.error;
            throw error;
        }

        return result;
    } catch (error) {
        debugError("AI Parse Receipt Error:", error);
        throw error;
    }
}
