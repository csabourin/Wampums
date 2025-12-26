/**
 * Internationalization (i18n) Module for Wampums React Native App
 *
 * Mirrors spa/app.js translation functionality
 * Supports:
 * - Bilingual support (English and French)
 * - Loading translations from local JSON and API
 * - One language per page/screen
 * - Locale persistence
 */

import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import StorageUtils from '../utils/StorageUtils';
import { getTranslations as fetchTranslationsFromAPI } from '../api/api-endpoints';
import CONFIG from '../config';

// Create i18n instance with proper v4 configuration
const i18n = new I18n(
  {}, // Initial translations (will be loaded dynamically)
  {
    defaultLocale: CONFIG.LOCALE.DEFAULT_LANGUAGE,
    locale: CONFIG.LOCALE.DEFAULT_LANGUAGE,
    enableFallback: true,
  }
);

// Translation cache
let translationsLoaded = false;
let currentLanguage = CONFIG.LOCALE.DEFAULT_LANGUAGE;
let initPromise = null; // Guard against multiple initialization calls

// Request deduplication - prevent multiple simultaneous requests for same language
const pendingRequests = new Map();

/**
 * Load static translations from bundled JSON files
 */
const loadStaticTranslations = async (lang) => {
  try {
    let translations = {};

    // Load the appropriate translation file
    if (lang === 'en') {
      translations = require('../../assets/lang/en.json');
    } else if (lang === 'fr') {
      translations = require('../../assets/lang/fr.json');
    }

    if (CONFIG.FEATURES.DEBUG_LOGGING) {
      console.log(`Loaded ${Object.keys(translations).length} static translations for ${lang}`);
    }

    return translations;
  } catch (error) {
    console.error(`Error loading static translations for ${lang}:`, error);
    return {};
  }
};

/**
 * Load dynamic translations from API
 * Mirrors spa/api/api-offline-wrapper.js translation caching
 * Non-blocking - returns empty object if API is unavailable
 *
 * Uses request deduplication to prevent multiple simultaneous requests for the same language
 */
const loadDynamicTranslations = async (lang) => {
  // Check if there's already a pending request for this language
  if (pendingRequests.has(lang)) {
    if (CONFIG.FEATURES.DEBUG_LOGGING) {
      console.log(`Deduplicating translation request for ${lang}`);
    }
    return pendingRequests.get(lang);
  }

  // Create the request promise
  const requestPromise = (async () => {
    try {
      if (CONFIG.FEATURES.DEBUG_LOGGING) {
        console.log(`Fetching dynamic translations for ${lang}`);
      }

      const response = await fetchTranslationsFromAPI(lang);
      if (response.success && response.data) {
        if (CONFIG.FEATURES.DEBUG_LOGGING) {
          console.log(`Loaded ${Object.keys(response.data).length} dynamic translations for ${lang}`);
        }
        return response.data;
      }
      return {};
    } catch (error) {
      // API not available - this is expected when offline or backend not running
      if (CONFIG.FEATURES.DEBUG_LOGGING) {
        console.log(`API translations unavailable for ${lang}, using static translations only`);
      }
      return {};
    } finally {
      // Remove from pending requests when done
      pendingRequests.delete(lang);
    }
  })();

  // Store the pending request
  pendingRequests.set(lang, requestPromise);

  return requestPromise;
};

/**
 * Load all translations for a language
 */
export const loadTranslation = async (lang) => {
  try {
    // Load static translations first (always available)
    const staticTranslations = await loadStaticTranslations(lang);

    // Set static translations immediately so app can render
    i18n.store({
      [lang]: staticTranslations,
    });

    // Try to load dynamic translations (non-blocking)
    const dynamicTranslations = await loadDynamicTranslations(lang);

    // Merge with dynamic if available
    if (dynamicTranslations && Object.keys(dynamicTranslations).length > 0) {
      const translations = {
        ...staticTranslations,
        ...dynamicTranslations,
      };
      i18n.store({
        [lang]: translations,
      });
      return translations;
    }

    return staticTranslations;
  } catch (error) {
    console.error(`Error loading translations for ${lang}:`, error);
    // Return empty object - i18n will fall back to keys
    return {};
  }
};

/**
 * Initialize i18n system
 * Mirrors spa/app.js init() translation setup
 *
 * Prevents multiple simultaneous initializations
 */
export const initI18n = async () => {
  // If already initializing, return the existing promise
  if (initPromise) {
    if (CONFIG.FEATURES.DEBUG_LOGGING) {
      console.log('i18n already initializing, waiting for existing initialization');
    }
    return initPromise;
  }

  // If already loaded, return current language
  if (translationsLoaded) {
    if (CONFIG.FEATURES.DEBUG_LOGGING) {
      console.log('i18n already initialized, returning current language:', currentLanguage);
    }
    return currentLanguage;
  }

  // Create initialization promise
  initPromise = (async () => {
    try {
      if (CONFIG.FEATURES.DEBUG_LOGGING) {
        console.log('Initializing i18n system');
      }

      // Get stored language preference
      let storedLang = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.LANGUAGE);

      // If no stored language, use device locale
      if (!storedLang) {
        // expo-localization v17+ uses getLocales() instead of .locale
        const locales = Localization.getLocales();
        const deviceLocale = locales[0]?.languageCode || CONFIG.LOCALE.DEFAULT_LANGUAGE;
        storedLang = CONFIG.LOCALE.SUPPORTED_LANGUAGES.includes(deviceLocale)
          ? deviceLocale
          : CONFIG.LOCALE.DEFAULT_LANGUAGE;
      }

      // Load translations for the preferred language
      await loadTranslation(storedLang);

      // Set current locale
      i18n.locale = storedLang;
      currentLanguage = storedLang;
      translationsLoaded = true;

      if (CONFIG.FEATURES.DEBUG_LOGGING) {
        console.log('i18n initialization complete for language:', storedLang);
      }

      return storedLang;
    } catch (error) {
      console.error('Error initializing i18n:', error);
      i18n.locale = CONFIG.LOCALE.DEFAULT_LANGUAGE;
      currentLanguage = CONFIG.LOCALE.DEFAULT_LANGUAGE;
      return CONFIG.LOCALE.DEFAULT_LANGUAGE;
    } finally {
      // Clear the init promise after completion
      initPromise = null;
    }
  })();

  return initPromise;
};

/**
 * Change language
 * Mirrors spa/app.js changeLanguage()
 */
export const changeLanguage = async (lang) => {
  try {
    // Validate language
    if (!CONFIG.LOCALE.SUPPORTED_LANGUAGES.includes(lang)) {
      console.warn(`Unsupported language: ${lang}`);
      return false;
    }

    // Load translations for new language
    await loadTranslation(lang);

    // Update locale
    i18n.locale = lang;
    currentLanguage = lang;

    // Store preference
    await StorageUtils.setItem(CONFIG.STORAGE_KEYS.LANGUAGE, lang);
    await StorageUtils.setItem(CONFIG.STORAGE_KEYS.WAMPUMS_LANG, lang);

    return true;
  } catch (error) {
    console.error(`Error changing language to ${lang}:`, error);
    return false;
  }
};

/**
 * Get current language
 */
export const getCurrentLanguage = () => {
  return currentLanguage;
};

/**
 * Key mapping from nested dot notation to flat underscore notation
 * Maps mobile app's nested keys (e.g., 'auth.loginTitle') to lang.json flat keys (e.g., 'login')
 */
const keyMapping = {
  // Auth keys
  'auth.loginTitle': 'login',
  'auth.email': 'email',
  'auth.password': 'password',
  'auth.login': 'login',
  'auth.createAccount': 'create_account',
  'auth.forgotPassword': 'forgot_password',
  'auth.loginFailed': 'invalid_email_or_password',
  'auth.twoFactorTitle': 'two_factor_email_heading',
  'auth.enterCode': 'two_factor_message',
  'auth.verificationCode': 'verification_code_sent',
  'auth.trustDevice': 'Trust this device', // Fallback text
  'auth.verify': 'verify',
  'auth.backToLogin': 'back_to_login',
  'auth.invalidCode': 'Invalid verification code', // Fallback text
  'auth.verificationFailed': 'Verification failed', // Fallback text

  // Common keys
  'common.loading': 'loading',
  'common.save': 'save',
  'common.cancel': 'cancel',
  'common.ok': 'OK',
  'common.error': 'error',
  'common.success': 'success',
  'common.errorLoadingData': 'error_loading_data',
  'common.years': 'years',
  'common.notProvided': 'Not provided', // Fallback text
  'common.offline': 'Offline',
  'common.viewingCachedData': 'Viewing cached data', // Fallback text
  'common.comingSoon': 'Coming soon', // Fallback text
  'common.edit': 'edit',
  'common.retry': 'retry',
  'common.permissionDenied': 'Permission denied', // Fallback text
  'common.queued': 'Queued', // Fallback text
  'common.willSyncWhenOnline': 'Will sync when online', // Fallback text
  'common.viewAll': 'View all', // Fallback text
  'common.noLocation': 'No location', // Fallback text

  // Dashboard keys
  'dashboard.welcomeLeader': 'Welcome, Leader!', // Fallback text
  'dashboard.welcomeAdmin': 'Welcome, Admin!', // Fallback text
  'dashboard.yourGroup': 'Your Group', // Fallback text
  'dashboard.overview': 'overview',
  'dashboard.participants': 'participants',
  'dashboard.upcomingActivities': 'Upcoming Activities', // Fallback text
  'dashboard.groups': 'groups',
  'dashboard.permissionSlips': 'Permission Slips', // Fallback text
  'dashboard.quickActions': 'Quick Actions', // Fallback text
  'dashboard.takeAttendance': 'Take Attendance', // Fallback text
  'dashboard.createActivity': 'Create Activity', // Fallback text
  'dashboard.carpools': 'Carpools', // Fallback text
  'dashboard.adminActions': 'dashboard_admin_section',
  'dashboard.errorLoading': 'error_loading_dashboard',
  'dashboard.recentActivities': 'Recent Activities', // Fallback text
  'dashboard.noRecentActivities': 'No recent activities', // Fallback text
  'dashboard.noGroupsFound': 'No groups found', // Fallback text
  'dashboard.registered': 'Registered', // Fallback text
  'dashboard.districtOverview': 'District Overview', // Fallback text
  'dashboard.districtStatistics': 'District Statistics', // Fallback text
  'dashboard.totalParticipants': 'Total Participants', // Fallback text
  'dashboard.totalGroups': 'Total Groups', // Fallback text
  'dashboard.activeLeaders': 'Active Leaders', // Fallback text
  'dashboard.totalActivities': 'Total Activities', // Fallback text
  'dashboard.revenue': 'Revenue', // Fallback text
  'dashboard.reports': 'Reports', // Fallback text
  'dashboard.finance': 'finance',
  'dashboard.manageGroups': 'Manage Groups', // Fallback text
  'dashboard.settings': 'settings',
  'dashboard.leaders': 'Leaders', // Fallback text
  'dashboard.activityDetailComingSoon': 'Activity details coming soon', // Fallback text

  // Participants keys
  'participants.age': 'age',
  'participants.group': 'group',
  'participants.searchPlaceholder': 'Search participants', // Fallback text
  'participants.allGroups': 'all_groups',
  'participants.noParticipants': 'no_participants',
  'participants.errorLoading': 'error_loading_manage_participants',
  'participants.firstName': 'first_name',
  'participants.lastName': 'last_name',
  'participants.enterFirstName': 'Enter first name', // Fallback text
  'participants.enterLastName': 'Enter last name', // Fallback text
  'participants.birthdate': 'date_naissance',
  'participants.email': 'email',
  'participants.phone': 'Phone', // Fallback text (phone key likely exists)
  'participants.enterEmail': 'Enter email', // Fallback text
  'participants.enterPhone': 'Enter phone', // Fallback text
  'participants.address': 'Address', // Fallback text (address key likely exists)
  'participants.streetAddress': 'Street Address', // Fallback text
  'participants.city': 'City', // Fallback text
  'participants.province': 'Province', // Fallback text
  'participants.postalCode': 'postal_code',
  'participants.enterAddress': 'Enter address', // Fallback text
  'participants.enterCity': 'Enter city', // Fallback text
  'participants.enterProvince': 'Enter province', // Fallback text
  'participants.enterPostalCode': 'Enter postal code', // Fallback text
  'participants.basicInformation': 'Basic Information', // Fallback text
  'participants.healthInformation': 'Health Information', // Fallback text
  'participants.guardianContacts': 'Guardian Contacts', // Fallback text
  'participants.badgeProgress': 'badge_progress', // Use existing key
  'participants.financialStatus': 'Financial Status', // Fallback text
  'participants.errorFirstNameRequired': 'First name is required', // Fallback text
  'participants.errorLastNameRequired': 'Last name is required', // Fallback text
  'participants.errorInvalidEmail': 'account_info_email_invalid',
  'participants.errorInvalidBirthdate': 'Invalid birthdate', // Fallback text
  'participants.savedSuccessfully': 'data_saved',
  'participants.errorSaving': 'error_saving_participant',
  'participants.noEditPermission': 'You don\'t have permission to edit', // Fallback text
  'participants.yearsOld': 'years', // Use existing 'years' key

  // Settings keys
  'settings.profile': 'profile',
  'settings.language': 'language',
  'settings.languageChanged': 'Language changed', // Fallback text
  'settings.restartRequired': 'App restart required', // Fallback text
  'settings.confirmLogout': 'Confirm Logout', // Fallback text
  'settings.confirmLogoutMessage': 'Are you sure you want to logout?', // Fallback text
  'settings.logout': 'logout',
  'settings.notifications': 'Notifications', // Fallback text
  'settings.pushNotifications': 'Push Notifications', // Fallback text
  'settings.pushNotificationsHelp': 'Receive notifications about activities', // Fallback text
  'settings.appInfo': 'App Info', // Fallback text
  'settings.version': 'Version', // Fallback text
  'settings.build': 'Build', // Fallback text
  'settings.madeWith': 'Made with', // Fallback text
  'settings.forScouts': 'for Scouts', // Fallback text

  // Navigation keys
  'nav.dashboard': 'dashboard_title',
  'nav.participants': 'participants',
  'nav.activities': 'Activities',
  'nav.finance': 'finance',
  'nav.settings': 'settings',

  // Activities keys
  'activities.upcoming': 'Upcoming',
  'activities.past': 'Past',
  'activities.all': 'All',
  'activities.today': 'Today',
  'activities.participants': 'participants',
  'activities.noActivities': 'No activities', // Fallback text

  // Parent Dashboard keys
  'parentDashboard.title': 'Parent Dashboard', // Fallback text
  'parentDashboard.myChildren': 'My Children', // Fallback text
  'parentDashboard.noChildren': 'no_participants',
  'parentDashboard.age': 'age',
  'parentDashboard.group': 'group',
  'parentDashboard.upcomingActivities': 'Upcoming Activities', // Fallback text
  'parentDashboard.noActivities': 'No upcoming activities', // Fallback text
  'parentDashboard.carpoolAssignments': 'Carpool Assignments', // Fallback text
  'parentDashboard.driver': 'Driver', // Fallback text
  'parentDashboard.spots': 'Spots', // Fallback text
  'parentDashboard.quickActions': 'Quick Actions', // Fallback text
  'parentDashboard.viewFees': 'View Fees', // Fallback text
  'parentDashboard.permissionSlips': 'Permission Slips', // Fallback text
};

/**
 * Convert nested dot notation key to flat key using mapping
 * Falls back to original key if no mapping exists
 *
 * @param {string} key - Translation key (nested or flat)
 * @returns {string} Flat key
 */
const convertKey = (key) => {
  // If key exists in mapping, use the mapped value
  if (keyMapping[key]) {
    return keyMapping[key];
  }

  // If key contains dots, try to convert to underscore notation
  // e.g., 'auth.login' -> 'auth_login'
  if (key.includes('.')) {
    const underscoreKey = key.replace(/\./g, '_');
    return underscoreKey;
  }

  // Return original key as fallback
  return key;
};

/**
 * Translate a key
 * Mirrors spa/app.js translate()
 * Converts nested dot notation keys to flat keys using mapping
 *
 * @param {string} key - Translation key (nested or flat)
 * @param {object} options - Interpolation options
 * @returns {string} Translated text
 */
export const translate = (key, options = {}) => {
  if (!translationsLoaded) {
    console.warn('Translations not loaded yet');
    return key;
  }

  // Convert nested key to flat key
  const flatKey = convertKey(key);

  // Try to get translation
  const translation = i18n.t(flatKey, { ...options, defaultValue: flatKey });

  return translation;
};

/**
 * Alias for translate
 */
export const t = translate;

/**
 * Check if translations are loaded
 */
export const areTranslationsLoaded = () => {
  return translationsLoaded;
};

/**
 * Reload translations (useful after app comes back from background)
 */
export const reloadTranslations = async () => {
  await loadTranslation(currentLanguage);
};

export default {
  initI18n,
  loadTranslation,
  changeLanguage,
  getCurrentLanguage,
  translate,
  t,
  areTranslationsLoaded,
  reloadTranslations,
};
