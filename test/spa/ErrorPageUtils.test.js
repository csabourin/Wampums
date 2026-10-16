/**
 * @jest-environment jsdom
 *
 * The page shown when a screen, or the whole app, cannot be drawn. When the
 * app fails before its translations arrive, it still speaks to the person in
 * French or English, never in raw keys.
 */

import fs from 'fs';
import path from 'path';
import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), isDebugMode: () => false,
}));

const { STARTUP_TEXTS } = require('../../spa/config/startup-texts.js');
const {
  renderErrorPage,
  startupLanguage,
  startupTranslator,
} = require('../../spa/utils/ErrorPageUtils.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const RAW_KEY = /\b[a-z]+(?:_[a-z]+)+\b/;

function bundle(lang) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'lang', `${lang}.json`), 'utf8'));
}

function app() {
  return document.getElementById('app');
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app" tabindex="-1"></main>';
});

describe('the texts built into the code', () => {
  test.each(['en', 'fr'])('say exactly what lang/%s.json says', (lang) => {
    const translations = bundle(lang);
    Object.entries(STARTUP_TEXTS[lang]).forEach(([key, text]) => {
      expect([key, text]).toEqual([key, translations[key]]);
    });
  });

  test('cover the same words in French and English', () => {
    expect(Object.keys(STARTUP_TEXTS.fr).sort()).toEqual(Object.keys(STARTUP_TEXTS.en).sort());
  });

  test.each([
    ['fr', null, 'fr'],
    ['en', null, 'en'],
    ['uk', 'fr', 'fr'],
    ['uk', 'en', 'en'],
    ['it', null, 'en'],
    [null, null, 'fr'],
  ])('a reader of %s (fallback %s) is answered in %s', (lang, fallback, expected) => {
    expect(startupLanguage(lang, fallback)).toBe(expected);
  });
});

describe('the error page', () => {
  test('before translations arrive, it reads in the reader\'s language, not in keys', () => {
    const text = startupTranslator('fr');
    renderErrorPage(app(), {
      title: text('application_error'),
      message: text('error_loading_application'),
      text,
      showReload: true,
      actions: [{ labelKey: 'go_to_homepage', href: 'https://wampums.app' }],
    });

    expect(app().querySelector('h1').textContent).toBe('Erreur d’application');
    expect(app().querySelector('[role="alert"]').textContent).toBe(STARTUP_TEXTS.fr.error_loading_application);
    expect(app().textContent).not.toMatch(RAW_KEY);
  });

  test('reloading is a real button, and a link leads home', () => {
    const reload = jest.fn();
    const text = startupTranslator('en');
    renderErrorPage(app(), {
      title: text('application_error'),
      message: text('error_loading_application'),
      text,
      showReload: true,
      reload,
      actions: [{ labelKey: 'go_to_homepage', href: 'https://wampums.app' }],
    });

    const button = app().querySelector('button');
    expect(button.textContent).toBe('Reload');
    expect(button.type).toBe('button');
    expect(button.className).toBe('button button--primary');
    button.click();
    expect(reload).toHaveBeenCalledTimes(1);

    const link = app().querySelector('.error-actions a');
    expect(link.textContent).toBe('Go to homepage');
    expect(link.getAttribute('href')).toBe('https://wampums.app');
  });

  test('signed in, it opens with the way back to the dashboard', () => {
    const text = startupTranslator('fr');
    renderErrorPage(app(), { title: 'Erreur', message: 'Oups', text, isLoggedIn: true });

    const back = app().firstElementChild;
    expect(back.tagName).toBe('A');
    expect(back.getAttribute('href')).toBe('/dashboard');
    expect(back.textContent).toBe('← Retour');
  });

  test('a message containing markup is shown as text', () => {
    const text = startupTranslator('en');
    renderErrorPage(app(), { title: 'Error', message: '<img src=x onerror=alert(1)>', text });

    expect(app().querySelector('img')).toBeNull();
    expect(app().querySelector('[role="alert"]').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('has no WCAG A/AA violations', async () => {
    const text = startupTranslator('fr');
    renderErrorPage(app(), {
      title: text('application_error'),
      message: text('error_loading_application'),
      text,
      showReload: true,
      actions: [{ labelKey: 'go_to_homepage', href: 'https://wampums.app' }],
    });
    const results = await axe.run(app(), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
