/**
 * @jest-environment jsdom
 *
 * A leader sets the nickname (totem name) they go by in the unit from their
 * account page.
 */
import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key, app: {} }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({ CONFIG: { DEFAULT_LANG: 'fr' }, getStorageKey: (key) => key }));
jest.mock('../../spa/api/api-core.js', () => ({ makeApiRequest: jest.fn() }));
jest.mock('../../spa/api/api-members.js', () => ({ updateMyNickname: jest.fn() }));
jest.mock('../../spa/modules/push/PushSubscription.js', () => ({
  enablePushNotifications: jest.fn(), disablePushNotifications: jest.fn(), PushSetupError: class extends Error {},
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  holdsFamilyRole: jest.fn(() => false),
  isParent: jest.fn(() => false),
  isDemoUser: jest.fn(() => false),
}));

import { AccountInfoModule } from '../../spa/modules/account-info.js';
import { updateMyNickname } from '../../spa/api/api-members.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function renderForm(nickname = 'Akela') {
  const app = { lang: 'fr', showMessage: jest.fn() };
  const page = new AccountInfoModule(app);
  page.userData = { full_name: 'Christian Sabourin', nickname };
  document.body.innerHTML = `<main id="app">${page.renderNicknameForm()}</main>`;
  document.getElementById('account-nickname-form')
    .addEventListener('submit', (event) => page.handleNicknameUpdate(event));
  return { app, page, input: document.getElementById('account-nickname-input') };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('the field shows the current nickname, labelled and explained', async () => {
  const { input } = renderForm('<b>Akela</b>');

  expect(input.value).toBe('<b>Akela</b>');
  expect(document.querySelector('label[for="account-nickname-input"]').textContent).toBe('nickname');
  expect(input.getAttribute('aria-describedby')).toBe('account-nickname-hint');
  expect(document.querySelector('b')).toBeNull();
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});

test('saving sends the trimmed nickname and says it was saved', async () => {
  updateMyNickname.mockResolvedValue({ success: true, data: { nickname: 'Baloo' } });
  const { app, page, input } = renderForm();

  input.value = ' Baloo ';
  document.querySelector('#account-nickname-form button[type="submit"]').click();
  await flush();

  expect(updateMyNickname).toHaveBeenCalledWith('Baloo');
  expect(page.userData.nickname).toBe('Baloo');
  expect(app.showMessage).toHaveBeenCalledWith('nickname_saved', 'success');
});

test('a failed save is reported as a failure', async () => {
  updateMyNickname.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
  const { app } = renderForm();

  document.querySelector('#account-nickname-form button[type="submit"]').click();
  await flush();

  expect(app.showMessage).toHaveBeenCalledWith('nickname_save_failed', 'error');
});
