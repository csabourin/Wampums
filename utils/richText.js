/**
 * Basic rich text for emailed content (announcements, activity descriptions).
 *
 * The SPA's editor (spa/modules/rich-text/RichTextEditor.js) produces
 * paragraphs, line breaks, bold, italic, bulleted and numbered lists, and
 * links. The server cannot trust what a client sends, and has no DOM to run
 * DOMPurify in, so this module rebuilds the HTML from scratch: it keeps only
 * those tags, never an attribute other than a link's checked address, and
 * escapes every piece of text. Anything else is dropped; the text of an
 * unknown tag is kept, the content of a script-like one is not.
 *
 * Every rich text also has a plain version, for the channels that cannot
 * show HTML: the text part of an email, push notifications, WhatsApp, Google
 * Chat, calendar files, and the mobile app.
 *
 * @module utils/richText
 */

const { escapeHtml } = require('./api-helpers');

/** Tags kept, after `b` → `strong` and `i` → `em`. */
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a']);
const TAG_ALIASES = { b: 'strong', i: 'em' };
/** Tags whose whole content is dropped with them. */
const DROPPED_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript',
  'textarea', 'title', 'svg', 'math', 'head', 'select', 'option',
]);
/** Link addresses kept: the same schemes as the SPA editor accepts. */
const LINK_PATTERN = /^(?:https?:|mailto:|tel:)/i;
const HREF_PATTERN = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const TAG_NAME_PATTERN = /^(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/;
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0',
};
const ENTITY_PATTERN = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g;
const MAX_CODE_POINT = 0x10FFFF;
const DECIMAL = 10;
const HEX = 16;
/** Longest rich text accepted; the plain version has its own limits. */
const RICH_TEXT_MAX_LENGTH = 50000;
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';

/**
 * Decode the character references a browser's editor produces.
 *
 * @param {string} text - Text that may hold entities
 * @returns {string} Decoded text
 */
function decodeEntities(text) {
  return text.replace(ENTITY_PATTERN, (match, decimal, hex, name) => {
    if (name) {
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name.toLowerCase())
        ? NAMED_ENTITIES[name.toLowerCase()]
        : match;
    }
    const codePoint = decimal ? parseInt(decimal, DECIMAL) : parseInt(hex, HEX);
    return codePoint > 0 && codePoint <= MAX_CODE_POINT ? String.fromCodePoint(codePoint) : '';
  });
}

/**
 * A link's address when it is one the editor could have produced.
 *
 * @param {string} attributes - The tag's attribute text
 * @returns {string|null} The address, or null
 */
function readHref(attributes) {
  const match = HREF_PATTERN.exec(attributes);
  if (!match) {
    return null;
  }
  const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? '').trim();
  return LINK_PATTERN.test(href) ? href : null;
}

/**
 * Split HTML into text and tag tokens, dropping comments and the content of
 * script-like elements. A `<` with no closing `>` ends the input, as it would
 * in a browser.
 *
 * @param {string} html - Untrusted HTML
 * @returns {Array<{type: 'text', value: string}|{type: 'tag', name: string, closing: boolean, attributes: string}>}
 */
function tokenize(html) {
  const tokens = [];
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open === -1) {
      tokens.push({ type: 'text', value: html.slice(index) });
      break;
    }
    if (open > index) {
      tokens.push({ type: 'text', value: html.slice(index, open) });
    }
    if (html.startsWith(COMMENT_OPEN, open)) {
      const end = html.indexOf(COMMENT_CLOSE, open + COMMENT_OPEN.length);
      index = end === -1 ? html.length : end + COMMENT_CLOSE.length;
      continue;
    }
    const close = html.indexOf('>', open + 1);
    if (close === -1) {
      break;
    }
    const inner = html.slice(open + 1, close);
    index = close + 1;
    const nameMatch = TAG_NAME_PATTERN.exec(inner);
    if (!nameMatch) {
      continue;
    }
    const closing = nameMatch[1] === '/';
    const name = nameMatch[2].toLowerCase();
    if (!closing && DROPPED_WITH_CONTENT.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, index);
      const endClose = end === -1 ? -1 : html.indexOf('>', end);
      index = endClose === -1 ? html.length : endClose + 1;
      continue;
    }
    tokens.push({ type: 'tag', name: TAG_ALIASES[name] || name, closing, attributes: inner.slice(nameMatch[0].length) });
  }
  return tokens;
}

/**
 * Rebuild untrusted HTML with only the editor's formatting.
 *
 * @param {string} html - Untrusted HTML
 * @returns {string} Safe HTML, or '' when no text remains
 */
function sanitizeRichTextHtml(html) {
  if (typeof html !== 'string') {
    return '';
  }
  const output = [];
  // Open elements, with whether their opening tag was written
  const stack = [];
  const closeTo = (depth) => {
    while (stack.length > depth) {
      const { name, written } = stack.pop();
      if (written) {
        output.push(`</${name}>`);
      }
    }
  };

  tokenize(html.slice(0, RICH_TEXT_MAX_LENGTH)).forEach((token) => {
    if (token.type === 'text') {
      output.push(escapeHtml(decodeEntities(token.value)));
      return;
    }
    if (!ALLOWED_TAGS.has(token.name)) {
      return;
    }
    if (token.closing) {
      const depth = stack.map(({ name }) => name).lastIndexOf(token.name);
      if (depth !== -1) {
        closeTo(depth);
      }
      return;
    }
    if (token.name === 'br') {
      output.push('<br>');
      return;
    }
    if (token.name === 'a') {
      const href = readHref(token.attributes);
      if (href) {
        output.push(`<a href="${escapeHtml(href)}">`);
      }
      stack.push({ name: 'a', written: Boolean(href) });
      return;
    }
    output.push(`<${token.name}>`);
    stack.push({ name: token.name, written: true });
  });
  closeTo(0);

  const safe = output.join('').replace(/<p>(?:\s|\u00A0|<br>)*<\/p>/g, '').trim();
  return richTextToPlainText(safe) ? safe : '';
}

/**
 * Plain text for rich text, keeping its shape: paragraphs, line breaks, list
 * markers, and link addresses after their text.
 *
 * @param {string} html - Rich text (sanitized here first)
 * @returns {string} Plain text
 */
function richTextToPlainText(html) {
  if (typeof html !== 'string' || html === '') {
    return '';
  }
  const parts = [];
  const lists = [];
  const links = [];

  tokenize(html).forEach((token) => {
    if (token.type === 'text') {
      const text = decodeEntities(token.value).replace(/\s+/g, ' ');
      parts.push(text);
      if (links.length > 0) {
        links[links.length - 1].text += text;
      }
      return;
    }
    const { name, closing } = token;
    if (name === 'br') {
      parts.push('\n');
    } else if (name === 'p' && closing) {
      parts.push('\n\n');
    } else if ((name === 'ul' || name === 'ol') && !closing) {
      // A list starts on its own, after a blank line
      if (lists.length === 0) {
        parts.push('\n');
      }
      lists.push({ ordered: name === 'ol', count: 0 });
    } else if ((name === 'ul' || name === 'ol') && closing) {
      lists.pop();
      if (lists.length === 0) {
        parts.push('\n\n');
      }
    } else if (name === 'li' && !closing) {
      const list = lists[lists.length - 1];
      const indent = '  '.repeat(Math.max(lists.length - 1, 0));
      if (list) {
        list.count += 1;
      }
      parts.push(`\n${indent}${list?.ordered ? `${list.count}.` : '-'} `);
    } else if (name === 'a' && !closing) {
      links.push({ href: readHref(token.attributes), text: '' });
    } else if (name === 'a' && closing) {
      const link = links.pop();
      const address = link?.href?.replace(/^mailto:/i, '');
      if (address && link.text.trim() !== address) {
        parts.push(` (${address})`);
      }
    }
  });

  return parts.join('')
    .split('\n')
    .map((line) => line.replace(/[ \u00A0]+$/, '').replace(/^ (?=\S)/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Rich text for plain text: paragraphs at blank lines, line breaks kept.
 *
 * @param {string} text - Plain text
 * @returns {string} Safe HTML
 */
function plainTextToRichText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }
  return text.trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Read a rich-text field sent by a client.
 *
 * @param {*} html - The field's value
 * @returns {{html: string|null, text: string|null}} Safe HTML and its plain
 *   text, both null when nothing visible remains
 */
function readRichTextField(html) {
  const safe = sanitizeRichTextHtml(html);
  if (!safe) {
    return { html: null, text: null };
  }
  return { html: safe, text: richTextToPlainText(safe) };
}

module.exports = {
  RICH_TEXT_MAX_LENGTH,
  plainTextToRichText,
  readRichTextField,
  richTextToPlainText,
  sanitizeRichTextHtml,
};
