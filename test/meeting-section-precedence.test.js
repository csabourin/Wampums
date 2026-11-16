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

describe('the usual evening follows the unit\'s meeting time', () => {
  const { alignTemplatesToMeetingTime } = require('../utils/meeting-sections');
  const times = (config, section = 'cubs') => config.sections[section].activityTemplates.map((template) => template.time);
  const loaded = (organizationInfo, meetingSections = null) => ({
    query: jest.fn()
      .mockResolvedValueOnce({
        rows: [{ program_section: 'cubs', meeting_sections: meetingSections, organization_info: organizationInfo, has_unit_vocabulary: true }],
      })
      .mockResolvedValueOnce({ rows: [] }),
  });

  test('every template moves by the same amount, so the evening keeps its shape', () => {
    const defaults = mergeMeetingSectionConfig(null);
    expect(times(defaults)[0]).toBe('18:45');
    const aligned = alignTemplatesToMeetingTime(defaults, '18:30');
    expect(times(aligned)).toEqual(['18:30', '18:40', '19:10', '19:15', '19:35', '19:55', '20:25']);
    // Durations and names are untouched.
    expect(aligned.sections.cubs.activityTemplates.map((template) => template.duration))
      .toEqual(defaults.sections.cubs.activityTemplates.map((template) => template.duration));
  });

  test('a unit without a meeting time keeps the templates\' own hours', () => {
    const defaults = mergeMeetingSectionConfig(null);
    expect(times(alignTemplatesToMeetingTime(defaults, undefined))).toEqual(times(defaults));
    expect(times(alignTemplatesToMeetingTime(defaults, 'not a time'))).toEqual(times(defaults));
  });

  test('a unit meeting at 19:00 sees its evening start at 19:00 wherever the templates are read', async () => {
    const config = await getMeetingSectionConfig(loaded({ meeting_time: '19:00' }), 12);
    expect(config.defaultSection).toBe('cubs');
    expect(times(config)[0]).toBe('19:00');
    expect(times(config).at(-1)).toBe('20:55');
  });

  test('a unit\'s own templates follow its meeting time too', async () => {
    const own = { sections: { cubs: { name: 'Cubs', activityTemplates: [
      { time: '18:00', duration: '01:00', activityKey: 'activity_big_game' },
      { time: '19:00', duration: '00:30', activityKey: 'activity_discussion' },
    ] } } };
    const config = await getMeetingSectionConfig(loaded({ meeting_time: '18:30:00' }, own), 12);
    expect(times(config)).toEqual(['18:30', '19:30']);
  });
});
