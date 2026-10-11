/**
 * Formatted texts that also exist as plain text: announcement messages and
 * activity descriptions.
 *
 * The server keeps both versions (utils/richText.js) and derives the plain
 * one; older texts, and texts written by the mobile app, are plain only.
 * These helpers turn one into the other for the editor and for display.
 *
 * @module utils/RichTextUtils
 */

import { escapeHTML } from './SecurityUtils.js';
import { richTextHasContent, sanitizeRichText } from './FormTextUtils.js';

/**
 * Rich text for plain text: paragraphs at blank lines, line breaks kept.
 *
 * @param {string} text - Plain text
 * @returns {string} Safe HTML
 */
export function plainTextToRichText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }
  return text.trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escapeHTML(paragraph.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * The formatted version of a text when it has one, else its plain version
 * with its line breaks: what the editor starts from and what pages show.
 *
 * @param {string|null|undefined} html - Formatted text
 * @param {string|null|undefined} text - Plain text
 * @returns {string} Safe HTML
 */
export function richTextOrPlain(html, text) {
  const safe = sanitizeRichText(html || '');
  return richTextHasContent(safe) ? safe : plainTextToRichText(text || '');
}

/**
 * Append the plain text of a node and its children.
 *
 * @param {Node} node - Node to read
 * @param {string[]} parts - Output pieces
 * @param {Array<{ordered: boolean, count: number}>} lists - Open lists
 * @returns {void}
 */
function appendPlainText(node, parts, lists) {
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.textContent.replace(/\s+/g, ' '));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  const tag = node.tagName.toLowerCase();
  if (tag === 'br') {
    parts.push('\n');
    return;
  }
  const isList = tag === 'ul' || tag === 'ol';
  if (isList) {
    // A list starts on its own, after a blank line
    if (lists.length === 0) {
      parts.push('\n');
    }
    lists.push({ ordered: tag === 'ol', count: 0 });
  }
  if (tag === 'li') {
    const list = lists[lists.length - 1];
    if (list) {
      list.count += 1;
    }
    parts.push(`\n${'  '.repeat(Math.max(lists.length - 1, 0))}${list?.ordered ? `${list.count}.` : '-'} `);
  }
  node.childNodes.forEach((child) => appendPlainText(child, parts, lists));
  if (tag === 'p' || tag === 'div') {
    parts.push('\n\n');
  }
  if (isList) {
    lists.pop();
    if (lists.length === 0) {
      parts.push('\n\n');
    }
  }
}

/**
 * Plain text for rich text, keeping paragraphs, line breaks and list
 * markers. The server derives the stored plain text itself; this one feeds
 * checks and tools that take text, such as the writing assistant.
 *
 * @param {string} html - Rich text
 * @returns {string} Plain text
 */
export function richTextToPlainText(html) {
  const safe = sanitizeRichText(html || '');
  if (!safe) {
    return '';
  }
  const body = new DOMParser().parseFromString(safe, 'text/html').body;
  const parts = [];
  appendPlainText(body, parts, []);
  return parts.join('')
    .split('\n')
    .map((line) => line.replace(/[ \u00A0]+$/, '').replace(/^ (?=\S)/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
