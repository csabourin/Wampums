/**
 * Plurals written out, never "place(s)" (#1428): a screen reader reads "(s)" aloud.
 *
 * A counted text has two keys in `lang/*.json`, `<key>_one` and `<key>_other`. The language's own
 * rules choose between them (`Intl.PluralRules`): in French 0 and 1 take the singular, in English
 * only 1 does. Rules with more forms (Ukrainian "few", "many") use `_other`, which every bundle
 * has; a missing optional-language key falls back to the unit's fallback language as usual.
 *
 * `test/spa/TranslationCoverage.test.js` checks that each `translatePlural('<key>', …)` call has
 * both keys in English and French.
 *
 * @module spa/utils/PluralUtils
 */
import { translate } from '../app.js';
import { localeForLanguage } from './InterfaceLanguageUtils.js';

/**
 * @param {number} count - How many
 * @param {string} lang - Interface language code
 * @returns {'one'|'other'} The form a text about `count` things takes
 */
export function pluralForm(count, lang) {
  try {
    return new Intl.PluralRules(localeForLanguage(lang)).select(Number(count)) === 'one' ? 'one' : 'other';
  } catch {
    return Number(count) === 1 ? 'one' : 'other';
  }
}

/**
 * The translated text for `count` things, its placeholders still to fill.
 *
 * @param {string} key - Base key; `<key>_one` and `<key>_other` exist in both bundles
 * @param {number} count - The number the text agrees with
 * @param {string} lang - Interface language code
 * @returns {string} The text in the right form
 */
export function translatePlural(key, count, lang) {
  return translate(`${key}_${pluralForm(count, lang)}`);
}
