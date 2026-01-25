/**
 * Base Module Class
 *
 * Provides common functionality for all SPA modules including:
 * - Automatic event listener cleanup via AbortController
 * - Timeout and interval management with automatic cleanup
 * - Animation frame tracking and cancellation
 * - Observer management (ResizeObserver, MutationObserver, IntersectionObserver)
 * - Subscription/callback tracking for custom events
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
 *
 *     // Or use helper methods
 *     this.addEventListener(document.getElementById('btn'), 'click', handler);
 *
 *     // Managed timeouts (auto-cleared on destroy)
 *     this.setTimeout(() => this.refresh(), 5000);
 *
 *     // Managed intervals (auto-cleared on destroy)
 *     this.setInterval(() => this.poll(), 10000);
 *
 *     // Managed animation frames (auto-cancelled on destroy)
 *     this.requestAnimationFrame(() => this.animate());
 *
 *     // Managed observers (auto-disconnected on destroy)
 *     const observer = this.createResizeObserver((entries) => this.handleResize(entries));
 *     observer.observe(element);
 *   }
 *
 *   // Override if you need custom cleanup
 *   destroy() {
 *     super.destroy(); // IMPORTANT: Call parent destroy first
 *     // Your custom cleanup
 *   }
 * }
 * ```
 */

import { debugLog, debugWarn } from './DebugUtils.js';

export class BaseModule {
  /**
   * Initialize base module with automatic resource cleanup
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;

    // AbortController for automatic event listener cleanup
    this._abortController = new AbortController();

    // Track timeouts for cleanup
    this._timeoutIds = new Set();

    // Track intervals for cleanup
    this._intervalIds = new Set();

    // Track animation frames for cleanup
    this._animationFrameIds = new Set();

    // Track observers for cleanup
    this._observers = new Set();

    // Track custom subscriptions/callbacks for cleanup
    this._subscriptions = new Map();

    // Track if module has been destroyed
    this._destroyed = false;
  }

  /**
   * Get the abort signal for event listeners
   * Use this when adding event listeners to enable automatic cleanup
   * @returns {AbortSignal} Signal that aborts when module is destroyed
   */
  get signal() {
    return this._abortController.signal;
  }

  /**
   * Legacy getter for backward compatibility
   * @returns {AbortController} The abort controller instance
   */
  get abortController() {
    return this._abortController;
  }

  /**
   * Check if module has been destroyed
   * @returns {boolean} True if destroy() has been called
   */
  get isDestroyed() {
    return this._destroyed;
  }

  // ============================================================
  // EVENT LISTENER MANAGEMENT
  // ============================================================

  /**
   * Helper method to safely attach event listeners with automatic cleanup
   * @param {Element} element - DOM element
   * @param {string} event - Event name (e.g., 'click')
   * @param {Function} handler - Event handler function
   * @param {Object} options - Additional event listener options (signal is automatically added)
   */
  addEventListener(element, event, handler, options = {}) {
    if (this._destroyed) {
      debugWarn(`[${this.constructor.name}] Cannot add listener - module destroyed`);
      return;
    }

    if (!element) {
      debugWarn(`[${this.constructor.name}] Attempted to add listener to null element`);
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

  /**
   * Add event listener to window with automatic cleanup
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   * @param {Object} options - Additional event listener options
   */
  addWindowEventListener(event, handler, options = {}) {
    this.addEventListener(window, event, handler, options);
  }

  /**
   * Add event listener to document with automatic cleanup
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   * @param {Object} options - Additional event listener options
   */
  addDocumentEventListener(event, handler, options = {}) {
    this.addEventListener(document, event, handler, options);
  }

  // ============================================================
  // TIMEOUT MANAGEMENT
  // ============================================================

  /**
   * Create a managed timeout that is automatically cleared on destroy
   * @param {Function} callback - Function to execute
   * @param {number} delay - Delay in milliseconds
   * @returns {number} Timeout ID (can be used with clearTimeout if needed early)
   */
  setTimeout(callback, delay) {
    if (this._destroyed) {
      debugWarn(`[${this.constructor.name}] Cannot set timeout - module destroyed`);
      return null;
    }

    const timeoutId = window.setTimeout(() => {
      this._timeoutIds.delete(timeoutId);
      if (!this._destroyed) {
        callback();
      }
    }, delay);

    this._timeoutIds.add(timeoutId);
    return timeoutId;
  }

  /**
   * Clear a managed timeout
   * @param {number} timeoutId - Timeout ID to clear
   */
  clearTimeout(timeoutId) {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
      this._timeoutIds.delete(timeoutId);
    }
  }

  /**
   * Clear all managed timeouts
   */
  clearAllTimeouts() {
    for (const timeoutId of this._timeoutIds) {
      window.clearTimeout(timeoutId);
    }
    this._timeoutIds.clear();
  }

  // ============================================================
  // INTERVAL MANAGEMENT
  // ============================================================

  /**
   * Create a managed interval that is automatically cleared on destroy
   * @param {Function} callback - Function to execute
   * @param {number} delay - Interval in milliseconds
   * @returns {number} Interval ID (can be used with clearInterval if needed early)
   */
  setInterval(callback, delay) {
    if (this._destroyed) {
      debugWarn(`[${this.constructor.name}] Cannot set interval - module destroyed`);
      return null;
    }

    const intervalId = window.setInterval(() => {
      if (!this._destroyed) {
        callback();
      }
    }, delay);

    this._intervalIds.add(intervalId);
    return intervalId;
  }

  /**
   * Clear a managed interval
   * @param {number} intervalId - Interval ID to clear
   */
  clearInterval(intervalId) {
    if (intervalId != null) {
      window.clearInterval(intervalId);
      this._intervalIds.delete(intervalId);
    }
  }

  /**
   * Clear all managed intervals
   */
  clearAllIntervals() {
    for (const intervalId of this._intervalIds) {
      window.clearInterval(intervalId);
    }
    this._intervalIds.clear();
  }

  // ============================================================
  // ANIMATION FRAME MANAGEMENT
  // ============================================================

  /**
   * Create a managed animation frame that is automatically cancelled on destroy
   * @param {Function} callback - Function to execute
   * @returns {number} Animation frame ID
   */
  requestAnimationFrame(callback) {
    if (this._destroyed) {
      debugWarn(`[${this.constructor.name}] Cannot request animation frame - module destroyed`);
      return null;
    }

    const frameId = window.requestAnimationFrame((timestamp) => {
      this._animationFrameIds.delete(frameId);
      if (!this._destroyed) {
        callback(timestamp);
      }
    });

    this._animationFrameIds.add(frameId);
    return frameId;
  }

  /**
   * Cancel a managed animation frame
   * @param {number} frameId - Animation frame ID to cancel
   */
  cancelAnimationFrame(frameId) {
    if (frameId != null) {
      window.cancelAnimationFrame(frameId);
      this._animationFrameIds.delete(frameId);
    }
  }

  /**
   * Cancel all managed animation frames
   */
  cancelAllAnimationFrames() {
    for (const frameId of this._animationFrameIds) {
      window.cancelAnimationFrame(frameId);
    }
    this._animationFrameIds.clear();
  }

  // ============================================================
  // OBSERVER MANAGEMENT
  // ============================================================

  /**
   * Create a managed ResizeObserver that is automatically disconnected on destroy
   * @param {Function} callback - Observer callback function
   * @returns {ResizeObserver} The observer instance
   */
  createResizeObserver(callback) {
    if (this._destroyed) {
      debugWarn(`[${this.constructor.name}] Cannot create observer - module destroyed`);
      return null;
    }

    const observer = new ResizeObserver((entries, obs) => {
      if (!this._destroyed) {
        callback(entries, obs);
      }
    });

    this._observers.add(observer);
    return observer;
  }

  /**
   * Create a managed MutationObserver that is automatically disconnected on destroy
   * @param {Function} callback - Observer callback function
   * @returns {MutationObserver} The observer instance
   */
  createMutationObserver(callback) {
    if (this._destroyed) {
      debugWarn(`[${this.constructor.name}] Cannot create observer - module destroyed`);
      return null;
    }

    const observer = new MutationObserver((mutations, obs) => {
      if (!this._destroyed) {
        callback(mutations, obs);
      }
    });

    this._observers.add(observer);
    return observer;
  }

  /**
   * Create a managed IntersectionObserver that is automatically disconnected on destroy
   * @param {Function} callback - Observer callback function
   * @param {Object} options - IntersectionObserver options
   * @returns {IntersectionObserver} The observer instance
   */
  createIntersectionObserver(callback, options = {}) {
    if (this._destroyed) {
      debugWarn(`[${this.constructor.name}] Cannot create observer - module destroyed`);
      return null;
    }

    const observer = new IntersectionObserver((entries, obs) => {
      if (!this._destroyed) {
        callback(entries, obs);
      }
    }, options);

    this._observers.add(observer);
    return observer;
  }

  /**
   * Disconnect a specific observer
   * @param {ResizeObserver|MutationObserver|IntersectionObserver} observer - Observer to disconnect
   */
  disconnectObserver(observer) {
    if (observer) {
      observer.disconnect();
      this._observers.delete(observer);
    }
  }

  /**
   * Disconnect all managed observers
   */
  disconnectAllObservers() {
    for (const observer of this._observers) {
      observer.disconnect();
    }
    this._observers.clear();
  }

  // ============================================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================================

  /**
   * Register a subscription that should be cleaned up on destroy
   * Useful for custom event systems, pub/sub patterns, or external library subscriptions
   *
   * @param {string} key - Unique key for this subscription
   * @param {Function} unsubscribe - Function to call to unsubscribe
   * @returns {string} The subscription key
   *
   * @example
   * // With a custom event emitter
   * const handler = (data) => this.handleData(data);
   * eventEmitter.on('data', handler);
   * this.addSubscription('dataHandler', () => eventEmitter.off('data', handler));
   *
   * @example
   * // With an external library
   * const subscription = someLibrary.subscribe(callback);
   * this.addSubscription('librarySubscription', () => subscription.unsubscribe());
   */
  addSubscription(key, unsubscribe) {
    if (this._destroyed) {
      debugWarn(`[${this.constructor.name}] Cannot add subscription - module destroyed`);
      return null;
    }

    // If there's an existing subscription with this key, clean it up first
    this.removeSubscription(key);

    this._subscriptions.set(key, unsubscribe);
    return key;
  }

  /**
   * Remove and clean up a specific subscription
   * @param {string} key - Subscription key to remove
   */
  removeSubscription(key) {
    const unsubscribe = this._subscriptions.get(key);
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch (error) {
        debugWarn(`[${this.constructor.name}] Error cleaning up subscription '${key}':`, error);
      }
      this._subscriptions.delete(key);
    }
  }

  /**
   * Remove all subscriptions
   */
  removeAllSubscriptions() {
    for (const [key, unsubscribe] of this._subscriptions) {
      try {
        unsubscribe();
      } catch (error) {
        debugWarn(`[${this.constructor.name}] Error cleaning up subscription '${key}':`, error);
      }
    }
    this._subscriptions.clear();
  }

  // ============================================================
  // ASYNC OPERATION HELPERS
  // ============================================================

  /**
   * Run a callback only if the module hasn't been destroyed
   * Useful for async operations that might complete after navigation
   * @param {Function} callback - Function to execute if not destroyed
   * @returns {*} Result of callback, or undefined if destroyed
   */
  ifNotDestroyed(callback) {
    if (!this._destroyed) {
      return callback();
    }
  }

  /**
   * Wrap an async function to prevent execution after destroy
   * @param {Function} asyncFn - Async function to wrap
   * @returns {Function} Wrapped function that checks destroyed state
   */
  safeAsync(asyncFn) {
    return async (...args) => {
      if (this._destroyed) {
        return;
      }
      const result = await asyncFn(...args);
      // Check again after await in case destroy was called during execution
      if (this._destroyed) {
        return;
      }
      return result;
    };
  }

  // ============================================================
  // CLEANUP
  // ============================================================

  /**
   * Clean up all resources managed by this module
   * CRITICAL: Automatically called by router when navigating away
   *
   * Override this method to add custom cleanup, but ALWAYS call super.destroy() first
   */
  destroy() {
    if (this._destroyed) {
      debugWarn(`[${this.constructor.name}] destroy() called multiple times`);
      return;
    }

    const moduleName = this.constructor.name;
    debugLog(`[${moduleName}] Cleaning up resources and event listeners`);

    this._destroyed = true;

    // Abort all event listeners attached with this controller's signal
    this._abortController.abort();

    // Clear all timeouts
    this.clearAllTimeouts();

    // Clear all intervals
    this.clearAllIntervals();

    // Cancel all animation frames
    this.cancelAllAnimationFrames();

    // Disconnect all observers
    this.disconnectAllObservers();

    // Clean up all subscriptions
    this.removeAllSubscriptions();

    // Create new controller for potential reuse (though modules are typically not reused)
    this._abortController = new AbortController();
  }
}

// ============================================================
// MIXIN FUNCTION FOR NON-EXTENDING CLASSES
// ============================================================

/**
 * Mixin function to add BaseModule functionality to existing classes
 * Use this for classes that can't extend BaseModule directly
 *
 * @param {Object} instance - The instance to add cleanup functionality to
 * @returns {Object} Enhanced instance with cleanup functionality
 *
 * Usage:
 * ```javascript
 * class MyModule {
 *   constructor(app) {
 *     this.app = app;
 *     initializeCleanup(this); // Add cleanup functionality
 *   }
 *
 *   someMethod() {
 *     // Now you can use this.signal, this.setTimeout, etc.
 *     this.setTimeout(() => this.refresh(), 5000);
 *   }
 * }
 * ```
 */
export function initializeCleanup(instance) {
  // Initialize all tracking structures
  instance._abortController = new AbortController();
  instance._timeoutIds = new Set();
  instance._intervalIds = new Set();
  instance._animationFrameIds = new Set();
  instance._observers = new Set();
  instance._subscriptions = new Map();
  instance._destroyed = false;

  // Add signal getter
  Object.defineProperty(instance, 'signal', {
    get() {
      return this._abortController.signal;
    }
  });

  // Add abortController getter for backward compatibility
  Object.defineProperty(instance, 'abortController', {
    get() {
      return this._abortController;
    }
  });

  // Add isDestroyed getter
  Object.defineProperty(instance, 'isDestroyed', {
    get() {
      return this._destroyed;
    }
  });

  // Bind all methods from BaseModule.prototype
  const methodsToBind = [
    'addEventListener',
    'addEventListeners',
    'addWindowEventListener',
    'addDocumentEventListener',
    'setTimeout',
    'clearTimeout',
    'clearAllTimeouts',
    'setInterval',
    'clearInterval',
    'clearAllIntervals',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'cancelAllAnimationFrames',
    'createResizeObserver',
    'createMutationObserver',
    'createIntersectionObserver',
    'disconnectObserver',
    'disconnectAllObservers',
    'addSubscription',
    'removeSubscription',
    'removeAllSubscriptions',
    'ifNotDestroyed',
    'safeAsync'
  ];

  for (const method of methodsToBind) {
    instance[method] = BaseModule.prototype[method].bind(instance);
  }

  // Store original destroy if it exists
  const originalDestroy = instance.destroy;

  // Add destroy method that calls original if exists
  instance.destroy = function() {
    if (this._destroyed) {
      debugWarn(`[${this.constructor.name}] destroy() called multiple times`);
      return;
    }

    const moduleName = this.constructor.name;
    debugLog(`[${moduleName}] Cleaning up resources (via mixin)`);

    this._destroyed = true;

    // Abort all event listeners
    this._abortController.abort();

    // Clear all timeouts
    this.clearAllTimeouts();

    // Clear all intervals
    this.clearAllIntervals();

    // Cancel all animation frames
    this.cancelAllAnimationFrames();

    // Disconnect all observers
    this.disconnectAllObservers();

    // Clean up all subscriptions
    this.removeAllSubscriptions();

    // Create new controller
    this._abortController = new AbortController();

    // Call original destroy if it existed
    if (originalDestroy) {
      originalDestroy.call(this);
    }
  };

  return instance;
}
