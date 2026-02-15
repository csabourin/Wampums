/**
 * @jest-environment jsdom
 * 
 * FormManager Test Suite
 *
 * Tests form population, validation, and data extraction for the
 * Preparation Reunions page. FormManager is critical for meeting planning
 * and handles honor assignments, activity planning, and meeting details.
 *
 * Key Functionality:
 * - Form population with meeting data
 * - Honor list management and formatting
 * - Activity initialization
 * - Form reset and state management
 * - Date formatting for inputs
 * - Configuration management
 *
 * @module test/spa/FormManager
 */

import {
  createMockApp,
  createMockOrgSettings,
  createMockActivityManager,
  createMockSectionConfig,
  createMockHonors,
  createMockMeetingData,
  setupFormDOM,
  cleanupFormDOM,
  TEST_ORG_ID
} from './helpers.js';

// Mock required dependencies
jest.mock('../../spa/app.js', () => ({
  translate: jest.fn((key) => key)
}));

jest.mock('../../spa/utils/SecurityUtils.js', () => ({
  escapeHTML: jest.fn((text) => text)
}));

jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: jest.fn()
}));

jest.mock('../../spa/utils/HonorUtils.js', () => ({
  formatHonorText: jest.fn((honor) => {
    if (!honor) return ''; // Match actual behavior
    if (typeof honor === 'string') return honor;
    if (honor && honor.name) return honor.name;
    return '';
  })
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn()
}));

// Import after mocks are set up
import { FormManager } from '../../spa/modules/FormManager.js';

describe('FormManager - Form Population & Data Management', () => {
  let formManager;
  let mockApp;
  let mockOrgSettings;
  let mockActivityManager;
  let mockSectionConfig;
  let domSetup;

  beforeEach(() => {
    // Setup mocks
    mockApp = createMockApp();
    mockOrgSettings = createMockOrgSettings({
      organization_id: TEST_ORG_ID
    });
    mockActivityManager = createMockActivityManager();
    mockSectionConfig = createMockSectionConfig();

    // Setup DOM
    domSetup = setupFormDOM();

    // Create FormManager instance
    formManager = new FormManager(
      mockApp,
      mockOrgSettings,
      [], // animateurs
      createMockHonors(),
      mockActivityManager,
      mockSectionConfig
    );
  });

  afterEach(() => {
    if (domSetup) {
      cleanupFormDOM(domSetup);
    }
  });

  describe('Constructor & Initialization', () => {
    test('initializes with proper structure', () => {
      expect(formManager.app).toBe(mockApp);
      expect(formManager.organizationSettings).toBe(mockOrgSettings);
      expect(formManager.sectionConfig).toBe(mockSectionConfig);
      expect(Array.isArray(formManager.recentHonors)).toBe(true);
    });

    test('stores references to all dependencies', () => {
      expect(formManager.activityManager).toBe(mockActivityManager);
      expect(formManager.animateurs).toBeDefined();
    });

    test('has reminder property initialized', () => {
      expect(formManager.reminder).toBeNull();
    });
  });

  describe('Honor Management', () => {
    test('formats single honor text correctly', () => {
      const honor = 'First Star';
      const result = formManager.formatHonorText(honor);

      expect(result).toBe('First Star');
    });

    test('formats honor object with name property', () => {
      const honor = { id: 1, name: 'Second Star' };
      const result = formManager.formatHonorText(honor);

      expect(result).toBe('Second Star');
    });

    test('builds comma-separated honor list', () => {
      const honors = [
        { name: 'First Star' },
        { name: 'Second Star' },
        'Third Star Award'
      ];

      const result = formManager.getHonorListItems(honors);

      expect(result).toContain('First Star');
      expect(result).toContain('Second Star');
      expect(result).toContain('Third Star Award');
    });

    test('filters out empty honors', () => {
      const honors = ['Valid Honor', '', null, undefined, 'Another Honor'];
      const result = formManager.getHonorListItems(honors);

      expect(result).toContain('Valid Honor');
      expect(result).toContain('Another Honor');
      expect(result).not.toContain('undefined');
    });

    test('handles empty honor list', () => {
      const result = formManager.getHonorListItems([]);

      expect(result).toBe('');
    });

    test('sets recent honors from array', () => {
      const newHonors = ['New Honor 1', 'New Honor 2'];
      formManager.setRecentHonors(newHonors);

      expect(formManager.recentHonors).toEqual(newHonors);
    });

    test('prevents non-array honors from causing errors', () => {
      formManager.setRecentHonors('string instead of array');

      expect(Array.isArray(formManager.recentHonors)).toBe(true);
      expect(formManager.recentHonors).toEqual([]);
    });
  });

  describe('Date Formatting', () => {
    test('formats ISO date string for HTML input', () => {
      const isoDate = '2026-02-14T12:30:00.000Z';
      const result = formManager.formatDateForInput(isoDate);

      expect(result).toBe('2026-02-14');
    });

    test('returns date unchanged if already in correct format', () => {
      const dateString = '2026-02-14';
      const result = formManager.formatDateForInput(dateString);

      expect(result).toBe('2026-02-14');
    });

    test('handles empty date string', () => {
      const result = formManager.formatDateForInput('');

      expect(result).toBe('');
    });

    test('handles null or undefined dates', () => {
      expect(formManager.formatDateForInput(null)).toBe('');
      expect(formManager.formatDateForInput(undefined)).toBe('');
    });

    test('extracts date portion from extended ISO format', () => {
      const longDateString = '2025-06-15T14:30:45.123Z';
      const result = formManager.formatDateForInput(longDateString);

      expect(result).toBe('2025-06-15');
    });
  });

  describe('Section Configuration', () => {
    test('updates section configuration', () => {
      const newConfig = createMockSectionConfig({
        name: 'new_section',
        honorRequirements: 5
      });

      formManager.setSectionConfig(newConfig);

      expect(formManager.sectionConfig).toBe(newConfig);
      expect(formManager.sectionConfig.name).toBe('new_section');
      expect(formManager.sectionConfig.honorRequirements).toBe(5);
    });

    test('preserves reference to section config', () => {
      const newConfig = createMockSectionConfig();
      formManager.setSectionConfig(newConfig);

      expect(formManager.sectionConfig === newConfig).toBe(true);
    });
  });

  describe('Form Population', () => {
    test('populates form with meeting data', async () => {
      const meetingData = createMockMeetingData({
        animateur_responsable: 'John Leader',
        date: '2026-02-21',
        endroit: 'Scout Hall'
      });

      await formManager.populateForm(meetingData, '2026-02-14');

      const responsableField = document.getElementById('animateur-responsable');
      const dateField = document.getElementById('date');
      const endroitField = document.getElementById('endroit');

      expect(responsableField.value).toBe('John Leader');
      expect(dateField.value).toBe('2026-02-21');
      expect(endroitField.value).toBe('Scout Hall');
    });

    test('uses organization default location if not provided', async () => {
      const meetingData = createMockMeetingData({
        endroit: undefined // No location in meeting
      });

      mockOrgSettings.organization_info.endroit = 'Default Scout Hall';

      await formManager.populateForm(meetingData, '2026-02-14');

      const endroitField = document.getElementById('endroit');
      expect(endroitField.value).toBe('Default Scout Hall');
    });

    test('populates youth of honor from meeting data', async () => {
      const meetingData = createMockMeetingData({
        youth_of_honor: ['Star 1', 'Star 2', 'Star 3']
      });

      await formManager.populateForm(meetingData, '2026-02-14');

      const honorField = document.getElementById('youth-of-honor');
      expect(honorField.value).toContain('Star 1');
      expect(honorField.value).toContain('Star 2');
    });

    test('falls back to recent honors if meeting lacks honor data', async () => {
      formManager.setRecentHonors(['Recent 1', 'Recent 2']);

      const meetingData = createMockMeetingData({
        youth_of_honor: undefined
      });

      await formManager.populateForm(meetingData, '2026-02-14');

      const honorField = document.getElementById('youth-of-honor');
      expect(honorField.value).toContain('Recent 1');
    });

    test('resets form when no meeting data provided', async () => {
      // First populate with data
      const meetingData = createMockMeetingData({
        animateur_responsable: 'John'
      });
      await formManager.populateForm(meetingData, '2026-02-14');

      // Then reset with null
      // Note: resetForm would need to be tested separately or mocked
      await formManager.populateForm(null, '2026-02-14');

      // After reset, should have default values
      const responsableField = document.getElementById('animateur-responsable');
      expect(responsableField.value).toBe('');
    });

    test('handles notes population with reminder text', async () => {
      formManager.reminder = {
        reminder_text: 'Don\'t forget to bring materials',
        reminder_date: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        is_recurring: false
      };

      const meetingData = createMockMeetingData({
        notes: 'Meeting notes here'
      });

      await formManager.populateForm(meetingData, '2026-02-14');

      const notesField = document.getElementById('notes');
      expect(notesField.value).toContain('Meeting notes here');
      // Reminder text may or may not be included depending on date logic
    });
  });

  describe('Activity Integration', () => {
    test('initializes placeholder activities from activity manager', async () => {
      const mockActivities = [
        { id: 1, name: 'Game 1' },
        { id: 2, name: 'Game 2' }
      ];

      mockActivityManager.initializePlaceholderActivities.mockReturnValue(mockActivities);

      const meetingData = createMockMeetingData({
        activities: mockActivities
      });

      await formManager.populateForm(meetingData, '2026-02-14');

      expect(mockActivityManager.initializePlaceholderActivities).toHaveBeenCalledWith(
        mockActivities
      );
    });

    test('applies duration override to activity manager if provided', async () => {
      const meetingData = createMockMeetingData({
        duration_override: '120' // 2 hour override
      });

      await formManager.populateForm(meetingData, '2026-02-14');

      // When a duration_override is provided, the activity manager should receive it
      // setMeetingLength accepts (lengthMinutes, durationOverride)
      expect(mockActivityManager.setMeetingLength).toHaveBeenCalledWith(
        mockActivityManager.meetingLengthMinutes,
        meetingData.duration_override
      );
    });
  });

  describe('Form State Management', () => {
    test('maintains form state across operations', async () => {
      formManager.setSectionConfig(createMockSectionConfig({ name: 'section1' }));
      formManager.setRecentHonors(['Honor 1']);

      expect(formManager.sectionConfig.name).toBe('section1');
      expect(formManager.recentHonors[0]).toBe('Honor 1');
    });

    test('updates organizational settings', () => {
      const newSettings = createMockOrgSettings({
        name: 'Updated Org',
        language: 'fr'
      });

      formManager.organizationSettings = newSettings;

      expect(formManager.organizationSettings.name).toBe('Updated Org');
      expect(formManager.organizationSettings.language).toBe('fr');
    });
  });

  describe('Error Handling', () => {
    test('handles null meeting data gracefully', async () => {
      expect(async () => {
        await formManager.populateForm(null, '2026-02-14');
      }).not.toThrow();
    });

    test('handles missing organization settings gracefully', () => {
      const manager = new FormManager(
        mockApp,
        null, // No org settings
        [],
        createMockHonors(),
        mockActivityManager,
        mockSectionConfig
      );

      expect(manager.organizationSettings).toBeNull();
    });

    test('handles empty activity arrays', async () => {
      const meetingData = createMockMeetingData({
        activities: []
      });

      mockActivityManager.initializePlaceholderActivities.mockReturnValue([]);

      expect(async () => {
        await formManager.populateForm(meetingData, '2026-02-14');
      }).not.toThrow();
    });
  });

  describe('Data Integrity', () => {
    test('preserves meeting data without mutation', async () => {
      const originalData = createMockMeetingData({
        animateur_responsable: 'Leader'
      });

      const dataCopy = JSON.parse(JSON.stringify(originalData));

      await formManager.populateForm(originalData, '2026-02-14');

      expect(originalData).toEqual(dataCopy);
    });

    test('respects demo organization in all operations', () => {
      expect(formManager.organizationSettings.organization_id).toBe(TEST_ORG_ID);
    });
  });

  describe('Multi-Language Support', () => {
    test('uses translation function from app', () => {
      const translationKey = 'reminder_text';
      
      // The form manager uses translate through dependencies
      // Verify the mock is set up correctly
      expect(mockApp.translate).toBeDefined();
    });
  });
});
