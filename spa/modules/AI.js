import { getAuthHeader } from "../api/api-helpers.js";
import { debugError } from "../utils/DebugUtils.js";

const API_BASE = '/api/ai';

/**
 * Generate text using AI
 * @param {string} mode - 'meeting_plan' | 'rewrite' | 'translate' | 'risk_suggest'
 * @param {object} payload - Mode-specific payload
 * @returns {Promise<object>} - { data, usage, budget }
 */
export async function aiGenerateText(mode, payload) {
    try {
        const response = await fetch(`${API_BASE}/text`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
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
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(`${API_BASE}/receipt`, {
            method: 'POST',
            headers: {
                ...getAuthHeader()
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
