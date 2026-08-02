/**
 * @jest-environment jsdom
 */

const translations = {
  register: 'Create account',
  loading: 'Loading...',
  passwords_do_not_match: 'Passwords do not match',
  error_creating_account: 'Could not create account',
  registration_successful_parent: 'Account created'
};

jest.mock('../../spa/app.js', () => ({
  translate: (key) => translations[key] || key
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

const mockRegister = jest.fn();
jest.mock('../../spa/ajax-functions.js', () => ({
  register: (...args) => mockRegister(...args)
}));

import { Register } from '../../spa/register.js';

function fillValidForm() {
  document.getElementById('full_name').value = 'Test User';
  document.getElementById('email').value = 'TEST@example.com';
  document.getElementById('password').value = 'Strong1!';
  document.getElementById('confirm_password').value = 'Strong1!';
  document.getElementById('account_creation_password').value = 'invitation';
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
});

test('makes client-side validation feedback visible', async () => {
  const registration = new Register({ router: { route: jest.fn() } });
  registration.render();
  fillValidForm();
  document.getElementById('confirm_password').value = 'Different1!';

  await registration.handleSubmit({
    preventDefault: jest.fn(),
    target: document.getElementById('register-form')
  });

  const error = document.getElementById('error-message');
  expect(error.classList.contains('hidden')).toBe(false);
  expect(error.textContent).toBe('Passwords do not match');
  expect(document.getElementById('register-submit').disabled).toBe(false);
  expect(document.getElementById('register-submit').value).toBe('Create account');
  expect(mockRegister).not.toHaveBeenCalled();
});

test('shows progress immediately and a localized network failure', async () => {
  let rejectRequest;
  mockRegister.mockReturnValue(new Promise((resolve, reject) => {
    rejectRequest = reject;
  }));
  const registration = new Register({ router: { route: jest.fn() } });
  registration.render();
  fillValidForm();

  const submission = registration.handleSubmit({
    preventDefault: jest.fn(),
    target: document.getElementById('register-form')
  });

  const submitButton = document.getElementById('register-submit');
  expect(submitButton.disabled).toBe(true);
  expect(submitButton.value).toBe('Loading...');

  rejectRequest(new TypeError('Failed to fetch'));
  await submission;

  const error = document.getElementById('error-message');
  expect(error.classList.contains('hidden')).toBe(false);
  expect(error.textContent).toBe('Could not create account');
  expect(submitButton.disabled).toBe(false);
  expect(submitButton.value).toBe('Create account');
});

test('shows translated success feedback', async () => {
  mockRegister.mockResolvedValue({
    success: true,
    message: 'registration_successful_parent'
  });
  const registration = new Register({ router: { route: jest.fn() } });
  registration.render();
  fillValidForm();

  await registration.handleSubmit({
    preventDefault: jest.fn(),
    target: document.getElementById('register-form')
  });

  const success = document.getElementById('success-message');
  expect(success.classList.contains('hidden')).toBe(false);
  expect(success.textContent).toBe('Account created');
  expect(document.getElementById('error-message').classList.contains('hidden')).toBe(true);
});
