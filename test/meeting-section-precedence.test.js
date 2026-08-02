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
