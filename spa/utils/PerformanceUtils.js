/**
 * Performance and State Management Utilities
 */
import { debugLog } from './DebugUtils.js';


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

/**
 * Performance Monitoring Utilities
 */

// Global cache hit tracking
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Record a cache hit
 */
export function recordCacheHit() {
  cacheHits++;
}

/**
 * Record a cache miss
 */
export function recordCacheMiss() {
  cacheMisses++;
}

/**
 * Get cache hit rate percentage
 * @returns {string} Cache hit rate as percentage
 */
export function getCacheHitRate() {
  const total = cacheHits + cacheMisses;
  return total > 0 ? (cacheHits / total * 100).toFixed(2) : '0.00';
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
  return {
    hits: cacheHits,
    misses: cacheMisses,
    total: cacheHits + cacheMisses,
    hitRate: getCacheHitRate()
  };
}

/**
 * Reset cache statistics
 */
export function resetCacheStats() {
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * Performance Monitor for tracking API calls, page loads, and other metrics
 */
export class PerformanceMonitor {
  /**
   * Log API call performance
   * @param {string} endpoint - API endpoint
   * @param {number} duration - Duration in milliseconds
   * @param {boolean} cacheHit - Whether the result came from cache
   */
  static logAPICall(endpoint, duration, cacheHit) {
    const source = cacheHit ? 'CACHE HIT' : 'NETWORK';
    debugLog(`[API] ${endpoint} - ${duration}ms - ${source}`);

    // Track cache statistics
    if (cacheHit) {
      recordCacheHit();
    } else {
      recordCacheMiss();
    }
  }

  /**
   * Log page load performance
   * @param {string} page - Page name or route
   * @param {number} duration - Duration in milliseconds
   */
  static logPageLoad(page, duration) {
    debugLog(`[PAGE] ${page} - ${duration}ms`);
  }

  /**
   * Measure execution time of an async function
   * @param {string} label - Label for the operation
   * @param {Function} asyncFn - Async function to measure
   * @returns {Promise} Result of the async function
   */
  static async measure(label, asyncFn) {
    const startTime = performance.now();
    try {
      const result = await asyncFn();
      const duration = performance.now() - startTime;
      debugLog(`[PERF] ${label} - ${duration.toFixed(2)}ms`);
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      debugLog(`[PERF] ${label} - ${duration.toFixed(2)}ms (FAILED)`);
      throw error;
    }
  }

  /**
   * Start a performance measurement
   * @param {string} label - Label for the measurement
   * @returns {Object} Timer object with end() method
   */
  static start(label) {
    const startTime = performance.now();
    return {
      end: () => {
        const duration = performance.now() - startTime;
        debugLog(`[PERF] ${label} - ${duration.toFixed(2)}ms`);
        return duration;
      }
    };
  }

  /**
   * Log cache statistics
   */
  static logCacheStats() {
    const stats = getCacheStats();
    debugLog(`[CACHE] Hits: ${stats.hits}, Misses: ${stats.misses}, Hit Rate: ${stats.hitRate}%`);
  }

  /**
   * Create a performance mark (uses browser Performance API)
   * @param {string} name - Mark name
   */
  static mark(name) {
    if (performance.mark) {
      performance.mark(name);
    }
  }

  /**
   * Measure between two performance marks
   * @param {string} name - Measure name
   * @param {string} startMark - Start mark name
   * @param {string} endMark - End mark name
   * @returns {number} Duration in milliseconds
   */
  static measureBetween(name, startMark, endMark) {
    if (performance.measure) {
      performance.measure(name, startMark, endMark);
      const measures = performance.getEntriesByName(name);
      if (measures.length > 0) {
        const duration = measures[0].duration;
        debugLog(`[PERF] ${name} - ${duration.toFixed(2)}ms`);
        return duration;
      }
    }
    return 0;
  }
}
