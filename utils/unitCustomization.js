const customizationConfig = require('../config/unit_customization.json');

const CUSTOM_PROFILE = 'custom';
const SUPPORTED_VOCABULARY_LOCALES = new Set(['en', 'fr']);
const MAXIMUM_TERM_LENGTH = 80;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const HTML_DELIMITER_PATTERN = /[<>"`]/u;
const vocabularyTermKeys = new Set(
  Object.keys(customizationConfig.profiles.generic.locales.en)
);
const profileKeys = new Set([
  ...Object.keys(customizationConfig.profiles),
  CUSTOM_PROFILE
]);
const dashboardFeatureKeys = new Set(customizationConfig.dashboardFeatureKeys);
const requiredDashboardFeatureKeys = new Set(
  customizationConfig.requiredDashboardFeatureKeys
);

/**
 * Normalize and validate organization vocabulary submitted by an administrator.
 * Values are deliberately plain text: HTML is not a supported vocabulary format.
 *
 * @param {unknown} input - Candidate vocabulary payload.
 * @returns {{value: object, errors: Array<{field: string, msg: string}>}}
 */
function validateUnitVocabulary(input) {
  const errors = [];
  const candidate = input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : {};
  const profile = typeof candidate.profile === 'string'
    ? candidate.profile.trim().toLowerCase()
    : '';

  if (!profileKeys.has(profile)) {
    errors.push({ field: 'profile', msg: 'Unknown vocabulary profile' });
  }

  const submittedLocales = candidate.locales;
  if (!submittedLocales || typeof submittedLocales !== 'object' || Array.isArray(submittedLocales)) {
    errors.push({ field: 'locales', msg: 'Vocabulary locales are required' });
  }

  const locales = {};
  Object.entries(submittedLocales || {}).forEach(([locale, terms]) => {
    if (!SUPPORTED_VOCABULARY_LOCALES.has(locale)) {
      errors.push({ field: `locales.${locale}`, msg: 'Unsupported vocabulary locale' });
      return;
    }
    if (!terms || typeof terms !== 'object' || Array.isArray(terms)) {
      errors.push({ field: `locales.${locale}`, msg: 'Vocabulary terms must be an object' });
      return;
    }

    const normalizedTerms = {};
    Object.entries(terms).forEach(([termKey, rawValue]) => {
      const field = `locales.${locale}.${termKey}`;
      if (!vocabularyTermKeys.has(termKey)) {
        errors.push({ field, msg: 'Unknown vocabulary term' });
        return;
      }
      if (typeof rawValue !== 'string') {
        errors.push({ field, msg: 'Vocabulary term must be text' });
        return;
      }

      const normalizedValue = rawValue.trim().replace(/\s+/gu, ' ');
      if (!normalizedValue) {
        errors.push({ field, msg: 'Vocabulary term cannot be empty' });
      } else if (normalizedValue.length > MAXIMUM_TERM_LENGTH) {
        errors.push({ field, msg: `Vocabulary term must be ${MAXIMUM_TERM_LENGTH} characters or fewer` });
      } else if (
        CONTROL_CHARACTER_PATTERN.test(normalizedValue)
        || HTML_DELIMITER_PATTERN.test(normalizedValue)
      ) {
        errors.push({ field, msg: 'Vocabulary term must be plain text' });
      } else {
        normalizedTerms[termKey] = normalizedValue;
      }
    });
    locales[locale] = normalizedTerms;
  });

  SUPPORTED_VOCABULARY_LOCALES.forEach((locale) => {
    const terms = locales[locale] || {};
    vocabularyTermKeys.forEach((termKey) => {
      if (!terms[termKey]) {
        errors.push({
          field: `locales.${locale}.${termKey}`,
          msg: 'Vocabulary term is required'
        });
      }
    });
  });

  return {
    value: {
      version: customizationConfig.version,
      profile: profileKeys.has(profile) ? profile : 'generic',
      locales
    },
    errors
  };
}

/**
 * Normalize and validate the organization-wide dashboard visibility policy.
 *
 * @param {unknown} input - Candidate dashboard configuration.
 * @returns {{value: object, errors: Array<{field: string, msg: string}>}}
 */
function validateDashboardConfiguration(input) {
  const errors = [];
  const candidate = input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : {};
  const hiddenKeys = candidate.hidden_tile_keys;

  if (!Array.isArray(hiddenKeys)) {
    errors.push({ field: 'hidden_tile_keys', msg: 'Hidden tile keys must be an array' });
  }

  const normalizedHiddenKeys = [];
  new Set(hiddenKeys || []).forEach((featureKey) => {
    if (typeof featureKey !== 'string' || !dashboardFeatureKeys.has(featureKey)) {
      errors.push({ field: 'hidden_tile_keys', msg: `Unknown dashboard feature: ${String(featureKey)}` });
    } else if (requiredDashboardFeatureKeys.has(featureKey)) {
      errors.push({ field: 'hidden_tile_keys', msg: `Required dashboard feature cannot be hidden: ${featureKey}` });
    } else {
      normalizedHiddenKeys.push(featureKey);
    }
  });

  return {
    value: {
      version: customizationConfig.version,
      hidden_tile_keys: normalizedHiddenKeys.sort()
    },
    errors
  };
}

/** Resolve the program section associated with a built-in profile. */
function getProgramSectionForProfile(profile) {
  return customizationConfig.profiles[profile]?.programSection || null;
}

module.exports = {
  customizationConfig,
  validateUnitVocabulary,
  validateDashboardConfiguration,
  getProgramSectionForProfile
};
