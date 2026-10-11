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
 * The field's own text in the reader's language wins; then the key's bundle
 * text; then the field's own text in any other language, so a unit that wrote
 * only French still shows something to an English reader.
 *
 * @module utils/FormTextUtils
 */

import DOMPurify from 'dompurify';
import { DEFAULT_LANG } from '../config/languages.js';
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
 * The field's own text in `lang`, else in the default language, else in the
 * first language that has one.
 *
 * @param {Object<string, string>|undefined} texts - Language code → text
 * @param {string} lang - Reader's language
 * @returns {string|null} The text, or null when the field has none of its own
 */
function ownText(texts, lang) {
  if (!texts) {
    return null;
  }
  const candidates = [texts[lang], texts[DEFAULT_LANG], ...Object.values(texts)];
  return candidates.find((text) => richTextHasContent(text)) ?? null;
}

/**
 * Resolve a field text: own text in the reader's language, then the bundle
 * text for the key, then own text in another language, then the key itself.
 *
 * @param {Object<string, string>|undefined} texts - The field's own texts
 * @param {string|undefined} key - Translation key
 * @param {string} lang - Reader's language
 * @param {function(string): string} translate - Bundle lookup; returns the key when missing
 * @returns {{text: string, own: boolean}} The text and whether the unit wrote it
 */
export function resolveFormText(texts, key, lang, translate) {
  if (richTextHasContent(texts?.[lang])) {
    return { text: texts[lang], own: true };
  }
  if (key) {
    const translated = translate(key);
    if (translated && translated !== key) {
      return { text: translated, own: false };
    }
  }
  const fallback = ownText(texts, lang);
  if (fallback !== null) {
    return { text: fallback, own: true };
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
 * @returns {string} HTML
 */
export function formLabelHtml(field, lang, translate) {
  const { text, own } = resolveFormText(field.labelText, field.label || field.name, lang, translate);
  return own ? escapeHTML(text) : text;
}

/**
 * An information-text field's content as HTML, sanitized when the unit wrote it.
 *
 * @param {Object} field - Form field of type `infoText`
 * @param {string} lang - Reader's language
 * @param {function(string): string} translate - Bundle lookup
 * @returns {string} HTML
 */
export function formInfoHtml(field, lang, translate) {
  const { text, own } = resolveFormText(field.infoHtml, field.infoText, lang, translate);
  return own ? sanitizeRichText(text) : text;
}
