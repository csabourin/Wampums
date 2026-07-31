/**
 * Email Utilities
 *
 * Helpers for rendering email addresses as safe, clickable links.
 */

import { escapeHTML, sanitizeEmail } from './SecurityUtils.js';

/**
 * Create a clickable email link with the mailto: protocol.
 *
 * Addresses that fail validation are still displayed (a malformed address on
 * file is useful information for a leader trying to reach a parent) but are
 * rendered as plain text rather than a link.
 *
 * @param {string} email - Email address to link
 * @param {string} [label] - Optional link text (defaults to the address)
 * @returns {string} HTML string with a clickable mailto: link, or escaped text
 */
export function createEmailLink(email, label = null) {
  if (!email) {
    return '';
  }

  const raw = email.toString().trim();
  const safeAddress = sanitizeEmail(raw);
  const displayText = escapeHTML(label || raw);

  if (!safeAddress) {
    return displayText;
  }

  // sanitizeEmail already rejects whitespace, control characters and the
  // quoting characters, so escaping is all the href attribute context needs.
  return `<a href="mailto:${escapeHTML(safeAddress)}" class="email-link">${displayText}</a>`;
}
