const {
  customizationConfig,
  validateUnitVocabulary,
  validateDashboardConfiguration,
  getProgramSectionForProfile
} = require('../utils/unitCustomization');

describe('unit customization validation', () => {
  test('accepts a complete bilingual Beaver vocabulary', () => {
    const input = {
      version: 1,
      profile: 'beavers',
      locales: customizationConfig.profiles.beavers.locales
    };

    const result = validateUnitVocabulary(input);

    expect(result.errors).toEqual([]);
    expect(result.value.locales.fr.youth_plural).toBe('Castors');
    expect(getProgramSectionForProfile(result.value.profile)).toBe('beavers');
  });

  test('rejects HTML and incomplete locale data', () => {
    const input = {
      profile: 'custom',
      locales: {
        en: { youth_singular: '<img src=x>' },
        fr: {}
      }
    };

    const result = validateUnitVocabulary(input);

    expect(result.errors.some(({ field }) => field === 'locales.en.youth_singular')).toBe(true);
    expect(result.errors.some(({ field }) => field === 'locales.fr.youth_plural')).toBe(true);
  });

  test('accepts known dashboard keys and rejects required or unknown keys', () => {
    expect(validateDashboardConfiguration({
      hidden_tile_keys: ['points', 'honors']
    })).toEqual({
      value: { version: 1, hidden_tile_keys: ['honors', 'points'] },
      errors: []
    });

    const invalid = validateDashboardConfiguration({
      hidden_tile_keys: ['account_info', 'not_a_feature']
    });
    expect(invalid.errors).toHaveLength(2);
  });

  test('recognizes current incident visibility and rejects retired communication tile keys', () => {
    expect(validateDashboardConfiguration({
      hidden_tile_keys: ['incident_reports', 'parent_preview']
    })).toEqual({
      value: { version: 1, hidden_tile_keys: ['incident_reports', 'parent_preview'] },
      errors: []
    });

    expect(validateDashboardConfiguration({
      hidden_tile_keys: ['communications']
    }).errors).toHaveLength(1);
  });
});
