/**
 * The AI assistant: text (meeting plans, rewriting, translation, risk ideas)
 * and receipt reading. Every call spends the unit's shared AI budget, so a
 * call made offline is refused rather than queued: its answer is only useful
 * to the person waiting for it.
 *
 * A refusal carries its status and the server's reason code
 * (AI_BUDGET_EXCEEDED, AI_RATE_LIMITED, …), which apiErrorMessage() explains.
 *
 * @module spa/api/api-ai
 */
import { API } from './api-core.js';

const ONLINE_ONLY = Object.freeze({ queueOffline: false });

/**
 * Generate text with the assistant.
 *
 * @param {string} mode - 'meeting_plan' | 'rewrite' | 'translate' | 'risk_suggest'
 * @param {Object} payload - Mode-specific payload (utils/aiPayloadValidation.js)
 * @returns {Promise<Object>} `{ success, data: { data, usage, budget } }`
 */
export function aiGenerateText(mode, payload) {
  return API.post('v1/ai/text', { mode, payload }, {}, ONLINE_ONLY);
}

/**
 * Read a receipt (vendor, date, total, tax).
 *
 * @param {File} file - Receipt image or PDF
 * @returns {Promise<Object>} `{ success, data: { vendor, total, tax, …, usage, budget } }`
 */
export function aiParseReceipt(file) {
  const formData = new FormData();
  formData.append('file', file);
  return API.post('v1/ai/receipt', formData, {}, ONLINE_ONLY);
}

/**
 * Ask the assistant which equipment an activity needs, from the unit's
 * inventory. Nothing is reserved: the answer only preselects items.
 *
 * @param {{description: string, date_from: string, date_to: string, locale: string}} request
 * @returns {Promise<Object>} `{ success, data: { items: [{ equipment_id, quantity, reason }], budget } }`
 */
export function suggestEquipment(request) {
  return API.post('v1/equipment-suggestions', request, {}, ONLINE_ONLY);
}
