/**
 * @jest-environment jsdom
 */

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugError: jest.fn(),
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => {
    element.innerHTML = html;
  }
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  getApiUrl: (endpoint) => `/api/${endpoint}`
}));

import { ResetPassword } from '../../spa/reset_password.js';

const TOKEN = 'b'.repeat(64);

/**
 * Make the next fetch answer with a status and body.
 *
 * @param {number} status - HTTP status
 * @param {Object} body - JSON body
 * @returns {void}
 */
function respondWith(status, body) {
  global.fetch = jest.fn().mockResolvedValue({
    status,
    json: () => Promise.resolve(body)
  });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

test('the reset step shows the account address as the username password managers save', async () => {
  respondWith(200, { success: true, data: { email: 'parent@example.org' } });

  await new ResetPassword({}).render(TOKEN);

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/v1/auth/reset-password/describe',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: TOKEN }) })
  );

  const form = document.getElementById('reset-password-form');
  const username = form.querySelector('#reset-email');
  expect(username.value).toBe('parent@example.org');
  expect(username.readOnly).toBe(true);
  expect(username.disabled).toBe(false);
  expect(username.getAttribute('autocomplete')).toBe('username');
  expect(document.querySelector('label[for="reset-email"]')).not.toBeNull();

  // The username comes before the new password, inside the same form.
  const fields = [...form.querySelectorAll('input:not([type="hidden"])')].map((input) => input.id);
  expect(fields).toEqual(['reset-email', 'new-password', 'confirm-password']);
  expect(form.querySelector('#new-password').getAttribute('autocomplete')).toBe('new-password');
});

test('an expired link goes back to asking for the address, with the reason', async () => {
  respondWith(400, { success: false, message: 'invalid_or_expired_token' });

  await new ResetPassword({}).render(TOKEN);

  expect(document.getElementById('new-password')).toBeNull();
  expect(document.getElementById('email').getAttribute('autocomplete')).toBe('username');
  expect(document.getElementById('message').textContent).toBe('invalid_or_expired_token');
});

test('if the lookup cannot be reached, the reset can still be attempted', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

  await new ResetPassword({}).render(TOKEN);

  expect(document.getElementById('reset-email')).toBeNull();
  expect(document.getElementById('new-password')).not.toBeNull();
  expect(document.getElementById('token').value).toBe(TOKEN);
});

test('without a token, no lookup is made', async () => {
  global.fetch = jest.fn();

  await new ResetPassword({}).render();

  expect(global.fetch).not.toHaveBeenCalled();
  expect(document.getElementById('email')).not.toBeNull();
});
