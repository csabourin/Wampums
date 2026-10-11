/**
 * The interface languages a unit offers, and the fallback of its optional
 * languages.
 *
 * French and English are always offered. A unit may add optional languages
 * (`interface_languages.enabled` in its settings); their missing keys fall
 * back to `interface_languages.fallback`, French or English.
 *
 * @module utils/InterfaceLanguageUtils
 */

import {
  DEFAULT_FALLBACK_LANG,
  DEFAULT_LANG,
  INTERFACE_LANGUAGES_SETTING_KEY,
  OPTIONAL_LANGS,
  SUPPORTED_LANGS,
} from '../config/languages.js';

/** Length of an ISO 639-1 code, which a longer tag ("uk-UA") is cut to. */
const LANGUAGE_CODE_LENGTH = 2;

/** Core languages in the order a picker shows them. */
const CORE_ORDER = ['fr', 'en'];

/**
 * A unit's languages.
 *
 * @param {Object} [settings] - Organization settings
 * @returns {{available: string[], optional: string[], fallback: string}}
 */
export function getUnitLanguages(settings) {
  const stored = settings?.[INTERFACE_LANGUAGES_SETTING_KEY] || {};
  const enabled = Array.isArray(stored.enabled) ? stored.enabled : [];
  const optional = OPTIONAL_LANGS.filter((code) => enabled.includes(code));
  const fallback = SUPPORTED_LANGS.includes(stored.fallback) ? stored.fallback : DEFAULT_FALLBACK_LANG;
  return { available: [...CORE_ORDER, ...optional], optional, fallback };
}

/**
 * The language to show: the requested one when the unit offers it, else
 * the default.
 *
 * @param {string} requested - Language code
 * @param {Object} [settings] - Organization settings
 * @returns {string} Language code
 */
export function resolveInterfaceLanguage(requested, settings) {
  const code = String(requested || '').slice(0, LANGUAGE_CODE_LENGTH).toLowerCase();
  return getUnitLanguages(settings).available.includes(code) ? code : DEFAULT_LANG;
}

/**
 * The language a missing key falls back to: none for a core language,
 * which is complete; the unit's fallback for an optional one.
 *
 * @param {string} lang - Language shown
 * @param {string} fallback - The unit's fallback language
 * @returns {string|null} Language code, or null
 */
export function fallbackLanguageFor(lang, fallback) {
  if (SUPPORTED_LANGS.includes(lang)) {
    return null;
  }
  return SUPPORTED_LANGS.includes(fallback) ? fallback : DEFAULT_FALLBACK_LANG;
}

/**
 * A language's name written in that language ("Українська", "Italiano"),
 * which is how a reader finds their own language in a list.
 *
 * @param {string} code - Language code
 * @returns {string} Name, or the code when the browser cannot name it
 */
export function nativeLanguageName(code) {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** Regional variant used to format dates and amounts in each language. */
const FORMAT_LOCALES = { fr: 'fr-CA', en: 'en-CA', uk: 'uk-UA', it: 'it-IT', id: 'id-ID' };

/**
 * The locale to format dates, times and amounts for an interface language.
 *
 * @param {string} lang - Interface language code
 * @returns {string} BCP 47 locale; French (Canada) for an unknown language
 */
export function localeForLanguage(lang) {
  return FORMAT_LOCALES[lang] || FORMAT_LOCALES[DEFAULT_LANG];
}
