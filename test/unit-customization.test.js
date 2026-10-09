const {
  customizationConfig,
  validateUnitVocabulary,
  validateDashboardConfiguration,
  validateParentDashboardConfiguration,
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

  test('accepts known parent dashboard buttons and rejects the ones that always stay', () => {
    expect(validateParentDashboardConfiguration({
      hidden_button_keys: ['request_badge', 'program_progress', 'request_badge']
    })).toEqual({
      value: { version: 1, hidden_button_keys: ['program_progress', 'request_badge'] },
      errors: []
    });

    const invalid = validateParentDashboardConfiguration({
      hidden_button_keys: ['add_child', 'logout', 42]
    });
    expect(invalid.errors).toHaveLength(3);
    expect(validateParentDashboardConfiguration({}).errors).toHaveLength(1);
    // Malformed input is a validation error, never a thrown TypeError (a 500).
    [42, true, 'ab', { request_badge: true }].forEach((hiddenButtonKeys) => {
      expect(validateParentDashboardConfiguration({ hidden_button_keys: hiddenButtonKeys }).errors)
        .toEqual([{ field: 'hidden_button_keys', msg: 'Hidden button keys must be an array' }]);
    });
  });
});
