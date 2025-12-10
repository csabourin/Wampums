/**
 * Performance and State Management Utilities
 */

/**
 * Debounce function to limit how often a function can fire
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Cache with Time-To-Live (TTL) support
 */
export class CacheWithTTL {
  constructor(ttlMs = 300000) { // 5 minutes default
    this.cache = new Map();
    this.ttl = ttlMs;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expires: Date.now() + this.ttl
    });
  }

  get(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expires) {
      this.cache.delete(key);
      return null;
    }

    return cached.value;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  // Cleanup expired entries
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Retry async operations with exponential backoff
 * @param {Function} asyncFn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} Result of async function
 */
export async function retryWithBackoff(asyncFn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    onRetry = null
  } = options;

  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await asyncFn();
    } catch (error) {
      lastError = error;

      // Don't retry on client errors (4xx)
      if (error.status >= 400 && error.status < 500) {
        throw error;
      }

      if (attempt < maxRetries - 1) {
        const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

        if (onRetry) {
          onRetry(attempt + 1, maxRetries, delay, error);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Loading state manager for preventing race conditions
 */
export class LoadingStateManager {
  constructor() {
    this.loadingStates = new Map();
  }

  isLoading(key) {
    return this.loadingStates.get(key) === true;
  }

  setLoading(key, isLoading) {
    if (isLoading) {
      this.loadingStates.set(key, true);
    } else {
      this.loadingStates.delete(key);
    }
  }

  async withLoading(key, asyncFn) {
    if (this.isLoading(key)) {
      return null; // Skip if already loading
    }

    this.setLoading(key, true);
    try {
      return await asyncFn();
    } finally {
      this.setLoading(key, false);
    }
  }
}

/**
 * Request cancellation manager
 */
export class RequestCancellationManager {
  constructor() {
    this.controllers = new Map();
  }

  create(key) {
    // Cancel any existing request with this key
    this.cancel(key);

    const controller = new AbortController();
    this.controllers.set(key, controller);
    return controller.signal;
  }

  cancel(key) {
    const controller = this.controllers.get(key);
    if (controller) {
      controller.abort();
      this.controllers.delete(key);
    }
  }

  cancelAll() {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
  }
}
