/**
 * @jest-environment jsdom
 */

/**
 * The account page's language picker lists the unit's languages. On a direct
 * load, the unit's settings may still be on their way when the page renders;
 * it waits for them rather than offering only French and English for good.
 *
 * @module test/spa/AccountLanguagePicker
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key, app: {} }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({ CONFIG: { DEFAULT_LANG: 'fr' }, getStorageKey: (key) => key }));
jest.mock('../../spa/api/api-core.js', () => ({ makeApiRequest: jest.fn() }));
jest.mock('../../spa/modules/push/PushSubscription.js', () => ({
  enablePushNotifications: jest.fn(), disablePushNotifications: jest.fn(), PushSetupError: class extends Error {},
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewActivities: jest.fn(() => false),
  holdsFamilyRole: jest.fn(() => false),
  isParent: jest.fn(() => false),
  isDemoUser: jest.fn(() => false),
}));

import { AccountInfoModule } from '../../spa/modules/account-info.js';
import { makeApiRequest } from '../../spa/api/api-core.js';
import { isDemoUser } from '../../spa/utils/PermissionUtils.js';
import { getUnitLanguages } from '../../spa/utils/InterfaceLanguageUtils.js';

/**
 * An app whose unit offers Ukrainian, with its settings not fetched yet.
 *
 * @returns {Object} App stub
 */
function appStillLoadingSettings() {
  return {
    lang: 'fr',
    organizationSettings: null,
    isOrganizationSettingsFetched: false,
    fetchOrganizationSettings: jest.fn(function fetchSettings() {
      this.organizationSettings = { interface_languages: { enabled: ['uk'], fallback: 'en' } };
      this.isOrganizationSettingsFetched = true;
      return Promise.resolve();
    }),
    getUnitLanguages() {
      return getUnitLanguages(this.organizationSettings);
    },
  };
}

test('waits for the unit\'s settings before listing its languages', async () => {
  const app = appStillLoadingSettings();
  const page = new AccountInfoModule(app);

  await page.waitForUnitSettings();
  document.body.innerHTML = `<div role="group" aria-label="language">${page.renderLanguageOptions('fr')}</div>`;

  expect(app.fetchOrganizationSettings).toHaveBeenCalledTimes(1);
  const options = Array.from(document.querySelectorAll('.language-option'))
    .map((button) => [button.dataset.lang, button.getAttribute('lang'), button.getAttribute('aria-pressed')]);
  expect(options).toEqual([['fr', 'fr', 'true'], ['en', 'en', 'false'], ['uk', 'uk', 'false']]);

  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});

test('does not fetch again once the settings are known', async () => {
  const app = appStillLoadingSettings();
  app.isOrganizationSettingsFetched = true;

  await new AccountInfoModule(app).waitForUnitSettings();

  expect(app.fetchOrganizationSettings).not.toHaveBeenCalled();
});

test('saves the chosen language to the account, except for a read-only demo account', async () => {
  const page = new AccountInfoModule(appStillLoadingSettings());

  await page.saveLanguagePreference('uk');
  expect(makeApiRequest).toHaveBeenCalledWith('v1/users/me/language-preference', {
    method: 'PATCH',
    body: { languagePreference: 'uk' },
  });

  makeApiRequest.mockClear();
  isDemoUser.mockReturnValue(true);
  await page.saveLanguagePreference('uk');
  expect(makeApiRequest).not.toHaveBeenCalled();
});
