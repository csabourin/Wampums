import { getAuthHeader } from '../api/api-helpers.js';
import { debugError } from '../utils/DebugUtils.js';

/**
 * The error a failed AI call throws: its HTTP status and the server's
 * reason code (`AI_BUDGET_EXCEEDED`, `AI_RATE_LIMITED`, …), which
 * apiErrorMessage() turns into a translated explanation.
 *
 * @param {Response} response - The failed response
 * @param {Object} result - Its JSON body
 * @param {string} fallbackMessage - Developer-facing message
 * @returns {Error}
 */
function aiRequestError(response, result, fallbackMessage) {
  const error = new Error(fallbackMessage);
  const code = result?.errors?.code;
  error.status = response.status;
  if (code) {
    error.code = code;
    error.error = { code };
  }
  return error;
}

/**
 * Read a response body that may not be JSON (a proxy's error page).
 *
 * @param {Response} response
 * @returns {Promise<Object>}
 */
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

const API_BASE = '/api/v1/ai';

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

    const result = await readJson(response);

    if (!response.ok) {
      throw aiRequestError(response, result, 'AI request failed');
    }

    return result;
  } catch (error) {
    debugError('AI Generate Text Error:', error);
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

    const result = await readJson(response);

    if (!response.ok) {
      throw aiRequestError(response, result, 'Receipt parsing failed');
    }

    return result;
  } catch (error) {
    debugError('AI Parse Receipt Error:', error);
    throw error;
  }
}
