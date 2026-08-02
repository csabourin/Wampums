import {
  configureUnitVocabulary,
  translateWithUnitVocabulary,
} from '../UnitVocabularyUtils';

const templates = {
  vocabulary_badge_tracker_title: '{{collective_name}} badges',
  vocabulary_program_year_subgroups_assigned:
    '{{count}} assignments to {{subgroup_plural}}',
};
const i18n = {
  t: jest.fn((key, options = {}) => templates[key] || options.defaultValue || key),
};

describe('mobile unit vocabulary', () => {
  afterEach(() => {
    configureUnitVocabulary({});
    jest.clearAllMocks();
  });

  it('uses configured direct terms and translated sentence templates', () => {
    configureUnitVocabulary({
      unit_vocabulary: {
        locales: {
          en: {
            collective_name: 'Colony',
            subgroup_plural: 'Lodges',
            honor_plural: 'Recognitions',
          },
        },
      },
    });

    expect(
      translateWithUnitVocabulary(i18n, 'en', 'manage_honors', 'Honours')
    ).toBe('Recognitions');
    expect(
      translateWithUnitVocabulary(i18n, 'en', 'groups', 'Dens')
    ).toBe('Lodges');
    expect(
      translateWithUnitVocabulary(i18n, 'en', 'badge_tracker_title', 'Pack badges')
    ).toBe('Colony badges');
    expect(
      translateWithUnitVocabulary(
        i18n,
        'en',
        'scout_year_rollback_blocker_dens_assigned',
        'Assignments',
        { count: 3 }
      )
    ).toBe('3 assignments to Lodges');
  });

  it('retains the existing translation when no vocabulary is configured', () => {
    expect(
      translateWithUnitVocabulary(i18n, 'en', 'badge_tracker_title', 'Pack badges')
    ).toBe('Pack badges');
  });
});
