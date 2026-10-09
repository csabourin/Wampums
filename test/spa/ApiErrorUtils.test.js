/**
 * @jest-environment jsdom
 *
 * A failed save is explained in the page's language. The server's `message`
 * is English, so screens ask ApiErrorUtils for a translation key instead.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => `t:${key}` }));

import { apiErrorMessage, apiErrorMessageKey } from '../../spa/utils/ApiErrorUtils.js';

/**
 * An error shaped like the one api-core throws.
 *
 * @param {Object} fields - status, code, isNetworkError
 * @returns {Error} API error
 */
function apiError(fields) {
  return Object.assign(new Error('API request failed: Insufficient permissions'), fields);
}

describe('apiErrorMessageKey', () => {
  test.each([
    [400, 'api_error_invalid'],
    [403, 'api_error_forbidden'],
    [404, 'api_error_not_found'],
    [409, 'api_error_conflict'],
    [413, 'api_error_too_large'],
  ])('a %i answer has its own explanation', (status, key) => {
    expect(apiErrorMessageKey(apiError({ status }), 'error_saving')).toBe(key);
  });

  test('a server error falls back to the screen\'s own message', () => {
    expect(apiErrorMessageKey(apiError({ status: 500 }), 'error_saving')).toBe('error_saving');
  });

  test('a write that never reached the server says so', () => {
    expect(apiErrorMessageKey(apiError({ isNetworkError: true }))).toBe('api_error_network');
    expect(apiErrorMessageKey(apiError({ code: 'online_required' }))).toBe('family_operation_online_required');
    expect(apiErrorMessageKey(apiError({ code: 'operation_unconfirmed', isNetworkError: true })))
      .toBe('family_operation_unconfirmed');
  });

  test('reads the status from the wrapped cause too', () => {
    const wrapped = new Error('outer', { cause: { status: 403 } });
    expect(apiErrorMessageKey(wrapped)).toBe('api_error_forbidden');
  });

  test('anything else uses the fallback, and the default fallback is generic', () => {
    expect(apiErrorMessageKey(new Error('boom'), 'error_saving_form')).toBe('error_saving_form');
    expect(apiErrorMessageKey(undefined)).toBe('error_occurred');
  });
});

describe('apiErrorMessage', () => {
  test('never returns the English server message', () => {
    const message = apiErrorMessage(apiError({ status: 403 }), 'error_saving');
    expect(message).toBe('t:api_error_forbidden');
    expect(message).not.toMatch(/Insufficient permissions/);
  });
});
