const {
  getMeetingSectionConfig,
  mergeMeetingSectionConfig,
  resolveMeetingSectionKey,
} = require('../utils/meeting-sections');

describe('meeting section precedence', () => {
  const sections = mergeMeetingSectionConfig(null);

  test('preserves an explicit legacy section over an unsaved general default', () => {
    expect(resolveMeetingSectionKey(sections, {
      programSection: 'general',
      organizationInfo: { meeting_section: 'cubs' },
      hasUnitVocabulary: false,
    })).toBe('cubs');
  });

  test('uses the synchronized program section after vocabulary is explicitly saved', () => {
    expect(resolveMeetingSectionKey(sections, {
      programSection: 'general',
      organizationInfo: { meeting_section: 'cubs' },
      hasUnitVocabulary: true,
    })).toBe('general');
  });

  test('falls back to a valid legacy section when the program section is unknown', () => {
    expect(resolveMeetingSectionKey(sections, {
      programSection: 'unknown',
      organizationInfo: { meeting_section: 'beavers' },
      hasUnitVocabulary: true,
    })).toBe('beavers');
  });

  test.each(['scouts', 'pioneers', 'rovers'])(
    'a unit changed to %s uses the general layout despite its old cubs setting',
    (programSection) => {
      expect(resolveMeetingSectionKey(sections, {
        programSection,
        organizationInfo: { meeting_section: 'cubs' },
        hasUnitVocabulary: true,
      })).toBe('general');
    },
  );

  test('a branch keeps its own custom layout ahead of the general fallback', () => {
    const customSections = mergeMeetingSectionConfig({ sections: { scouts: { name: 'Scouts' } } });
    expect(resolveMeetingSectionKey(customSections, {
      programSection: 'scouts',
      organizationInfo: { meeting_section: 'cubs' },
      hasUnitVocabulary: true,
    })).toBe('scouts');
  });

  test('a changed branch uses the general layout when loading persisted settings', async () => {
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            program_section: 'scouts',
            meeting_sections: null,
            organization_info: { meeting_section: 'cubs' },
            has_unit_vocabulary: true,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    expect((await getMeetingSectionConfig(pool, 12)).defaultSection).toBe('general');
  });

  test('applies legacy precedence when loading an organization configuration', async () => {
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            program_section: 'general',
            meeting_sections: null,
            organization_info: { meeting_section: 'cubs' },
            has_unit_vocabulary: false,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const result = await getMeetingSectionConfig(pool, 12);
    expect(result.defaultSection).toBe('cubs');
  });

  test('applies an explicitly saved generic profile when loading configuration', async () => {
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            program_section: 'general',
            meeting_sections: null,
            organization_info: { meeting_section: 'cubs' },
            has_unit_vocabulary: true,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const result = await getMeetingSectionConfig(pool, 12);
    expect(result.defaultSection).toBe('general');
  });
});

test('a scouts unit uses the general meeting layout, not the cubs\' default', () => {
  const { mergeMeetingSectionConfig: merge, resolveMeetingSectionKey: resolve } = require('../utils/meeting-sections');
  expect(resolve(merge(null), { programSection: 'scouts', organizationInfo: {}, hasUnitVocabulary: true })).toBe('general');
});
