const rateLimit = require("express-rate-limit");
const logger = require("./logger");
const { RATE_LIMITS, CACHE } = require("./constants");

const RATE_LIMITER_CLEANUP_INTERVAL_MS = CACHE.CLEANUP_INTERVAL_MS;

/**
 * Generate a human-readable duration message from milliseconds
 * @param {number} ms - Duration in milliseconds
 * @returns {string} - Human-readable duration (e.g., "15 minutes", "1 hour")
 */
function formatDuration(ms) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    
    if (hours >= 1) {
        return hours === 1 ? "1 hour" : `${hours} hours`;
    }
    
    const minutes = Math.floor(ms / (60 * 1000));
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * CleanableMemoryStore - Rate limiter memory store with automatic expiration cleanup
 */
class CleanableMemoryStore {
    constructor(windowMs) {
        this.windowMs = windowMs;
        this.hits = new Map();
        this.resetTime = new Map();
    }

    async increment(key) {
        const now = Date.now();
        const resetTimeValue = this.resetTime.get(key);

        if (resetTimeValue && now > resetTimeValue) {
            this.hits.delete(key);
            this.resetTime.delete(key);
        }

        const currentHits = (this.hits.get(key) || 0) + 1;
        this.hits.set(key, currentHits);

        if (!this.resetTime.has(key)) {
            this.resetTime.set(key, now + this.windowMs);
        }

        return {
            totalHits: currentHits,
            resetTime: new Date(this.resetTime.get(key)),
        };
    }

    async decrement(key) {
        const currentHits = this.hits.get(key) || 0;
        if (currentHits > 0) {
            this.hits.set(key, currentHits - 1);
        }
    }

    async resetKey(key) {
        this.hits.delete(key);
        this.resetTime.delete(key);
    }

    async get(key) {
        const now = Date.now();
        const resetTimeValue = this.resetTime.get(key);

        if (resetTimeValue && now > resetTimeValue) {
            this.hits.delete(key);
            this.resetTime.delete(key);
            return undefined;
        }

        const hits = this.hits.get(key);
        if (hits === undefined) return undefined;

        return {
            totalHits: hits,
            resetTime: new Date(resetTimeValue),
        };
    }

    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, resetAt] of this.resetTime.entries()) {
            if (now > resetAt) {
                this.hits.delete(key);
                this.resetTime.delete(key);
                cleaned++;
            }
        }
        return cleaned;
    }

    size() {
        return this.hits.size;
    }

    clear() {
        this.hits.clear();
        this.resetTime.clear();
    }
}

// Create stores for each rate limiter
const generalStore = new CleanableMemoryStore(RATE_LIMITS.GENERAL_WINDOW_MS);
const authStore = new CleanableMemoryStore(RATE_LIMITS.AUTH_WINDOW_MS);
const passwordResetStore = new CleanableMemoryStore(RATE_LIMITS.PASSWORD_RESET_WINDOW_MS);

const generalLimiter = rateLimit({
    windowMs: RATE_LIMITS.GENERAL_WINDOW_MS,
    max: RATE_LIMITS.GENERAL_MAX_REQUESTS,
    message: `Too many requests from this IP, please try again after ${formatDuration(RATE_LIMITS.GENERAL_WINDOW_MS)}`,
    standardHeaders: true,
    legacyHeaders: false,
    store: generalStore,
});

const authLimiter = rateLimit({
    windowMs: RATE_LIMITS.AUTH_WINDOW_MS,
    max: RATE_LIMITS.AUTH_MAX_ATTEMPTS,
    message: `Too many login attempts from this IP, please try again after ${formatDuration(RATE_LIMITS.AUTH_WINDOW_MS)}`,
    standardHeaders: true,
    legacyHeaders: false,
    store: authStore,
});

const passwordResetLimiter = rateLimit({
    windowMs: RATE_LIMITS.PASSWORD_RESET_WINDOW_MS,
    max: RATE_LIMITS.PASSWORD_RESET_MAX_REQUESTS,
    message: `Too many password reset requests from this IP, please try again after ${formatDuration(RATE_LIMITS.PASSWORD_RESET_WINDOW_MS)}`,
    standardHeaders: true,
    legacyHeaders: false,
    store: passwordResetStore,
});

// Periodic cleanup of rate limiter stores (every 5 minutes)
const rateLimiterCleanupInterval = setInterval(() => {
    const generalCleaned = generalStore.cleanup();
    const authCleaned = authStore.cleanup();
    const passwordResetCleaned = passwordResetStore.cleanup();

    if (generalCleaned > 0 || authCleaned > 0 || passwordResetCleaned > 0) {
        logger.info("Rate limiter stores cleaned up", {
            cleaned: {
                general: generalCleaned,
                auth: authCleaned,
                passwordReset: passwordResetCleaned,
            },
            remaining: {
                general: generalStore.size(),
                auth: authStore.size(),
                passwordReset: passwordResetStore.size(),
            },
        });
    }
}, RATE_LIMITER_CLEANUP_INTERVAL_MS);

rateLimiterCleanupInterval.unref();

module.exports = {
    generalLimiter,
    authLimiter,
    passwordResetLimiter,
    CleanableMemoryStore,
};
