/**
 * A form field's own texts, one per language.
 *
 * A field names its label and its information text with translation keys
 * (`label`, `infoText`), looked up in the app's bundles. A unit can also write
 * its own text per language, stored in the form format it owns:
 *
 *   labelText: { fr: 'Autres langues', en: 'Other languages', it: '…' }
 *   infoHtml:  { fr: '<p>Tout au long de l’année…</p>', en: '…' }
 *
 * The field's own text in the reader's language wins, then the key's bundle
 * text in that language. Texts in other languages are never shown in its
 * place: a page shows one language.
 *
 * @module utils/FormTextUtils
 */

import DOMPurify from 'dompurify';
import { escapeHTML } from './SecurityUtils.js';

/** Tags the information-text editor produces; anything else is dropped. */
export const RICH_TEXT_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'a'];

/** A paragraph holding nothing visible. */
const EMPTY_PARAGRAPH_PATTERN = /<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/g;

/** Link targets a unit may use: web pages, e-mail and phone numbers. */
export const RICH_TEXT_LINK_PATTERN = /^(?:https?:|mailto:|tel:)/i;

/**
 * Keep only the formatting the editor offers: paragraphs, bold, italic, lists
 * and links to web, mail or phone addresses.
 *
 * @param {string} html - Rich text from the editor or a stored form format
 * @returns {string} Safe HTML
 */
export function sanitizeRichText(html) {
  if (typeof html !== 'string' || html === '') {
    return '';
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RICH_TEXT_TAGS,
    ALLOWED_ATTR: ['href'],
    ALLOWED_URI_REGEXP: RICH_TEXT_LINK_PATTERN,
  // Browsers insert a list inside the current paragraph; parsing splits that
  // into empty paragraphs around the list, which would show as blank lines.
  }).replace(EMPTY_PARAGRAPH_PATTERN, '');
}

/**
 * Whether rich text holds anything a reader would see.
 *
 * @param {string} html - Rich text
 * @returns {boolean}
 */
export function richTextHasContent(html) {
  if (typeof html !== 'string') {
    return false;
  }
  // Text only: DOMPurify keeps the content of every element it removes.
  const text = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
  return text.replace(/&nbsp;/g, ' ').trim() !== '';
}

/**
 * Whether a per-language map holds at least one non-empty text.
 *
 * @param {Object<string, string>|undefined} texts - Language code → text
 * @returns {boolean}
 */
export function hasOwnText(texts) {
  return Boolean(texts) && Object.values(texts).some((text) => richTextHasContent(text));
}

/**
 * Resolve a field text in the reader's language: the unit's own text, then
 * the bundle text for the key, then the key itself. A French or English page
 * never borrows another language's text (CLAUDE.md §1); the builder flags
 * fields missing one of them instead. An optional language, being partial,
 * falls back to the unit's fallback language.
 *
 * @param {Object<string, string>|undefined} texts - The field's own texts
 * @param {string|undefined} key - Translation key
 * @param {string} lang - Reader's language
 * @param {function(string): string} translate - Bundle lookup; returns the key when missing
 * @param {Object} [reader] - For an optional language only
 * @param {string|null} [reader.fallbackLang] - The unit's fallback language
 * @param {function(string, string): boolean} [reader.hasBundleText] - Whether a language's bundle has a key
 * @returns {{text: string, own: boolean}} The text and whether the unit wrote it
 */
export function resolveFormText(texts, key, lang, translate, reader = {}) {
  if (richTextHasContent(texts?.[lang])) {
    return { text: texts[lang], own: true };
  }
  const { fallbackLang = null, hasBundleText = null } = reader;
  // An optional language is partial: its own bundle text first, then the
  // unit's text and the bundle text in the unit's fallback language.
  if (fallbackLang && hasBundleText) {
    if (key && hasBundleText(lang, key)) {
      return { text: translate(key), own: false };
    }
    if (richTextHasContent(texts?.[fallbackLang])) {
      return { text: texts[fallbackLang], own: true };
    }
  }
  if (key) {
    const translated = translate(key);
    if (translated && translated !== key) {
      return { text: translated, own: false };
    }
  }
  return { text: key || '', own: false };
}

/**
 * A field's label as HTML. The unit's own text is plain text and escaped;
 * bundle text is the app's own and used as is, as before.
 *
 * @param {Object} field - Form field
 * @param {string} lang - Reader's language
 * @param {function(string): string} translate - Bundle lookup
 * @param {Object} [reader] - Fallback for an optional language (see resolveFormText)
 * @returns {string} HTML
 */
export function formLabelHtml(field, lang, translate, reader) {
  const { text, own } = resolveFormText(field.labelText, field.label || field.name, lang, translate, reader);
  return own ? escapeHTML(text) : text;
}

/**
 * An information-text field's content as HTML, sanitized when the unit wrote it.
 *
 * @param {Object} field - Form field of type `infoText`
 * @param {string} lang - Reader's language
 * @param {function(string): string} translate - Bundle lookup
 * @param {Object} [reader] - Fallback for an optional language (see resolveFormText)
 * @returns {string} HTML
 */
export function formInfoHtml(field, lang, translate, reader) {
  const { text, own } = resolveFormText(field.infoHtml, field.infoText, lang, translate, reader);
  return own ? sanitizeRichText(text) : text;
}
