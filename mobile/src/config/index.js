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
const ENV = {
  dev: {
    apiUrl: 'http://localhost:3000/api',
    apiVersion: 'v1',
    enableDebugLogging: true,
  },
  staging: {
    apiUrl: 'https://staging.wampums.ca/api',
    apiVersion: 'v1',
    enableDebugLogging: true,
  },
  production: {
    apiUrl: 'https://wampums.ca/api',
    apiVersion: 'v1',
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
    LOGOUT: '/auth/logout',
    REGISTER: '/auth/register',
    RESET_PASSWORD: '/auth/reset-password',
    REQUEST_RESET: '/auth/request-reset',
    VERIFY_SESSION: '/auth/verify-session',
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

    // Legacy endpoints
    INITIAL_DATA: '/initial-data',
    NEWS: '/news',
    TRANSLATIONS: '/translations',
    PARTICIPANTS_LEGACY: '/participants',
    POINTS_DATA: '/points-data',
    BADGE_SUMMARY: '/badge-summary',
    HONORS: '/honors',
    FUNDRAISERS: '/fundraisers',
    CALENDARS: '/calendars',
    FORMS: '/form-formats',
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
};

// Helper function to get full API URL
export const getApiUrl = (endpoint) => {
  const baseUrl = CONFIG.API.BASE_URL;
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${cleanEndpoint}`;
};

// Helper function to get versioned API URL
export const getVersionedApiUrl = (endpoint) => {
  const baseUrl = CONFIG.API.BASE_URL;
  const version = CONFIG.API.VERSION;
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
  return `${baseUrl}/${version}/${cleanEndpoint}`;
};

export default CONFIG;
