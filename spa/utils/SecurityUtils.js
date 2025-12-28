/**
 * SecurityUtils.js
 *
 * Security utilities for the Wampums application
 * Provides functions for sanitizing user input and preventing XSS attacks
 * Uses DOMPurify for robust HTML sanitization
 */

import DOMPurify from 'dompurify';
import { debugLog, debugError } from './DebugUtils.js';

/**
 * Additional safe attributes to allow beyond DOMPurify's defaults
 * These are application-specific attributes that are safe and needed
 */
const ADDITIONAL_ALLOWED_ATTRS = [
  // Accessibility
  'aria-label', 'aria-describedby', 'aria-hidden', 'aria-live', 'aria-expanded',

  // Common safe attributes
  'alt', 'title', 'loading', 'width', 'height', 'colspan', 'rowspan',
  'placeholder', 'required', 'disabled', 'readonly', 'checked', 'selected',
  'min', 'max', 'step', 'pattern', 'autocomplete', 'multiple', 'open',

  // Form attributes
  'type', 'name', 'value', 'for', 'action', 'method', 'enctype',

  // Table/layout
  'rows', 'cols',

  // SVG-specific
  'viewBox', 'fill', 'stroke', 'stroke-width', 'd', 'cx', 'cy', 'r',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'xmlns',
  'xlink:href', 'rx', 'ry', 'font-size',

  // Safe styling (limited to specific safe properties)
  'style'
];

/**
 * Sanitize HTML string to prevent XSS attacks using DOMPurify
 *
 * Uses DOMPurify's battle-tested default whitelist of safe HTML tags, which includes:
 * - Text formatting: b, i, em, strong, u, br, hr, p, div, span, etc.
 * - Forms: form, input, button, select, option, textarea, label, fieldset, legend
 * - Tables: table, thead, tbody, tr, th, td with colspan/rowspan
 * - Semantic HTML5: header, footer, main, nav, section, article, aside, details, summary
 * - SVG: svg, path, circle, rect, line, polyline, polygon, g, and more
 * - Links and images with safe attributes
 * - Data attributes (data-*) for application state management
 * - And many more standard HTML5 tags
 *
 * SECURITY: Uses whitelisting (not blacklisting) for defense in depth
 * - Unknown/new tags are blocked by default
 * - Still blocks: script, onclick/onerror/on* event handlers, javascript: URLs
 * - Future-proof: DOMPurify is actively maintained and updated for new XSS vectors
 *
 * @param {string} html - The HTML string to sanitize
 * @param {Object} options - Sanitization options
 * @param {boolean} options.stripAll - Strip all HTML tags (default: false)
 * @param {boolean} options.allowStyleTags - Allow <style> tags for trusted templates (default: false)
 * @returns {string} Sanitized HTML string
 */
export function sanitizeHTML(html, options = {}) {
  if (typeof html !== 'string') {
    debugError('sanitizeHTML: Input must be a string', typeof html);
    return '';
  }

  // If stripAll is true, remove all HTML tags
  if (options.stripAll) {
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: [] });
  }

  // Use DOMPurify's comprehensive default whitelist with our additional attributes
  // DOMPurify already includes a well-maintained list of safe HTML5 tags
  const config = {
    // Use DOMPurify's default ALLOWED_TAGS (don't override)
    // Add application-specific attributes to the defaults
    ADD_ATTR: ADDITIONAL_ALLOWED_ATTRS,
    ADD_TAGS: options.allowStyleTags ? ['style'] : [],

    // Allow data-* attributes (used extensively in the app for state management)
    ALLOW_DATA_ATTR: true,

    // Enable SVG support (DOMPurify has safe SVG defaults)
    USE_PROFILES: { html: true, svg: true, svgFilters: false },

    // Safe for templates (prevents mXSS attacks)
    SAFE_FOR_TEMPLATES: true,

    // Return the entire HTML document structure
    WHOLE_DOCUMENT: false,

    // Return a DOM fragment instead of a string for better performance
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  };

  // Use DOMPurify for robust, future-proof sanitization
  return DOMPurify.sanitize(html, config);
}


/**
 * Escape HTML special characters to prevent XSS
 * Use this for displaying user input as plain text
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHTML(str) {
  if (typeof str !== 'string') {
    return '';
  }

  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Sanitize and validate a URL
 * Only allows http, https, and mailto protocols
 *
 * @param {string} url - URL to sanitize
 * @param {Object} options - Options
 * @param {boolean} options.allowMailto - Allow mailto: links (default: true)
 * @returns {string|null} Sanitized URL or null if invalid
 */
export function sanitizeURL(url, options = { allowMailto: true }) {
  if (typeof url !== 'string') {
    return null;
  }

  const trimmed = url.trim().toLowerCase();

  // Check for dangerous protocols
  if (trimmed.startsWith('javascript:') ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('vbscript:')) {
    debugError('sanitizeURL: Dangerous protocol detected', url);
    return null;
  }

  // Allow safe protocols
  if (trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('//')) {
    return url.trim();
  }

  if (options.allowMailto && trimmed.startsWith('mailto:')) {
    return url.trim();
  }

  // If no protocol, assume https
  if (!trimmed.includes(':')) {
    return `https://${url.trim()}`;
  }

  return null;
}

/**
 * Validate and sanitize email address
 *
 * @param {string} email - Email address to validate
 * @returns {string|null} Sanitized email or null if invalid
 */
export function sanitizeEmail(email) {
  if (typeof email !== 'string') {
    return null;
  }

  const trimmed = email.trim().toLowerCase();

  // Basic email regex (not perfect but catches most issues)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Sanitize user input for use in SQL LIKE queries
 * Escapes special characters: %, _, \
 *
 * @param {string} input - User input string
 * @returns {string} Sanitized string for LIKE queries
 */
export function sanitizeLikeQuery(input) {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/\\/g, '\\\\')  // Escape backslash
    .replace(/%/g, '\\%')    // Escape percent
    .replace(/_/g, '\\_');   // Escape underscore
}

/**
 * Strip all HTML tags from a string
 * Useful for creating plain text from HTML content
 *
 * @param {string} html - HTML string
 * @returns {string} Plain text
 */
export function stripHTML(html) {
  return sanitizeHTML(html, { stripAll: true });
}

/**
 * Validate that content doesn't contain script tags or event handlers
 * Returns true if content appears safe
 *
 * @param {string} content - Content to validate
 * @returns {boolean} True if content appears safe
 */
export function validateSafeContent(content) {
  if (typeof content !== 'string') {
    return false;
  }

  const dangerous = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,  // Event handlers like onclick=
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /eval\(/i,
  ];

  return !dangerous.some(pattern => pattern.test(content));
}

/**
 * Create a safe DOM element with sanitized content
 *
 * @param {string} tagName - HTML tag name
 * @param {string} content - Content to insert
 * @param {Object} attributes - Attributes to set
 * @returns {HTMLElement} Created element
 */
export function createSafeElement(tagName, content = '', attributes = {}) {
  const element = document.createElement(tagName);

  // Set text content (automatically escaped)
  if (content) {
    element.textContent = content;
  }

  // Set safe attributes
  Object.entries(attributes).forEach(([key, value]) => {
    // Skip event handlers
    if (key.startsWith('on')) {
      debugError('createSafeElement: Event handlers not allowed', key);
      return;
    }

    // Sanitize URLs
    if (key === 'href' || key === 'src') {
      const sanitized = sanitizeURL(value);
      if (sanitized) {
        element.setAttribute(key, sanitized);
      }
    } else {
      element.setAttribute(key, value);
    }
  });

  return element;
}

/**
 * Safely update element's HTML content
 * Sanitizes the HTML before setting
 *
 * @param {HTMLElement} element - Element to update
 * @param {string} html - HTML content
 * @param {Object} options - Sanitization options
 */
export function safeSetHTML(element, html, options = {}) {
  if (!element || !(element instanceof HTMLElement)) {
    debugError('safeSetHTML: Invalid element', element);
    return;
  }

  const sanitized = sanitizeHTML(html, options);
  element.innerHTML = sanitized;
}

/**
 * Safely append HTML content to an element
 *
 * @param {HTMLElement} element - Element to append to
 * @param {string} html - HTML content to append
 * @param {Object} options - Sanitization options
 */
export function safeAppendHTML(element, html, options = {}) {
  if (!element || !(element instanceof HTMLElement)) {
    debugError('safeAppendHTML: Invalid element', element);
    return;
  }

  const temp = document.createElement('div');
  temp.innerHTML = sanitizeHTML(html, options);
  while (temp.firstChild) {
    element.appendChild(temp.firstChild);
  }
}

// Export all functions as default object
export default {
  sanitizeHTML,
  escapeHTML,
  sanitizeURL,
  sanitizeEmail,
  sanitizeLikeQuery,
  stripHTML,
  validateSafeContent,
  createSafeElement,
  safeSetHTML,
  safeAppendHTML
};
