/**
 * Which interface languages a unit offers, and what its optional languages
 * fall back to.
 *
 * French and English are always offered. A unit may add the optional
 * languages that have a bundle in lang/ (config/interface_languages.json);
 * their missing keys fall back to the unit's fallback language, French or
 * English. Stored in organization_settings under `interface_languages`:
 *
 *   { "enabled": ["uk"], "fallback": "en" }
 *
 * @module utils/interfaceLanguages
 */

const config = require('../config/interface_languages.json');

/** Every language the interface can be shown in. */
const ALL_INTERFACE_LANGUAGES = [...config.core, ...config.optional];

/**
 * Check and normalize a unit's language setting.
 *
 * @param {*} input - Request body
 * @returns {{value: {enabled: string[], fallback: string}, errors: Array<{field: string, message: string}>}}
 */
function validateInterfaceLanguages(input) {
  const errors = [];
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const enabled = Array.isArray(body.enabled) ? body.enabled : [];
  const fallback = body.fallback ?? config.defaultFallback;

  if (body.enabled !== undefined && !Array.isArray(body.enabled)) {
    errors.push({ field: 'enabled', message: 'enabled must be a list of language codes' });
  }
  const unknown = enabled.filter((code) => !config.optional.includes(code));
  if (unknown.length > 0) {
    errors.push({
      field: 'enabled',
      message: `Unknown optional languages: ${unknown.join(', ')}. Available: ${config.optional.join(', ')}`,
    });
  }
  if (!config.core.includes(fallback)) {
    errors.push({ field: 'fallback', message: `fallback must be one of: ${config.core.join(', ')}` });
  }

  return {
    value: {
      // Kept in the catalogue's order, without duplicates.
      enabled: config.optional.filter((code) => enabled.includes(code)),
      fallback: config.core.includes(fallback) ? fallback : config.defaultFallback,
    },
    errors,
  };
}

module.exports = {
  ALL_INTERFACE_LANGUAGES,
  INTERFACE_LANGUAGES_SETTING_KEY: config.settingKey,
  validateInterfaceLanguages,
};
