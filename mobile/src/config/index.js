/**
 * Configuration Module for Wampums React Native App
 *
 * This module centralizes all configuration constants including:
 * - API base URLs (environment-driven)
 * - Storage keys
 * - App constants
 * - Feature flags
 */

import Constants from 'expo-constants';

// Environment-based configuration
// Note: Expo supports .env files - variables are available as process.env.VARIABLE_NAME
const ENV = {
  dev: {
    // Default to Android emulator address (10.0.2.2 reaches host machine)
    // For iOS simulator, use localhost
    // For physical device, set API_URL in .env to your computer's IP
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000/api',
    apiVersion: process.env.EXPO_PUBLIC_API_VERSION || 'v1',
    enableDebugLogging: process.env.EXPO_PUBLIC_ENABLE_DEBUG_LOGGING !== 'false',
  },
  staging: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://staging.wampums.ca/api',
    apiVersion: process.env.EXPO_PUBLIC_API_VERSION || 'v1',
    enableDebugLogging: process.env.EXPO_PUBLIC_ENABLE_DEBUG_LOGGING !== 'false',
  },
  production: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://wampums.ca/api',
    apiVersion: process.env.EXPO_PUBLIC_API_VERSION || 'v1',
    enableDebugLogging: false,
  },
};

// Get current environment from Expo config or default to dev
const getEnvVars = () => {
  const releaseChannel = Constants.expoConfig?.releaseChannel;

  if (__DEV__) {
    return ENV.dev;
  } else if (releaseChannel === 'staging') {
    return ENV.staging;
  } else if (releaseChannel === 'production') {
    return ENV.production;
  } else {
    return ENV.dev;
  }
};

const selectedEnv = getEnvVars();

// Core configuration object
const CONFIG = {
  // API Configuration
  API: {
    BASE_URL: selectedEnv.apiUrl,
    VERSION: selectedEnv.apiVersion,
    TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000, // 1 second
  },

  // API Endpoints (mirrors spa/config.js)
  ENDPOINTS: {
    // Auth endpoints (non-versioned)
    LOGIN: '/public/login',
    VERIFY_2FA: '/public/verify-2fa',
    LOGOUT: '/api/auth/logout',
    REGISTER: '/public/register',
    RESET_PASSWORD: '/api/auth/reset-password',
    REQUEST_RESET: '/api/auth/request-reset',
    VERIFY_SESSION: '/api/auth/verify-session',
    REFRESH_TOKEN: '/refresh-token',

    // Organization
    GET_ORGANIZATION_ID: '/public/get_organization_id',
    ORGANIZATION_SETTINGS: '/organization-settings',
    ORGANIZATION_JWT: '/organization-jwt',
    SWITCH_ORGANIZATION: '/switch-organization',

    // V1 endpoints
    ACTIVITIES: '/v1/activities',
    ANNOUNCEMENTS: '/v1/announcements',
    ATTENDANCE: '/v1/attendance',
    CARPOOLS: '/v1/carpools',
    EXPENSES: '/v1/expenses',
    FINANCE: '/v1/finance',
    GROUPS: '/v1/groups',
    MEDICATION: '/v1/medication',
    PARTICIPANTS: '/v1/participants',
    RESOURCES: '/v1/resources',
    REVENUE: '/v1/revenue',
    ROLES: '/v1/roles',
    STRIPE: '/v1/stripe',
    USERS: '/v1/users',
    BUDGET: '/v1/budget',
    PUSH_SUBSCRIPTION: '/v1/push-subscription',
    FORMS: '/api',

    // Honors endpoints (v1 - permission-based)
    HONORS: '/v1/honors',
    AWARD_HONOR: '/v1/honors',
    HONORS_HISTORY: '/v1/honors/history',

    // Legacy endpoints
    INITIAL_DATA: '/initial-data',
    NEWS: '/news',
    TRANSLATIONS: '/translations',
    PARTICIPANTS_LEGACY: '/participants',
    POINTS_DATA: '/points-data',
    UPDATE_POINTS: '/update-points',
    POINTS_REPORT: '/points-report',
    POINTS_LEADERBOARD: '/points-leaderboard',
    BADGE_SUMMARY: '/badge-summary',
    HONORS_REPORT: '/honors-report',
    FUNDRAISERS: '/fundraisers',
    CALENDARS: '/calendars',
    REUNION_PREPARATION: '/reunion-preparation',
    SAVE_REUNION_PREPARATION: '/save-reunion-preparation',
    REUNION_DATES: '/reunion-dates',
    MEETING_ACTIVITIES: '/activites-rencontre',
    NEXT_MEETING_INFO: '/next-meeting-info',
    ANIMATEURS: '/animateurs',
  },

  // Storage keys (mirrors spa CONFIG.STORAGE_KEYS)
  STORAGE_KEYS: {
    JWT_TOKEN: 'jwtToken',
    USER_ID: 'userId',
    USER_ROLE: 'userRole',
    USER_ROLES: 'userRoles',
    USER_PERMISSIONS: 'userPermissions',
    USER_FULL_NAME: 'userFullName',
    ORGANIZATION_ID: 'organizationId',
    CURRENT_ORGANIZATION_ID: 'currentOrganizationId',
    GUARDIAN_PARTICIPANTS: 'guardianParticipants',
    DEVICE_TOKEN: 'device_token',
    LANGUAGE: 'language',
    WAMPUMS_LANG: 'wampums-lang',
    OFFLINE_QUEUE: 'offlineQueue',
    LAST_SYNC: 'lastSync',
  },

  // Cache configuration
  CACHE: {
    DEFAULT_EXPIRATION: 5 * 60 * 1000, // 5 minutes
    LONG_EXPIRATION: 60 * 60 * 1000, // 1 hour
    SHORT_EXPIRATION: 60 * 1000, // 1 minute
  },

  // App constants
  APP: {
    NAME: 'Wampums',
    VERSION: Constants.expoConfig?.version || '1.0.0',
    BUILD_NUMBER: Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || '1',
  },

  // UI Constants
  UI: {
    TOUCH_TARGET_SIZE: 44, // Minimum touch target size for accessibility
    ANIMATION_DURATION: 300,
    DEBOUNCE_DELAY: 300,
    POINTS_QUICK_ACTIONS: [1, 3, 5, -1, -3, -5],
    ATTENDANCE_STATUSES: ['present', 'late', 'absent', 'excused'],
    PARENT_DASHBOARD_MAX_UPCOMING_ACTIVITIES: 5,
  },

  // Feature flags
  FEATURES: {
    OFFLINE_MODE: true,
    PUSH_NOTIFICATIONS: true,
    BIOMETRIC_AUTH: true,
    DEBUG_LOGGING: selectedEnv.enableDebugLogging,
  },

  // Locale configuration
  LOCALE: {
    DEFAULT_LANGUAGE: 'fr',
    SUPPORTED_LANGUAGES: ['en', 'fr'],
    DATE_FORMAT: 'YYYY-MM-DD',
    TIME_FORMAT: 'HH:mm',
    DATETIME_FORMAT: 'YYYY-MM-DD HH:mm',
  },

  // Currency configuration
  CURRENCY: {
    DEFAULT: 'CAD',
    LOCALE: 'en-CA',
  },

  // Tax rates (Canada/Quebec)
  TAX: {
    GST_RATE: 0.05, // 5% - Canadian federal Goods and Services Tax
    QST_RATE: 0.09975, // 9.975% - Quebec provincial Sales Tax
  },
};

// Helper function to get full API URL
/**
 * Build a full API URL, normalizing /api prefixes for different base URLs.
 * Ensures:
 * - /public endpoints always resolve at the root domain.
 * - /api endpoints do not double-prefix when the base already ends in /api.
 * - Versioned/legacy endpoints get /api when the base does not include it.
 * - Supports dynamic base URL override from organization selection.
 *
 * NOTE: For runtime dynamic URL support, use getDynamicApiUrl() which checks storage.
 *
 * @param {string} endpoint - API endpoint path.
 * @param {string} [dynamicBaseUrl] - Optional override base URL (from organization selection).
 * @returns {string} Full URL for the request.
 */
export const getApiUrl = (endpoint, dynamicBaseUrl = null) => {
  // Use dynamic base URL if provided, otherwise use default from CONFIG
  const baseUrl = (dynamicBaseUrl || CONFIG.API.BASE_URL).replace(/\/+$/, '');
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const baseHasApi = baseUrl.endsWith('/api');
  const isPublicEndpoint = cleanEndpoint.startsWith('/public/');
  const hasApiPrefix = cleanEndpoint.startsWith('/api/');

  let normalizedBase = baseUrl;
  let normalizedEndpoint = cleanEndpoint;

  if (isPublicEndpoint && baseHasApi) {
    normalizedBase = baseUrl.replace(/\/api$/, '');
  } else if (hasApiPrefix && baseHasApi) {
    normalizedEndpoint = cleanEndpoint.replace(/^\/api/, '');
  } else if (!hasApiPrefix && !isPublicEndpoint && !baseHasApi) {
    normalizedEndpoint = `/api${cleanEndpoint}`;
  }

  return `${normalizedBase}${normalizedEndpoint}`;
};

/**
 * Get the dynamic API base URL from storage (if set via organization selection).
 * This allows the app to use organization-specific URLs after org selection.
 *
 * @returns {Promise<string|null>} The stored dynamic base URL, or null if not set.
 */
export const getDynamicApiBaseUrl = async () => {
  try {
    // Import StorageUtils dynamically to avoid circular dependency
    const StorageUtils = require('../utils/StorageUtils').default;
    return await StorageUtils.getItem('dynamicApiBaseUrl');
  } catch (err) {
    // Use console.error directly to avoid require cycle with DebugUtils
    // eslint-disable-next-line no-console
    console.error('[Debug] Error getting dynamic API base URL:', err);
    return null;
  }
};

/**
 * Get full API URL with runtime check for dynamic base URL from storage.
 * Use this in api-core.js for runtime URL resolution.
 *
 * @param {string} endpoint - API endpoint path.
 * @returns {Promise<string>} Full URL for the request.
 */
export const getDynamicApiUrl = async (endpoint) => {
  const dynamicBaseUrl = await getDynamicApiBaseUrl();
  return getApiUrl(endpoint, dynamicBaseUrl);
};

// Helper function to get versioned API URL
export const getVersionedApiUrl = (endpoint) => {
  const baseUrl = CONFIG.API.BASE_URL;
  const version = CONFIG.API.VERSION;
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
  return `${baseUrl}/${version}/${cleanEndpoint}`;
};

export default CONFIG;
