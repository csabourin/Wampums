/**
 * @jest-environment jsdom
 */

/**
 * Signing in, creating an account and resetting a password, as CLAUDE.md §7
 * asks of every screen: the way back first, errors announced at once and tied
 * to their field, names shown as text, nothing left running after the person
 * leaves, and no WCAG 2.x A/AA violation axe can find without layout.
 *
 * @module test/spa/SessionScreens
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
jest.mock('../../spa/ajax-functions.js', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  register: jest.fn(),
  getApiUrl: (endpoint) => `/api/${endpoint}`,
  getCurrentOrganizationId: jest.fn(),
  fetchOrganizationId: jest.fn(),
}));
jest.mock('../../spa/utils/StorageUtils.js', () => ({
  setStorage: jest.fn(),
  getStorage: jest.fn(),
  removeStorage: jest.fn(),
  setStorageMultiple: jest.fn(),
}));
jest.mock('../../spa/utils/ClientCleanupUtils.js', () => ({ clearAllClientData: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ isParent: () => false, hasPermission: () => false }));
jest.mock('../../spa/api/api-family.js', () => ({ getOnboardingContext: jest.fn() }));
jest.mock('../../spa/api/api-demo.js', () => ({ startDemoSession: jest.fn() }));

import { login, register, fetchOrganizationId, getCurrentOrganizationId } from '../../spa/ajax-functions.js';
import { startDemoSession } from '../../spa/api/api-demo.js';
import { Login } from '../../spa/modules/session/Login.js';
import { Register } from '../../spa/modules/session/Register.js';
import { ResetPassword } from '../../spa/modules/session/ResetPassword.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const HOSTILE_NAME = '<img src=x onerror=alert(1)>';

/** @returns {Promise<void>} Lets pending promise callbacks run */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** @returns {Promise<Array>} axe violations inside #app */
async function violations() {
  return (await axe.run(document.getElementById('app'), AXE_OPTIONS)).violations;
}

/** @returns {Element} The first element the page shows */
const firstElement = () => document.getElementById('app').firstElementChild;

/**
 * @param {string} value - What the person types
 * @param {string} id - Field id
 */
function type(id, value) {
  const field = document.getElementById(id);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** @param {string} id - Form id */
function submit(id) {
  document.getElementById(id).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function loginApp(name = 'Meute Akela') {
  return {
    organizationId: '1',
    organizationSettings: { organization_info: { name } },
    isOrganizationSettingsFetched: true,
    getUnitLanguages: () => ({ available: ['fr', 'en'] }),
    lang: 'fr',
    setLanguage: jest.fn(),
    router: { route: jest.fn(), navigate: jest.fn() },
  };
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('sign-in', () => {
  test('names the unit as text, not markup, and passes axe', async () => {
    new Login(loginApp(HOSTILE_NAME)).render();

    const heading = document.querySelector('.login-container h2');
    expect(heading.textContent).toBe(HOSTILE_NAME);
    expect(heading.querySelector('img')).toBeNull();
    expect(await violations()).toEqual([]);
  });

  test('a refused sign-in is announced as an alert, not as a polite status', async () => {
    login.mockResolvedValue({ success: false, message: 'invalid_email_or_password' });
    new Login(loginApp()).render();
    type('login-email', 'parent@example.org');
    type('login-password', 'wrong');

    submit('login-form');
    await flush();

    expect(document.querySelector('.login-container [role="alert"]').textContent)
      .toBe('invalid_email_or_password');
    expect(document.querySelector('.login-container [role="status"]').textContent).toBe('');
  });

  test('when the unit cannot be loaded, the page says so and offers to try again', async () => {
    getCurrentOrganizationId.mockReturnValue(null);
    fetchOrganizationId.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('1');
    const app = { ...loginApp(), organizationId: null };
    const screen = new Login(app);

    await screen.init();
    expect(document.querySelector('[role="alert"]').textContent).toBe('error_loading_application');

    document.getElementById('login-retry').click();
    await flush();
    expect(fetchOrganizationId).toHaveBeenCalledTimes(2);
    expect(document.getElementById('login-form')).not.toBeNull();
  });

  describe('two-step verification', () => {
    async function openVerification() {
      login.mockResolvedValue({ success: true, requires_2fa: true });
      const screen = new Login(loginApp(HOSTILE_NAME));
      screen.render();
      type('login-email', 'leader@example.org');
      type('login-password', 'Secret1!');
      submit('login-form');
      await flush();
      return screen;
    }

    test('opens with the way back, a labelled code field and no axe violation', async () => {
      await openVerification();

      expect(firstElement().firstElementChild.getAttribute('href')).toBe('/login');
      const code = document.getElementById('verify-code');
      expect(document.querySelector('label[for="verify-code"]').textContent).toBe('verification_code');
      expect(code.getAttribute('aria-describedby')).toContain('verify-error');
      expect(document.activeElement).toBe(code);
      expect(document.querySelector('.login-container h2').textContent).toBe(HOSTILE_NAME);
      expect(await violations()).toEqual([]);
    });

    test('a malformed code is announced and marks the field invalid', async () => {
      await openVerification();
      type('verify-code', '12');

      submit('verify-2fa-form');

      expect(document.getElementById('verify-error').textContent).toBe('invalid_code_format');
      expect(document.getElementById('verify-code').getAttribute('aria-invalid')).toBe('true');
    });

    test('the way back shows the sign-in form again', async () => {
      await openVerification();

      firstElement().firstElementChild.click();

      expect(document.getElementById('login-form')).not.toBeNull();
    });
  });
});

describe('signing in to the demo unit', () => {
  /** @returns {Object} The app of a unit set up as a demo */
  function demoApp(name = 'Unité démo') {
    const app = loginApp(name);
    app.organizationSettings = { ...app.organizationSettings, demo_sign_in: true };
    return app;
  }

  const DEMO_SESSION = { success: true, token: 'jwt', user_id: 'u-1', user_roles: ['demoparent'], user_permissions: [], organization_id: 1 };

  test('offers the parent and the leader views instead of an email and a password, and passes axe', async () => {
    new Login(demoApp(HOSTILE_NAME)).render();

    expect(document.getElementById('login-form')).toBeNull();
    expect(document.getElementById('login-password')).toBeNull();
    const choices = [...document.querySelectorAll('[data-demo-view]')];
    expect(choices.map((button) => button.tagName)).toEqual(['BUTTON', 'BUTTON']);
    expect(choices.map((button) => button.querySelector('.demo-choice__title').textContent)).toEqual(['demo_view_parent', 'demo_view_leader']);
    expect(document.querySelector('.login-container h2').textContent).toBe(HOSTILE_NAME);
    expect(await violations()).toEqual([]);
  });

  test('choosing the parent view opens the demo as a parent', async () => {
    startDemoSession.mockResolvedValue(DEMO_SESSION);
    const app = demoApp();
    new Login(app).render();

    document.querySelector('[data-demo-view="parent"]').click();
    await flush();
    await flush();

    expect(startDemoSession).toHaveBeenCalledWith('parent');
    expect(app.isLoggedIn).toBe(true);
    expect(app.router.route).toHaveBeenCalled();
  });

  test('while the demo opens, both choices are disabled so a double tap sends one request', () => {
    startDemoSession.mockReturnValue(new Promise(() => {}));
    new Login(demoApp()).render();

    document.querySelector('[data-demo-view="leader"]').click();
    document.querySelector('[data-demo-view="leader"]').click();

    expect(startDemoSession).toHaveBeenCalledTimes(1);
    expect([...document.querySelectorAll('[data-demo-view]')].every((button) => button.disabled)).toBe(true);
    expect(document.querySelector('[role="status"]').textContent).toBe('demo_sign_in_opening');
  });

  test('a refusal is announced as an alert with its own words, and the choices come back', async () => {
    startDemoSession.mockResolvedValue({ success: false, status: 404, message: 'demo_account_unavailable' });
    new Login(demoApp()).render();

    document.querySelector('[data-demo-view="leader"]').click();
    await flush();

    expect(document.querySelector('[role="alert"]').textContent).toBe('demo_account_unavailable');
    expect(document.querySelector('[role="status"]').textContent).toBe('');
    expect(document.querySelector('[data-demo-view="leader"]').disabled).toBe(false);
  });

  test('a server message the page does not know reads as the general demo error', async () => {
    startDemoSession.mockResolvedValue({ success: false, status: 500, message: 'Something exploded in SQL' });
    new Login(demoApp()).render();

    document.querySelector('[data-demo-view="parent"]').click();
    await flush();

    expect(document.querySelector('[role="alert"]').textContent).toBe('demo_sign_in_failed');
  });

  test('the people who run the demo can still sign in with their account, and come back', async () => {
    new Login(demoApp()).render();

    document.getElementById('login-with-account').click();
    expect(document.getElementById('login-form')).not.toBeNull();
    expect(document.activeElement.id).toBe('login-email');
    expect(await violations()).toEqual([]);

    document.getElementById('login-demo-views').click();
    expect(document.getElementById('login-form')).toBeNull();
    expect(document.activeElement.dataset.demoView).toBe('parent');
  });

  test('a unit that is not a demo keeps the email and password form', () => {
    new Login(loginApp()).render();

    expect(document.getElementById('login-form')).not.toBeNull();
    expect(document.querySelector('[data-demo-view]')).toBeNull();
    expect(document.getElementById('login-demo-views')).toBeNull();
  });
});

describe('creating an account', () => {
  function fillForm(password = 'Strong1!', confirmation = password) {
    type('full_name', 'Test User');
    type('email', 'test@example.org');
    type('password', password);
    type('confirm_password', confirmation);
    type('account_creation_password', 'invitation');
  }

  test('opens with the way back to sign-in and passes axe', async () => {
    new Register({ router: { navigate: jest.fn() } }).render();

    expect(firstElement().getAttribute('href')).toBe('/login');
    expect(await violations()).toEqual([]);
  });

  test('a password error is tied to both password fields and clears when one changes', async () => {
    new Register({ router: { navigate: jest.fn() } }).render();
    fillForm('Strong1!', 'Other1!');

    submit('register-form');
    await flush();

    for (const id of ['password', 'confirm_password']) {
      const field = document.getElementById(id);
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.getAttribute('aria-describedby')).toBe('error-message');
    }
    expect(document.getElementById('error-message').textContent).toBe('passwords_do_not_match');
    expect(register).not.toHaveBeenCalled();

    type('confirm_password', 'Strong1!');
    expect(document.getElementById('password').getAttribute('aria-invalid')).toBe('false');
    expect(document.getElementById('error-message').classList).toContain('hidden');
  });

  test('leaving before the redirect to sign-in cancels it', async () => {
    jest.useFakeTimers();
    register.mockResolvedValue({ success: true, message: 'registration_successful' });
    const navigate = jest.fn();
    const screen = new Register({ router: { navigate } });
    screen.render();
    fillForm();

    submit('register-form');
    await Promise.resolve();
    await Promise.resolve();
    screen.destroy();
    jest.runAllTimers();

    expect(register).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('resetting a password', () => {
  const TOKEN = 'c'.repeat(64);

  function respondWith(status, body) {
    global.fetch = jest.fn().mockResolvedValue({ status, json: () => Promise.resolve(body) });
  }

  test('both steps open with the way back to sign-in and pass axe', async () => {
    new ResetPassword({}).render();
    expect(firstElement().getAttribute('href')).toBe('/login');
    expect(await violations()).toEqual([]);

    respondWith(200, { success: true, data: { email: 'parent@example.org' } });
    await new ResetPassword({}).render(TOKEN);
    expect(firstElement().getAttribute('href')).toBe('/login');
    expect(await violations()).toEqual([]);
  });

  test('a mismatch is announced as an alert and tied to the password fields', async () => {
    respondWith(200, { success: true, data: { email: null } });
    await new ResetPassword({}).render(TOKEN);
    type('new-password', 'Strong1!');
    type('confirm-password', 'Other1!');

    submit('reset-password-form');
    await flush();

    expect(document.querySelector('[role="alert"]').textContent).toBe('passwords_do_not_match');
    expect(document.getElementById('new-password').getAttribute('aria-describedby')).toBe('reset-error');
    expect(document.getElementById('confirm-password').getAttribute('aria-invalid')).toBe('true');
  });

  test('a server rule the page does not know reads as the general error, never the server\'s English', async () => {
    respondWith(200, { success: true, data: { email: null } });
    const screen = new ResetPassword({ router: { navigate: jest.fn() } });
    await screen.render(TOKEN);
    type('new-password', 'Strong1!');
    type('confirm-password', 'Strong1!');
    respondWith(400, { success: false, errors: [{ msg: 'Password must not contain the unit name' }] });

    submit('reset-password-form');
    await flush();

    expect(document.querySelector('[role="alert"]').textContent).toBe('error_resetting_password');
  });

  test('leaving before the redirect to sign-in cancels it', async () => {
    respondWith(200, { success: true, data: { email: null } });
    const navigate = jest.fn();
    const screen = new ResetPassword({ router: { navigate } });
    await screen.render(TOKEN);
    type('new-password', 'Strong1!');
    type('confirm-password', 'Strong1!');
    respondWith(200, { success: true });
    jest.useFakeTimers();

    submit('reset-password-form');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    screen.destroy();
    jest.runAllTimers();

    expect(document.querySelector('[role="status"]').textContent).toBe('password_reset_successful');
    expect(navigate).not.toHaveBeenCalled();
  });
});
