'use strict';

/**
 * Answering a failed AI call. The provider's own message and status never
 * reach the browser: a provider's 401 (bad key) would read as an expired
 * session, and its text is English for developers.
 *
 * @module utils/aiFailure
 */
const { error } = require('../middleware/response');

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * @param {Object} res - Express response
 * @param {Error} err - Failure from an AI service
 * @returns {Object} The response
 * @throws {Error} A failure that is not the AI service's, for the error handler
 */
function sendAIFailure(res, err) {
  if (err.code === 'AI_BUDGET_EXCEEDED') {
    return error(res, 'ai_budget_exceeded', HTTP_TOO_MANY_REQUESTS, { code: 'AI_BUDGET_EXCEEDED' });
  }
  if (err.code === 'AI_NOT_CONFIGURED') {
    return error(res, 'ai_unavailable', HTTP_SERVICE_UNAVAILABLE, { code: 'AI_NOT_CONFIGURED' });
  }
  if (err.status === HTTP_TOO_MANY_REQUESTS || err.code === 'insufficient_quota' || err.code === 'rate_limit_exceeded') {
    return error(res, 'ai_rate_limited', HTTP_SERVICE_UNAVAILABLE, { code: 'AI_RATE_LIMITED' });
  }
  if (err.code === 'AI_INVALID_RESPONSE' || err.status) {
    console.error('AI service failure:', err.status || '', err.code || '');
    return error(res, 'ai_service_error', HTTP_BAD_GATEWAY, { code: 'AI_SERVICE_ERROR' });
  }
  throw err;
}

module.exports = { sendAIFailure };
