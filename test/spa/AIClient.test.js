/**
 * @jest-environment jsdom
 */

/**
 * A refused AI request carries its status and the server's reason, so the
 * screen explains it ("budget reached", "busy") instead of a generic error.
 *
 * @module test/spa/AIClient
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/api/api-helpers.js', () => ({ getAuthHeader: () => ({ Authorization: 'Bearer t' }) }));

const { aiGenerateText } = require('../../spa/modules/AI.js');
const { apiErrorMessage } = require('../../spa/utils/ApiErrorUtils.js');

/** Answer the next fetch with this status and body. */
function respond(status, body) {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }));
}

test.each([
  [429, 'AI_BUDGET_EXCEEDED', 'ai_budget_exceeded'],
  [503, 'AI_RATE_LIMITED', 'ai_rate_limited'],
  [503, 'AI_NOT_CONFIGURED', 'ai_unavailable'],
  [502, 'AI_SERVICE_ERROR', 'ai_service_error'],
])('a %i with %s is explained as %s', async (status, code, key) => {
  respond(status, { success: false, message: 'English for developers', errors: { code } });

  const failure = await aiGenerateText('rewrite', { text: 'Salut', tone: 'professional' }).catch((error) => error);

  expect(failure.status).toBe(status);
  expect(apiErrorMessage(failure, 'error_occurred')).toBe(key);
});

test('a response that is not JSON still fails cleanly', async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: false, status: 502, json: () => Promise.reject(new SyntaxError('Unexpected token <')),
  }));

  const failure = await aiGenerateText('rewrite', { text: 'Salut', tone: 'professional' }).catch((error) => error);

  expect(failure.status).toBe(502);
  expect(apiErrorMessage(failure, 'error_occurred')).not.toBe('English for developers');
});
