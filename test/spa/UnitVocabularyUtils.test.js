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

  test('a scouts, pioneers or rovers unit without saved terms speaks the generic ones, not the cubs\'', () => {
    ['scouts', 'pioneers', 'rovers'].forEach((section) => {
      expect(getVocabularyProfile({ program_section: section })).toBe('generic');
    });
    expect(getUnitVocabulary({ program_section: 'scouts' }, 'fr').youth_plural).not.toBe('Louveteaux');
    expect(getVocabularyProfile({ program_section: 'beavers' })).toBe('beavers');
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

  test('a cub den leader is a Pisteur, not an Animateur', () => {
    expect(getDirectVocabularyTermKey('first_leader')).toBe('primary_youth_leader');
    expect(getDirectVocabularyTermKey('second_leader')).toBe('assistant_youth_leader');
    expect(getUnitVocabulary({}, 'fr').primary_youth_leader).toBe('Pisteur');
    expect(getUnitVocabulary({}, 'fr').assistant_youth_leader).toBe('Second pisteur');
  });

  test('keeps unsupported locales on their existing same-language translations', () => {
    expect(getUnitVocabulary({ unit_vocabulary: createVocabularyFromProfile('beavers') }, 'it')).toEqual({});
    expect(getVocabularyTemplateKey('badge_tracker_title')).toBe('vocabulary_badge_tracker_title');
  });
});
