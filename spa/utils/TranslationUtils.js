/**
 * Look up an interface text: the reader's language, the unit's vocabulary,
 * and, for a partial optional language, the unit's fallback language.
 *
 * Kept free of the app object so it can be tested on its own; app.translate
 * passes its current state.
 *
 * @module utils/TranslationUtils
 */

import {
  getDirectVocabularyTermKey,
  getUnitVocabulary,
  getVocabularyTemplateKey,
} from './UnitVocabularyUtils.js';

/**
 * Translate one key.
 *
 * A key the reader's optional language lacks is read from the fallback
 * language, with that language's unit vocabulary, so a unit's own terms
 * ("Tanières") still appear in the fallback text.
 *
 * @param {string} key - Translation key
 * @param {Object} state
 * @param {string} state.lang - Reader's language
 * @param {string|null} state.fallbackLang - Fallback of an optional language, else null
 * @param {string} state.defaultLang - App default language
 * @param {Object<string, Object>} state.translations - Loaded bundles by language
 * @param {Object} [state.settings] - Organization settings (unit vocabulary)
 * @returns {{text: string, missing: boolean}} The text, and whether no bundle had it
 */
export function translateKey(key, { lang, fallbackLang, defaultLang, translations, settings }) {
  const activeLang = lang && translations[lang] ? lang : defaultLang;
  const translationSet = translations[activeLang] || {};
  const defaultSet = translations[fallbackLang || defaultLang] || {};
  const fromFallback = Boolean(fallbackLang) && !translationSet[key];
  const vocabulary = getUnitVocabulary(settings, fromFallback ? fallbackLang : activeLang);

  const directTermKey = getDirectVocabularyTermKey(key);
  if (directTermKey && vocabulary[directTermKey]) {
    return { text: vocabulary[directTermKey], missing: false };
  }

  const vocabularyTemplateKey = Object.keys(vocabulary).length > 0 ? getVocabularyTemplateKey(key) : null;
  const resolvedKey = vocabularyTemplateKey || key;
  const missing = !translationSet[resolvedKey] && !defaultSet[resolvedKey];
  const translated = fromFallback
    ? defaultSet[resolvedKey] || defaultSet[key] || key
    : translationSet[resolvedKey] || defaultSet[resolvedKey] || key;
  const text = Object.entries(vocabulary).reduce(
    (result, [termKey, value]) => result.replaceAll(`{${termKey}}`, value),
    translated,
  );
  return { text, missing };
}
