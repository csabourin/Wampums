/**
 * DOM Utility Functions for Safe HTML Manipulation
 *
 * Provides helper functions for safely setting HTML content and creating DOM elements.
 * All HTML content is automatically sanitized to prevent XSS attacks.
 *
 * @module utils/DOMUtils
 */

import { sanitizeHTML } from './SecurityUtils.js';

/**
 * Safely set HTML content (auto-sanitizes)
 *
 * Use this instead of directly setting innerHTML when you need to insert HTML.
 * Content is automatically sanitized to prevent XSS attacks.
 *
 * @param {HTMLElement} element - Target element
 * @param {string} content - HTML content to set (will be sanitized)
 * @returns {HTMLElement} The element (for chaining)
 *
 * @example
 * import { setContent } from './utils/DOMUtils.js';
 * const div = document.getElementById('description');
 * setContent(div, apiResponse.htmlContent);
 */
export function setContent(element, content) {
  if (!element) {
    console.error('setContent: element is null or undefined');
    return null;
  }

  element.innerHTML = sanitizeHTML(content);
  return element;
}

/**
 * Set text content (no HTML, completely safe)
 *
 * Use this for user-generated text that should not contain any HTML.
 * This is the safest method as it treats everything as plain text.
 *
 * @param {HTMLElement} element - Target element
 * @param {string} text - Text content (HTML will be escaped)
 * @returns {HTMLElement} The element (for chaining)
 *
 * @example
 * import { setText } from './utils/DOMUtils.js';
 * setText(document.getElementById('username'), userData.name);
 */
export function setText(element, text) {
  if (!element) {
    console.error('setText: element is null or undefined');
    return null;
  }

  element.textContent = text;
  return element;
}

/**
 * Create element with safe content
 *
 * Creates a new DOM element with optional content, classes, and attributes.
 * HTML content is automatically sanitized.
 *
 * @param {string} tag - HTML tag name (e.g., 'div', 'span', 'p')
 * @param {Object} options - Configuration options
 * @param {string} [options.content] - HTML content (will be sanitized)
 * @param {string} [options.text] - Text content (safe, no HTML)
 * @param {string} [options.className] - CSS classes (space-separated)
 * @param {string} [options.id] - Element ID
 * @param {Object} [options.attributes] - Additional attributes as key-value pairs
 * @param {Object} [options.style] - Inline styles as key-value pairs
 * @returns {HTMLElement} The created element
 *
 * @example
 * import { createElement } from './utils/DOMUtils.js';
 *
 * // Create element with safe text
 * const userDiv = createElement('div', {
 *   text: userData.name,
 *   className: 'user-name',
 *   id: 'current-user'
 * });
 *
 * // Create element with sanitized HTML
 * const description = createElement('div', {
 *   content: apiResponse.description,
 *   className: 'description rich-text'
 * });
 *
 * // Create element with attributes
 * const link = createElement('a', {
 *   text: 'Click here',
 *   attributes: { href: '/page', target: '_blank' }
 * });
 */
export function createElement(tag, options = {}) {
  const element = document.createElement(tag);

  // Set ID if provided
  if (options.id) {
    element.id = options.id;
  }

  // Set className if provided
  if (options.className) {
    element.className = options.className;
  }

  // Set attributes if provided
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
  }

  // Set inline styles if provided
  if (options.style) {
    Object.entries(options.style).forEach(([key, value]) => {
      element.style[key] = value;
    });
  }

  // Set content (text takes precedence over HTML content)
  if (options.text) {
    element.textContent = options.text;
  } else if (options.content) {
    element.innerHTML = sanitizeHTML(options.content);
  }

  return element;
}

/**
 * Append multiple children to a parent element
 *
 * @param {HTMLElement} parent - Parent element
 * @param {...(HTMLElement|string)} children - Child elements or text
 * @returns {HTMLElement} The parent element (for chaining)
 *
 * @example
 * import { appendChildren, createElement } from './utils/DOMUtils.js';
 *
 * const container = document.getElementById('container');
 * appendChildren(
 *   container,
 *   createElement('h1', { text: 'Title' }),
 *   createElement('p', { text: 'Description' }),
 *   createElement('button', { text: 'Click Me' })
 * );
 */
export function appendChildren(parent, ...children) {
  if (!parent) {
    console.error('appendChildren: parent is null or undefined');
    return null;
  }

  children.forEach(child => {
    if (typeof child === 'string') {
      parent.appendChild(document.createTextNode(child));
    } else if (child instanceof HTMLElement) {
      parent.appendChild(child);
    }
  });

  return parent;
}

/**
 * Clear all children from an element
 *
 * @param {HTMLElement} element - Element to clear
 * @returns {HTMLElement} The element (for chaining)
 *
 * @example
 * import { clearElement } from './utils/DOMUtils.js';
 * clearElement(document.getElementById('results'));
 */
export function clearElement(element) {
  if (!element) {
    console.error('clearElement: element is null or undefined');
    return null;
  }

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }

  return element;
}

/**
 * Replace element content with new content (clears first, then sets)
 *
 * @param {HTMLElement} element - Target element
 * @param {string} content - HTML content (will be sanitized)
 * @returns {HTMLElement} The element (for chaining)
 *
 * @example
 * import { replaceContent } from './utils/DOMUtils.js';
 * replaceContent(document.getElementById('results'), apiResponse.html);
 */
export function replaceContent(element, content) {
  return setContent(clearElement(element), content);
}

/**
 * Create a fragment from HTML string (sanitized)
 *
 * Useful for creating multiple elements at once from HTML.
 *
 * @param {string} html - HTML string (will be sanitized)
 * @returns {DocumentFragment} Document fragment containing the created elements
 *
 * @example
 * import { createFragment } from './utils/DOMUtils.js';
 *
 * const fragment = createFragment(`
 *   <div class="card">
 *     <h2>Title</h2>
 *     <p>Description</p>
 *   </div>
 * `);
 * document.body.appendChild(fragment);
 */
export function createFragment(html) {
  const template = document.createElement('template');
  template.innerHTML = sanitizeHTML(html);
  return template.content;
}

/**
 * Safely insert HTML at a specific position
 *
 * @param {HTMLElement} element - Target element
 * @param {string} position - Where to insert: 'beforebegin', 'afterbegin', 'beforeend', 'afterend'
 * @param {string} html - HTML to insert (will be sanitized)
 *
 * @example
 * import { insertHTML } from './utils/DOMUtils.js';
 * insertHTML(element, 'beforeend', '<p>New paragraph</p>');
 */
export function insertHTML(element, position, html) {
  if (!element) {
    console.error('insertHTML: element is null or undefined');
    return;
  }

  const validPositions = ['beforebegin', 'afterbegin', 'beforeend', 'afterend'];
  if (!validPositions.includes(position)) {
    console.error(`insertHTML: invalid position '${position}'. Must be one of: ${validPositions.join(', ')}`);
    return;
  }

  const sanitized = sanitizeHTML(html);
  element.insertAdjacentHTML(position, sanitized);
}

/**
 * Check if element is in viewport
 *
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if element is visible in viewport
 *
 * @example
 * import { isInViewport } from './utils/DOMUtils.js';
 * if (isInViewport(element)) {
 *   // Element is visible
 * }
 */
export function isInViewport(element) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * Scroll element into view smoothly
 *
 * @param {HTMLElement} element - Element to scroll to
 * @param {Object} options - Scroll options
 * @param {string} [options.behavior='smooth'] - Scroll behavior: 'smooth' or 'auto'
 * @param {string} [options.block='start'] - Vertical alignment: 'start', 'center', 'end', 'nearest'
 * @param {string} [options.inline='nearest'] - Horizontal alignment
 *
 * @example
 * import { scrollToElement } from './utils/DOMUtils.js';
 * scrollToElement(document.getElementById('error-message'));
 */
export function scrollToElement(element, options = {}) {
  if (!element) {
    console.error('scrollToElement: element is null or undefined');
    return;
  }

  element.scrollIntoView({
    behavior: options.behavior || 'smooth',
    block: options.block || 'start',
    inline: options.inline || 'nearest'
  });
}

/**
 * Default export with all functions
 */
export default {
  setContent,
  setText,
  createElement,
  appendChildren,
  clearElement,
  replaceContent,
  createFragment,
  insertHTML,
  isInViewport,
  scrollToElement
};
