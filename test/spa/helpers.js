/**
 * Test Helpers for SPA Module Testing
 *
 * Provides common utilities, mocks, and setup for testing frontend modules.
 * Includes mock objects, token generators, and DOM utilities.
 *
 * @module test/spa/helpers
 */

/**
 * Create a mock app object with common methods
 * @param {Object} overrides - Override specific app methods
 * @returns {Object} Mock app object
 */
export function createMockApp(overrides = {}) {
  return {
    ajax: jest.fn().mockResolvedValue({
      success: true,
      data: []
    }),
    translate: jest.fn((key) => key),
    getCurrentUser: jest.fn().mockReturnValue({
      user_id: 1,
      organizationId: 3,
      roleNames: ['admin']
    }),
    showToast: jest.fn(),
    showNotification: jest.fn(),
    ...overrides
  };
}

/**
 * Create a mock organization settings object
 * @param {Object} overrides - Override specific settings
 * @returns {Object} Mock organization settings
 */
export function createMockOrgSettings(overrides = {}) {
  return {
    organization_id: 3, // Demo org
    name: 'Test Organization',
    language: 'en',
    organization_info: {
      endroit: 'Scout Hall',
      responsable: 'Test Org Lead'
    },
    ...overrides
  };
}

/**
 * Create a mock activity manager
 * @param {Object} overrides - Override specific methods
 * @returns {Object} Mock activity manager
 */
export function createMockActivityManager(overrides = {}) {
  return {
    getActivities: jest.fn().mockReturnValue([]),
    getSelectedActivitiesFromDOM: jest.fn().mockReturnValue([]),
    initializePlaceholderActivities: jest.fn().mockReturnValue([]),
    setMeetingLength: jest.fn(),
    setSelectedActivities: jest.fn(),
    renderActivitiesTable: jest.fn(),
    meetingLengthMinutes: 90,
    ...overrides
  };
}

/**
 * Create a mock section configuration
 * @param {Object} overrides - Override specific settings
 * @returns {Object} Mock section config
 */
export function createMockSectionConfig(overrides = {}) {
  return {
    name: 'test_section',
    honorRequirements: 2,
    minAge: 5,
    maxAge: 8,
    ...overrides
  };
}

/**
 * Create sample honor data
 * @returns {Array} Array of honor objects/strings
 */
export function createMockHonors() {
  return [
    { id: 1, name: 'First Star' },
    { id: 2, name: 'Second Star' },
    'Third Star Award'
  ];
}

/**
 * Create sample meeting data
 * @param {Object} overrides - Override specific fields
 * @returns {Object} Mock meeting data
 */
export function createMockMeetingData(overrides = {}) {
  return {
    id: 1,
    animateur_responsable: 'John Doe',
    date: '2026-02-14',
    youth_of_honor: ['First Star', 'Second Star'],
    endroit: 'Scout Hall',
    notes: 'Test meeting notes',
    activities: [],
    ...overrides
  };
}

/**
 * Setup DOM for testing (creates required elements)
 * @returns {Object} Object containing created elements for easy reference
 */
export function setupFormDOM() {
  // Create form container
  const container = document.createElement('div');
  container.id = 'form-container';
  
  // Create form elements used in FormManager
  const elements = {
    'animateur-responsable': document.createElement('input'),
    'date': document.createElement('input'),
    'youth-of-honor': document.createElement('textarea'),
    'endroit': document.createElement('input'),
    'duration-override': document.createElement('input'),
    'notes': document.createElement('textarea')
  };

  Object.entries(elements).forEach(([id, element]) => {
    element.id = id;
    // Only set type for input elements, not textareas
    if (element.tagName === 'INPUT') {
      element.type = id === 'date' ? 'date' : 'text';
    }
    container.appendChild(element);
  });

  document.body.appendChild(container);

  return {
    container,
    elements,
    cleanup: () => document.body.removeChild(container)
  };
}

/**
 * Cleanup DOM after tests
 * @param {Object} domSetup - Return value from setupFormDOM()
 */
export function cleanupFormDOM(domSetup) {
  if (domSetup && domSetup.cleanup) {
    domSetup.cleanup();
  }
}

/**
 * Mock DOMPurify for security tests (since DOMPurify requires DOM)
 * @returns {Object} Mock DOMPurify object
 */
export function createMockDOMPurify() {
  return {
    sanitize: jest.fn((html) => {
      // Simple mock: just strip script tags
      return html.replace(/<script[^>]*>.*?<\/script>/gi, '');
    }),
    removeAllRanges: jest.fn(),
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'br', 'p', 'div', 'span', 'a', 'img']
  };
}

/**
 * Test data generators for common scenarios
 */
export const TestDataGenerators = {
  /**
   * Generate valid participant data
   */
  validParticipant() {
    return {
      first_name: 'John',
      last_name: 'Doe',
      date_of_birth: '2015-06-14',
      gender: 'M',
      section: 'beaver',
      organization_id: 3
    };
  },

  /**
   * Generate form data with various validation scenarios
   */
  validFormData() {
    return {
      title: 'Test Form',
      description: 'A test form',
      fields: [
        { name: 'field1', type: 'text', required: true },
        { name: 'field2', type: 'email', required: false }
      ]
    };
  },

  /**
   * Generate invalid email variations
   */
  invalidEmails() {
    return [
      'no-at-sign.com',
      '@nodomain.com',
      'user@',
      'user @domain.com',
      'user@domain',
      '',
      null,
      undefined,
      { email: 'object' }
    ];
  },

  /**
   * Generate valid email variations
   */
  validEmails() {
    return [
      'user@example.com',
      'john.doe+tag@example.co.uk',
      'test123@test-domain.org',
      'a@b.c'
    ];
  },

  /**
   * Generate password variations
   */
  passwordVariations() {
    return {
      weak: 'short',
      medium: 'Password1',
      strong: 'P@ssw0rd!Strong'
    };
  }
};

/**
 * Assert helpers for common test patterns
 */
export const AssertHelpers = {
  /**
   * Assert validation result structure
   */
  assertValidationResult(result) {
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('error');
    expect(typeof result.valid).toBe('boolean');
    expect(result.error === null || typeof result.error === 'string').toBe(true);
  },

  /**
   * Assert that an element exists and has expected properties
   */
  assertElementExists(id, tagName = null) {
    const element = document.getElementById(id);
    expect(element).toBeTruthy();
    if (tagName) {
      expect(element.tagName.toLowerCase()).toBe(tagName.toLowerCase());
    }
  },

  /**
   * Assert that API was called with expected parameters
   */
  assertAPICall(mockFunction, expectedUrl, expectedMethod = 'GET') {
    expect(mockFunction).toHaveBeenCalled();
    const lastCall = mockFunction.mock.calls[mockFunction.mock.calls.length - 1][0];
    expect(lastCall.url).toContain(expectedUrl);
    expect(lastCall.method).toBe(expectedMethod);
  }
};

/**
 * Mock localStorage for testing
 */
export function createMockLocalStorage() {
  const store = {};
  
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = String(value);
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      Object.keys(store).forEach(key => delete store[key]);
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: jest.fn((index) => Object.keys(store)[index] || null)
  };
}

/**
 * Default organization ID for all tests (demo org)
 */
export const TEST_ORG_ID = 3; // Demo organization - safe for live testing
export const TEST_SECRET = 'test-secret-key';
