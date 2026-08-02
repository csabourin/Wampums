import {
  createVocabularyFromProfile,
  getDirectVocabularyTermKey,
  getUnitVocabulary,
  getVocabularyProfile,
  getVocabularyTemplateKey
} from '../../spa/utils/UnitVocabularyUtils.js';

describe('UnitVocabularyUtils', () => {
  test('preserves the legacy Cubs profile when no setting exists', () => {
    expect(getVocabularyProfile({ program_section: 'general' })).toBe('cubs');
    expect(getUnitVocabulary({}, 'fr').youth_plural).toBe('Louveteaux');
  });

  test('resolves Beaver defaults and organization overrides', () => {
    const vocabulary = createVocabularyFromProfile('beavers');
    vocabulary.locales.fr.subgroup_plural = 'Barrages';

    expect(getVocabularyProfile({ unit_vocabulary: vocabulary })).toBe('beavers');
    expect(getUnitVocabulary({ unit_vocabulary: vocabulary }, 'fr')).toEqual(
      expect.objectContaining({ youth_plural: 'Castors', subgroup_plural: 'Barrages' })
    );
    expect(getDirectVocabularyTermKey('groups')).toBe('subgroup_plural');
    expect(getDirectVocabularyTermKey('honors')).toBe('honor_plural');
    expect(getVocabularyTemplateKey('last_honor_date')).toBe('vocabulary_last_honor_date');
  });

  test('keeps unsupported locales on their existing same-language translations', () => {
    expect(getUnitVocabulary({ unit_vocabulary: createVocabularyFromProfile('beavers') }, 'it')).toEqual({});
    expect(getVocabularyTemplateKey('badge_tracker_title')).toBe('vocabulary_badge_tracker_title');
  });
});
