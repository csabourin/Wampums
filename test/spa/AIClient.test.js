/** @jest-environment jsdom */

/**
 * The AI assistant goes through the shared API client. A refused request
 * carries its status and the server's reason, so the screen explains it
 * ("budget reached", "busy") instead of a generic error; offline, a request
 * is refused rather than queued, since only the person waiting needs it.
 *
 * @module test/spa/AIClient
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { API_BASE_URL: 'https://unit.example.test', ONLINE_REQUIRED_MUTATION_RESOURCES: [] },
}));
jest.mock('../../spa/jwt-helper.js', () => ({ getOrganizationIdFromJWT: () => null, getUserInfoFromJWT: () => ({}) }));
jest.mock('../../spa/indexedDB.js', () => ({
  setCachedData: jest.fn(), getCachedData: jest.fn(() => Promise.resolve(null)),
  getCachedDataIgnoreExpiration: jest.fn(() => Promise.resolve(null)),
  clearCachedApiPaths: jest.fn(), clearCacheEntriesWhere: jest.fn(),
}));
jest.mock('../../spa/utils/PerformanceUtils.js', () => ({ PerformanceMonitor: { logAPICall: jest.fn() } }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({
  offlineManager: { isOffline: false, queueMutation: jest.fn(), getTranslation: (key) => key },
}));

import { aiGenerateText, aiParseReceipt } from '../../spa/api/api-ai.js';
import { apiErrorMessage } from '../../spa/utils/ApiErrorUtils.js';
import { offlineManager } from '../../spa/modules/OfflineManager.js';

/** Answer the next request with this status and JSON body. */
function respond(status, body) {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: () => Promise.resolve(body),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  offlineManager.isOffline = false;
});

test('the assistant\'s answer comes back as the server sent it', async () => {
  respond(200, { success: true, data: { data: { text: 'Bonjour' }, usage: {}, budget: {} } });

  const response = await aiGenerateText('rewrite', { text: 'Salut', tone: 'professional' });

  expect(response.data.data.text).toBe('Bonjour');
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toContain('/api/v1/ai/text');
  expect(JSON.parse(init.body)).toEqual({ mode: 'rewrite', payload: { text: 'Salut', tone: 'professional' } });
});

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

test('offline, a request is refused, never queued to spend the budget later', async () => {
  offlineManager.isOffline = true;

  await expect(aiGenerateText('rewrite', { text: 'Salut', tone: 'professional' }))
    .rejects.toMatchObject({ code: 'online_required' });
  await expect(aiParseReceipt(new File(['x'], 'receipt.jpg')))
    .rejects.toMatchObject({ code: 'online_required' });
  expect(offlineManager.queueMutation).not.toHaveBeenCalled();
});

test('a receipt is sent as a file upload', async () => {
  respond(200, { success: true, data: { vendor: 'Canadian Tire', total: 12.5 } });

  await aiParseReceipt(new File(['x'], 'receipt.jpg', { type: 'image/jpeg' }));

  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toContain('/api/v1/ai/receipt');
  expect(init.body).toBeInstanceOf(FormData);
  expect(init.body.get('file').name).toBe('receipt.jpg');
});
