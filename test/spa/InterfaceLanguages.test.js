/**
 * @jest-environment jsdom
 */

/**
 * Per-unit interface languages
 *
 * French and English are always offered. A unit adds optional languages
 * (Ukrainian, Italian, Indonesian); their missing keys fall back to the
 * unit's fallback language, French or English.
 *
 * @module test/spa/InterfaceLanguages
 */

// DebugUtils reads import.meta, which Jest's CommonJS transform cannot parse.
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));

import {
  fallbackLanguageFor,
  getUnitLanguages,
  localeForLanguage,
  nativeLanguageName,
  resolveInterfaceLanguage,
} from '../../spa/utils/InterfaceLanguageUtils.js';
import {
  DEFAULT_FALLBACK_LANG,
  INTERFACE_LANGUAGES_SETTING_KEY,
  OPTIONAL_LANGS,
  SUPPORTED_LANGS,
} from '../../spa/config/languages.js';
import { resolveFormText } from '../../spa/utils/FormTextUtils.js';
import sharedConfig from '../../config/interface_languages.json';

const unit = (stored) => ({ interface_languages: stored });

describe('The SPA and the server agree on the languages', () => {
  it('lists the same core and optional languages', () => {
    expect([...SUPPORTED_LANGS].sort()).toEqual([...sharedConfig.core].sort());
    expect(OPTIONAL_LANGS).toEqual(sharedConfig.optional);
    expect(DEFAULT_FALLBACK_LANG).toBe(sharedConfig.defaultFallback);
    expect(INTERFACE_LANGUAGES_SETTING_KEY).toBe(sharedConfig.settingKey);
  });
});

describe('A unit\'s languages', () => {
  it('offers French and English when nothing is set', () => {
    expect(getUnitLanguages({})).toEqual({ available: ['fr', 'en'], optional: [], fallback: 'en' });
  });

  it('adds the optional languages the unit chose, in catalogue order', () => {
    expect(getUnitLanguages(unit({ enabled: ['id', 'uk', 'xx'], fallback: 'fr' }))).toEqual({
      available: ['fr', 'en', 'uk', 'id'], optional: ['uk', 'id'], fallback: 'fr',
    });
  });

  it('keeps a language only while the unit offers it', () => {
    expect(resolveInterfaceLanguage('uk', unit({ enabled: ['uk'] }))).toBe('uk');
    expect(resolveInterfaceLanguage('uk-UA', unit({ enabled: ['uk'] }))).toBe('uk');
    expect(resolveInterfaceLanguage('uk', unit({ enabled: [] }))).toBe('fr');
    expect(resolveInterfaceLanguage('en', {})).toBe('en');
  });

  it('gives an optional language the unit\'s fallback and a core language none', () => {
    expect(fallbackLanguageFor('uk', 'fr')).toBe('fr');
    expect(fallbackLanguageFor('uk', 'de')).toBe('en');
    expect(fallbackLanguageFor('fr', 'en')).toBeNull();
    expect(fallbackLanguageFor('en', 'fr')).toBeNull();
  });

  it('formats dates and amounts in each language\'s own locale', () => {
    expect(['fr', 'en', 'uk', 'it', 'id'].map(localeForLanguage)).toEqual(['fr-CA', 'en-CA', 'uk-UA', 'it-IT', 'id-ID']);
    expect(localeForLanguage('xx')).toBe('fr-CA');
  });

  it('names each language in that language', () => {
    expect(nativeLanguageName('uk')).toBe('Українська');
    expect(nativeLanguageName('fr')).toBe('Français');
  });
});

describe('Form texts for an optional language', () => {
  const bundles = {
    uk: { known_label: 'Відомо' },
    en: { known_label: 'Known', other_label: 'Other' },
  };
  const translate = (key) => bundles.uk[key] || bundles.en[key] || key;
  const reader = { fallbackLang: 'en', hasBundleText: (lang, key) => Boolean(bundles[lang]?.[key]) };

  it('prefers the unit\'s Ukrainian text, then the Ukrainian bundle', () => {
    expect(resolveFormText({ uk: 'Наш текст', en: 'Ours' }, 'known_label', 'uk', translate, reader).text).toBe('Наш текст');
    expect(resolveFormText({ en: 'Ours' }, 'known_label', 'uk', translate, reader).text).toBe('Відомо');
  });

  it('then falls back to the unit\'s text in the fallback language, then its bundle', () => {
    expect(resolveFormText({ en: 'Ours' }, 'other_label', 'uk', translate, reader)).toEqual({ text: 'Ours', own: true });
    expect(resolveFormText({}, 'other_label', 'uk', translate, reader)).toEqual({ text: 'Other', own: false });
  });
});
