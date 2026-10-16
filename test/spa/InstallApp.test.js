/**
 * @jest-environment jsdom
 */

/**
 * Installing the app. Parents were never offered it: the button stayed under
 * `.hidden { display: none !important }`, and its listener was attached long
 * after the browser's one-time prompt had gone by. The prompt is now caught
 * when the app starts, and "Install the app" always does something: the
 * browser's prompt when it has one, else the steps for this device, so a
 * dismissed prompt, Safari or Firefox are no dead end.
 *
 * @module test/spa/InstallApp
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 };
const IPAD = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 5 };
const MAC = { userAgent: IPAD.userAgent, maxTouchPoints: 0 };
const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', maxTouchPoints: 5 };

let utils;
let dialog;
let stopCapture;

/**
 * The browser offering its install prompt, answered with `outcome`.
 *
 * @param {'accepted'|'dismissed'} outcome
 * @returns {Event} The event, with a spied `prompt()`
 */
function offerPrompt(outcome) {
  const event = new Event('beforeinstallprompt');
  event.prompt = jest.fn(() => Promise.resolve());
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  window.dispatchEvent(event);
  return event;
}

/**
 * Press a key where focus is.
 * @param {string} key
 * @param {Object} [options]
 */
function press(key, options = {}) {
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
}

beforeEach(() => {
  // Each test starts from a page load: no prompt caught, nothing installed.
  jest.resetModules();
  utils = require('../../spa/utils/InstallPromptUtils.js');
  dialog = require('../../spa/modules/install/InstallAppDialog.js');
  stopCapture = utils.startInstallPromptCapture();
  delete window.matchMedia;
  delete window.navigator.standalone;
  document.body.innerHTML = '<main><button type="button" id="opener">Install the app</button></main>';
  document.getElementById('opener').focus();
});

afterEach(() => {
  stopCapture();
  require('../../spa/utils/ModalUtils.js').closeAllModals();
});

describe('the browser prompt', () => {
  test('a prompt offered before any screen loaded is shown when the parent asks', async () => {
    const event = offerPrompt('accepted');

    expect(utils.canPromptInstall()).toBe(true);
    await expect(dialog.offerAppInstall()).resolves.toBe('accepted');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test('dismissing the prompt opens nothing more, and asking again shows the steps', async () => {
    const event = offerPrompt('dismissed');

    await expect(dialog.offerAppInstall()).resolves.toBe('dismissed');
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // The prompt can be shown only once; the button still leads somewhere.
    await expect(dialog.offerAppInstall()).resolves.toBe('instructions');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  test('a prompt the browser refuses falls back to the steps', async () => {
    const event = offerPrompt('accepted');
    event.prompt.mockRejectedValue(new Error('InvalidStateError'));

    await expect(dialog.offerAppInstall()).resolves.toBe('instructions');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  test('screens are told when a prompt arrives and when the app is installed', () => {
    const seen = [];
    const stop = utils.onInstallAvailabilityChange((state) => seen.push(state));

    offerPrompt('accepted');
    window.dispatchEvent(new Event('appinstalled'));
    stop();
    offerPrompt('accepted');

    expect(seen).toEqual([
      { canPrompt: true, installed: false },
      { canPrompt: false, installed: true },
    ]);
    expect(utils.isAppInstalled()).toBe(true);
  });
});

describe('knowing the app is installed', () => {
  test('running as an installed app counts', () => {
    expect(utils.isAppInstalled()).toBe(false);
    window.matchMedia = jest.fn((query) => ({ matches: query === '(display-mode: standalone)' }));
    expect(utils.isAppInstalled()).toBe(true);
  });

  test('an iPhone home-screen app counts', () => {
    window.navigator.standalone = true;
    expect(utils.isAppInstalled()).toBe(true);
  });
});

describe('the steps for this device', () => {
  test('recognises iPhone, iPad, Android and computers', () => {
    expect(utils.installPlatform(IPHONE)).toBe('ios');
    expect(utils.installPlatform(IPAD)).toBe('ios');
    expect(utils.installPlatform(ANDROID)).toBe('android');
    expect(utils.installPlatform(MAC)).toBe('desktop');
  });

  test('an iPhone gets numbered Share › Add to Home Screen steps', () => {
    dialog.openInstallAppDialog('ios');
    const steps = [...document.querySelectorAll('[role="dialog"] ol li')].map((li) => li.textContent);
    expect(steps).toEqual(['install_app_ios_step_share', 'install_app_ios_step_add', 'install_app_ios_step_confirm']);
  });

  test('an Android phone gets numbered steps through the browser menu', () => {
    dialog.openInstallAppDialog('android');
    const steps = [...document.querySelectorAll('[role="dialog"] ol li')].map((li) => li.textContent);
    expect(steps).toEqual([
      'install_app_android_step_menu', 'install_app_android_step_install', 'install_app_android_step_confirm',
    ]);
  });

  test('a computer gets one way per browser, as a list of alternatives', () => {
    dialog.openInstallAppDialog('desktop');
    expect(document.querySelector('[role="dialog"] ol')).toBeNull();
    const ways = [...document.querySelectorAll('[role="dialog"] ul li')].map((li) => li.textContent);
    expect(ways).toEqual([
      'install_app_desktop_chrome_edge', 'install_app_desktop_safari', 'install_app_desktop_firefox',
    ]);
  });

  test('the dialog is named, has no WCAG A/AA violations, and keeps and returns focus', async () => {
    dialog.openInstallAppDialog('ios');
    const panel = document.querySelector('[role="dialog"]');

    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(panel.getAttribute('aria-labelledby')).textContent)
      .toBe('install_app_dialog_title');
    const results = await axe.run(document.body, AXE_OPTIONS);
    expect(results.violations).toEqual([]);

    // Focus moves in, Tab stays inside, Escape closes and returns it.
    expect(panel.contains(document.activeElement)).toBe(true);
    const closeButtons = [...panel.querySelectorAll('button')];
    closeButtons[closeButtons.length - 1].focus();
    press('Tab');
    expect(panel.contains(document.activeElement)).toBe(true);
    press('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement.id).toBe('opener');
  });

  test('the Close button closes it and returns focus to the opener', () => {
    dialog.openInstallAppDialog('android');
    const close = [...document.querySelectorAll('[role="dialog"] .modal-footer button')][0];
    expect(close.textContent).toBe('close');
    close.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement.id).toBe('opener');
  });
});
