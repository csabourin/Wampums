/**
 * Base Module Class
 *
 * Provides common functionality for all SPA modules including:
 * - Automatic event listener cleanup via AbortController
 * - Resource cleanup on navigation
 * - Prevents memory leaks
 *
 * Usage:
 * ```javascript
 * import { BaseModule } from './utils/BaseModule.js';
 *
 * export class MyModule extends BaseModule {
 *   constructor(app) {
 *     super(app);
 *     // Your initialization
 *   }
 *
 *   async init() {
 *     // Use this.signal when adding event listeners
 *     document.getElementById('btn').addEventListener('click', handler, { signal: this.signal });
 *   }
 *
 *   // Override if you need custom cleanup
 *   destroy() {
 *     super.destroy(); // IMPORTANT: Call parent destroy
 *     // Your custom cleanup
 *   }
 * }
 * ```
 */

import { debugLog } from './DebugUtils.js';

export class BaseModule {
  /**
   * Initialize base module with AbortController for event listener cleanup
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;

    // MEMORY LEAK FIX: AbortController for automatic event listener cleanup
    this.abortController = new AbortController();
  }

  /**
   * Get the abort signal for event listeners
   * Use this when adding event listeners to enable automatic cleanup
   * @returns {AbortSignal} Signal that aborts when module is destroyed
   */
  get signal() {
    return this.abortController.signal;
  }

  /**
   * Clean up event listeners and resources
   * CRITICAL: Automatically called by router when navigating away
   *
   * Override this method to add custom cleanup, but ALWAYS call super.destroy()
   */
  destroy() {
    const moduleName = this.constructor.name;
    debugLog(`[${moduleName}] Cleaning up resources and event listeners`);

    // Abort all event listeners attached with this controller's signal
    this.abortController.abort();

    // Create new controller for potential reuse (though modules are typically not reused)
    this.abortController = new AbortController();
  }

  /**
   * Helper method to safely attach event listeners with automatic cleanup
   * @param {Element} element - DOM element
   * @param {string} event - Event name (e.g., 'click')
   * @param {Function} handler - Event handler function
   * @param {Object} options - Additional event listener options (signal is automatically added)
   */
  addEventListener(element, event, handler, options = {}) {
    if (!element) {
      console.warn(`[${this.constructor.name}] Attempted to add listener to null element`);
      return;
    }

    // Merge options with signal
    const listenerOptions = { ...options, signal: this.signal };
    element.addEventListener(event, handler, listenerOptions);
  }

  /**
   * Helper method to attach listeners to multiple elements (e.g., from querySelectorAll)
   * @param {NodeList|Array} elements - Collection of DOM elements
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   * @param {Object} options - Additional event listener options
   */
  addEventListeners(elements, event, handler, options = {}) {
    if (!elements || !elements.length) {
      return;
    }

    elements.forEach(element => {
      this.addEventListener(element, event, handler, options);
    });
  }
}

/**
 * Mixin function to add BaseModule functionality to existing classes
 * Use this for classes that can't extend BaseModule directly
 *
 * @param {Class} TargetClass - The class to add cleanup functionality to
 * @returns {Class} Enhanced class with cleanup functionality
 *
 * Usage:
 * ```javascript
 * class MyModule {
 *   constructor(app) {
 *     this.app = app;
 *     initializeCleanup(this); // Add cleanup functionality
 *   }
 * }
 * ```
 */
export function initializeCleanup(instance) {
  instance.abortController = new AbortController();

  Object.defineProperty(instance, 'signal', {
    get() {
      return this.abortController.signal;
    }
  });

  // Add destroy method if it doesn't exist
  if (!instance.destroy) {
    instance.destroy = function() {
      const moduleName = this.constructor.name;
      debugLog(`[${moduleName}] Cleaning up resources (via mixin)`);
      this.abortController.abort();
      this.abortController = new AbortController();
    };
  }

  // Add helper methods
  instance.addEventListener = BaseModule.prototype.addEventListener.bind(instance);
  instance.addEventListeners = BaseModule.prototype.addEventListeners.bind(instance);

  return instance;
}
