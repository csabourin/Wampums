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

// Create i18n instance
const i18n = new I18n();

// Default locale
i18n.defaultLocale = CONFIG.LOCALE.DEFAULT_LANGUAGE;
i18n.locale = CONFIG.LOCALE.DEFAULT_LANGUAGE;
i18n.enableFallback = true;

// Translation cache
let translationsLoaded = false;
let currentLanguage = CONFIG.LOCALE.DEFAULT_LANGUAGE;

/**
 * Load static translations from bundled JSON files
 * In a real app, you would import these from lang/en.json and lang/fr.json
 */
const loadStaticTranslations = async (lang) => {
  try {
    // For now, we'll return an empty object
    // In production, you would:
    // 1. Copy lang/en.json and lang/fr.json to mobile/assets/lang/
    // 2. Import them using require() or fetch()
    // Example:
    // const translations = require(`../../assets/lang/${lang}.json`);
    // return translations;

    console.log(`Loading static translations for ${lang}...`);
    return {};
  } catch (error) {
    console.error(`Error loading static translations for ${lang}:`, error);
    return {};
  }
};

/**
 * Load dynamic translations from API
 * Mirrors spa/api/api-offline-wrapper.js translation caching
 */
const loadDynamicTranslations = async (lang) => {
  try {
    const response = await fetchTranslationsFromAPI(lang);
    if (response.success && response.data) {
      return response.data;
    }
    return {};
  } catch (error) {
    console.error(`Error loading dynamic translations for ${lang}:`, error);
    return {};
  }
};

/**
 * Load all translations for a language
 */
export const loadTranslation = async (lang) => {
  try {
    // Load static and dynamic translations in parallel
    const [staticTranslations, dynamicTranslations] = await Promise.all([
      loadStaticTranslations(lang),
      loadDynamicTranslations(lang),
    ]);

    // Merge translations (dynamic overrides static)
    const translations = {
      ...staticTranslations,
      ...dynamicTranslations,
    };

    // Set translations for this locale
    i18n.store({
      [lang]: translations,
    });

    return translations;
  } catch (error) {
    console.error(`Error loading translations for ${lang}:`, error);
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
      const deviceLocale = Localization.locale.split('-')[0]; // Get 'en' from 'en-US'
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
