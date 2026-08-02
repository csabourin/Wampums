jest.mock('../../config/meeting_sections.js', () => ({
  __esModule: true,
  default: {
    defaultSection: 'cubs',
    sections: {
      general: { name: 'General' },
      beavers: { name: 'Beavers' },
      cubs: { name: 'Cubs' },
    },
  },
}));

import { getActiveSectionConfig } from '../../spa/utils/meetingSections.js';

describe('SPA meeting section precedence', () => {
  test('preserves the legacy section while program_section is an unsaved default', () => {
    const result = getActiveSectionConfig(null, {
      program_section: 'general',
      organization_info: { meeting_section: 'cubs' },
    });

    expect(result.sectionKey).toBe('cubs');
  });

  test('uses program_section after a vocabulary profile is saved', () => {
    const result = getActiveSectionConfig(null, {
      program_section: 'general',
      organization_info: { meeting_section: 'cubs' },
      unit_vocabulary: { profile: 'generic' },
    });

    expect(result.sectionKey).toBe('general');
  });
});
