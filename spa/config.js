/**
 * config.js
 *
 * Centralized configuration for the Wampums application.
 * All environment-specific and application-wide settings should be defined here.
 *
 * Usage:
 *   import { CONFIG } from './config.js';
 *   debugLog(CONFIG.API_BASE_URL);
 */
import { debugLog } from "./utils/DebugUtils.js";

/**
 * Determine if debug mode is enabled
 * Production is identified by domains ending in .app
 * @returns {boolean} True if debug mode is active
 */
function isDebugMode() {
    // Production domains end with .app - never show debug logs in production
    const isProduction = window.location.hostname.endsWith(".app");

    return (
        !isProduction &&
        (import.meta.env?.VITE_DEBUG_MODE === "true" ||
            import.meta.env?.DEV ||
            window.location.hostname === "localhost" ||
            window.location.hostname === "wampums-1.test" ||
            window.location.hostname.includes("replit.dev"))
    );
}

/**
 * Application Configuration Object
 */
export const CONFIG = {
    /**
     * Debug Mode
     * Enables verbose logging and development features
     */
    debugMode: isDebugMode(),

    /**
     * API Base URL
     * Uses Vite environment variable if available, otherwise defaults to current origin
     */
    API_BASE_URL: import.meta.env?.VITE_API_URL || window.location.origin,

    /**
     * Cache Duration Settings
     * Controls how long data is cached in IndexedDB
     */
    CACHE_DURATION: {
        SHORT: 5 * 60 * 1000, // 5 minutes
        MEDIUM: 30 * 60 * 1000, // 30 minutes
        LONG: 24 * 60 * 60 * 1000, // 24 hours
    },

    /**
     * Application Version
     */
    VERSION: "3.0.5",

    /**
     * Application Name
     */
    APP_NAME: "Wampums",

    /**
     * Default Language
     */
    DEFAULT_LANG: "fr",

    /**
     * Default currency for financial displays
     */
    DEFAULT_CURRENCY: "CAD",

    /**
     * Supported Languages
     */
    SUPPORTED_LANGS: ["en", "fr", "uk", "it", "id"],

    /**
     * Storage Keys
     * Centralized storage key names to avoid typos and conflicts
     */
    STORAGE_KEYS: {
        JWT_TOKEN: "jwtToken",
        ORGANIZATION_ID: "organizationId",
        CURRENT_ORGANIZATION_ID: "currentOrganizationId",
        USER_ROLE: "userRole",
        USER_ID: "userId",
        LANGUAGE: "language",
        THEME: "theme",
    },

    /**
     * API Endpoints
     * Centralized endpoint paths
     * All RESTful endpoints use /api/v1/ prefix
     */
    ENDPOINTS: {
        // Auth
        LOGIN: "/public/login",
        LOGOUT: "/api/auth/logout",
        REGISTER: "/api/auth/register",
        RESET_PASSWORD: "/api/auth/reset-password",

        // Organization
        ORGANIZATION_SETTINGS: "/api/organization-settings",
        ORGANIZATION_ID: "/public/get_organization_id",
        ORGANIZATION_JWT: "/api/organization-jwt",

        // Participants (v1 RESTful)
        PARTICIPANTS: "/api/v1/participants",
        PARTICIPANT_DETAILS: "/api/participant-details",

        // Groups (v1 RESTful)
        GROUPS: "/api/v1/groups",

        // Attendance (v1 RESTful)
        ATTENDANCE: "/api/v1/attendance",
        ATTENDANCE_DATES: "/api/attendance-dates",

        // Points & Honors
        POINTS_DATA: "/api/points-data",
        UPDATE_POINTS: "/api/update-points",
        HONORS: "/api/honors",
        AWARD_HONOR: "/api/award-honor",

        // Other
        TRANSLATIONS: "/api/translations",
        NEWS: "/api/news",
        INITIAL_DATA: "/api/initial-data",
        REUNION_PREPARATION: "/api/reunion-preparation",
        MAILING_LIST: "/api/mailing-list",
        PARENT_CONTACT_LIST: "/api/parent-contact-list",
    },

    /**
     * User Roles
     */
    ROLES: {
        DISTRICT: "district",
        UNIT_ADMIN: "unitadmin",
        LEADER: "leader",
        PARENT: "parent",
        FINANCE: "finance",
        EQUIPMENT: "equipment",
        ADMINISTRATION: "administration",
        DEMO_ADMIN: "demoadmin",
        DEMO_PARENT: "demoparent",
    },

    /**
     * Attendance Status Values
     */
    ATTENDANCE_STATUS: {
        PRESENT: "present",
        ABSENT: "absent",
        LATE: "late",
        EXCUSED: "excused",
    },

    /**
     * Default Point Values
     * Used if organization hasn't configured custom values
     */
    DEFAULT_POINTS: {
        ATTENDANCE: {
            PRESENT: 1,
            ABSENT: 0,
            LATE: 0.5,
            EXCUSED: 0,
        },
        HONORS: {
            AWARD: 5,
        },
        BADGES: {
            EARN: 5,
            LEVEL_UP: 10,
        },
    },

    PROGRAM_SECTIONS: {
        DEFAULT: [
            { key: "general", labelKey: "program_section_general" },
            { key: "beavers", labelKey: "program_section_beavers" },
            { key: "cubs", labelKey: "program_section_cubs" },
            { key: "scouts", labelKey: "program_section_scouts" },
            { key: "pioneers", labelKey: "program_section_pioneers" },
            { key: "rovers", labelKey: "program_section_rovers" },
        ],
    },

    /**
     * UI Settings
     */
    UI: {
        HOMEPAGE_URL: "https://wampums.app",
        // Default number of items per page for paginated lists
        DEFAULT_PAGE_SIZE: 50,

        // Maximum file upload size (in bytes)
        MAX_FILE_SIZE: 30 * 1024 * 1024, // 30MB

        // Toast notification duration (in milliseconds)
        TOAST_DURATION: 3000,

        // Optional client-side HEIC to WebP converter URL (lazy-loaded only when needed)
        HEIC_CONVERTER_URL:
            "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js",

        // Success message display duration before redirect (in milliseconds)
        SUCCESS_REDIRECT_DELAY: 3000,

        // Debounce delay for search inputs (in milliseconds)
        SEARCH_DEBOUNCE: 300,

        // Skeleton loading minimum display time (in milliseconds)
        MIN_LOADING_TIME: 300,
    },

    /**
     * Photo upload processing and safety constraints
     */
    PHOTO_UPLOAD: {
        // Max original file size accepted from the client (bytes)
        MAX_ORIGINAL_SIZE_BYTES: 30 * 1024 * 1024, // 30MB

        // Target long-edge resize for client-side optimization (pixels)
        TARGET_MAX_EDGE_PX: 2048,

        // Max desired upload payload size after optimization (bytes)
        TARGET_MAX_BYTES: 5 * 1024 * 1024, // 5MB

        // Chunk size for streaming reads (bytes)
        STREAM_CHUNK_SIZE: 512 * 1024, // 512KB

        // Preferred and minimum WebP qualities for resize/export
        WEBP_QUALITY: 0.82,
        MIN_WEBP_QUALITY: 0.55,

        // Safety timeout (ms) for worker-based processing
        WORKER_TIMEOUT_MS: 15000,
    },

    /**
     * Push Notification Settings
     */
    PUSH_NOTIFICATIONS: {
        // VAPID public key for push notifications
        // IMPORTANT: Set VITE_VAPID_PUBLIC environment variable in production
        // The hardcoded fallback is for development only and should not be used in production
        VAPID_PUBLIC_KEY:
            import.meta.env?.VITE_VAPID_PUBLIC ||
            "BPsOyoPVxNCN6BqsLdHwc5aaNPERFO2yq-xF3vqHJ7CdMlHRn5EBPnxcoOKGkeIO1_9zHnF5CRyD6RvLlOKPcTE",
    },

    /**
     * Feature Flags
     * Enable/disable features based on environment or rollout strategy
     */
    FEATURES: {
        PUSH_NOTIFICATIONS: true,
        OFFLINE_MODE: true,
        DARK_MODE: false,
        EXPORT_REPORTS: true,
        BADGE_SYSTEM: true,
    },

    /**
     * IndexedDB Settings
     */
    INDEXEDDB: {
        DB_NAME: "WampumsDB",
        DB_VERSION: 1,
        STORE_NAME: "cachedData",
    },

    /**
     * Service Worker Settings
     */
    SERVICE_WORKER: {
        ENABLED: "serviceWorker" in navigator,
        PATH: "/service-worker.js",
    },
};

/**
 * Log configuration on initialization (only in debug mode)
 * Note: We can't use debugLog here as it may create a circular dependency
 * This is the only acceptable use of console.log in the codebase
 */
if (CONFIG.debugMode) {
    debugLog("=== Wampums Configuration ===");
    debugLog("API Base URL:", CONFIG.API_BASE_URL);
    debugLog("Debug Mode:", CONFIG.debugMode);
    debugLog("Version:", CONFIG.VERSION);
    debugLog("Environment:", import.meta.env?.MODE || "production");
    debugLog("============================");
} else {
    // In production, at least show the version for troubleshooting
    debugLog(`Wampums v${CONFIG.VERSION} - Production Mode`);
}

/**
 * Helper function to build full API URL
 * @param {string} endpoint - Endpoint path
 * @returns {string} Full API URL
 */
export function getApiUrl(endpoint) {
    // Remove leading slash from endpoint if present
    const path = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;

    // Ensure API_BASE_URL doesn't end with slash
    const baseUrl = CONFIG.API_BASE_URL.endsWith("/")
        ? CONFIG.API_BASE_URL.slice(0, -1)
        : CONFIG.API_BASE_URL;

    return `${baseUrl}/${path}`;
}

/**
 * Helper function to check if a feature is enabled
 * @param {string} featureName - Feature name from CONFIG.FEATURES
 * @returns {boolean} True if feature is enabled
 */
export function isFeatureEnabled(featureName) {
    return CONFIG.FEATURES[featureName] === true;
}

/**
 * Helper function to get storage key
 * @param {string} keyName - Key name from CONFIG.STORAGE_KEYS
 * @returns {string} Storage key
 */
export function getStorageKey(keyName) {
    return CONFIG.STORAGE_KEYS[keyName] || keyName;
}

/**
 * Export individual settings for convenience
 */
export const {
    API_BASE_URL,
    CACHE_DURATION,
    STORAGE_KEYS,
    ENDPOINTS,
    ROLES,
    ATTENDANCE_STATUS,
    DEFAULT_POINTS,
} = CONFIG;

// Make CONFIG immutable (prevent accidental modifications)
Object.freeze(CONFIG);
Object.freeze(CONFIG.CACHE_DURATION);
Object.freeze(CONFIG.STORAGE_KEYS);
Object.freeze(CONFIG.ENDPOINTS);
Object.freeze(CONFIG.ROLES);
Object.freeze(CONFIG.ATTENDANCE_STATUS);
Object.freeze(CONFIG.DEFAULT_POINTS);
Object.freeze(CONFIG.DEFAULT_POINTS.ATTENDANCE);
Object.freeze(CONFIG.DEFAULT_POINTS.HONORS);
Object.freeze(CONFIG.DEFAULT_POINTS.BADGES);
Object.freeze(CONFIG.UI);
Object.freeze(CONFIG.PUSH_NOTIFICATIONS);
Object.freeze(CONFIG.FEATURES);
Object.freeze(CONFIG.INDEXEDDB);
Object.freeze(CONFIG.SERVICE_WORKER);
