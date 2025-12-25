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
 */
const loadDynamicTranslations = async (lang) => {
  try {
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
  }
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
 */
export const initI18n = async () => {
  try {
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

    return storedLang;
  } catch (error) {
    console.error('Error initializing i18n:', error);
    i18n.locale = CONFIG.LOCALE.DEFAULT_LANGUAGE;
    currentLanguage = CONFIG.LOCALE.DEFAULT_LANGUAGE;
    return CONFIG.LOCALE.DEFAULT_LANGUAGE;
  }
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
 * Translate a key
 * Mirrors spa/app.js translate()
 *
 * @param {string} key - Translation key
 * @param {object} options - Interpolation options
 * @returns {string} Translated text
 */
export const translate = (key, options = {}) => {
  if (!translationsLoaded) {
    console.warn('Translations not loaded yet');
    return key;
  }

  return i18n.t(key, options);
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
